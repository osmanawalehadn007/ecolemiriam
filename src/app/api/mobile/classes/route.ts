import { NextRequest, NextResponse } from "next/server";
import { withMobileScope } from "@/lib/mobile-auth";
import prisma from "@/lib/prisma";
import { eleveScopeFilter, siteFilterForModel, mergeFilters } from "@/lib/site-scope";
import { anneeFilterForModel } from "@/lib/annee-scope";
import { getAnneeCouranteLibelle } from "@/lib/annee-scolaire";

export async function GET(req: NextRequest) {
  try {
    return await withMobileScope(req, async (user) => {
    const eleveFilter = eleveScopeFilter(user, null);
    const classeFilter = siteFilterForModel("classe", user);

    // `Classe` porte `siteId` ; les élèves imbriqués sont filtrés séparément
    // pour qu'un parent ne récupère pas la liste complète de la classe.

    const anneeFilter = anneeFilterForModel(
      "classe",
      await getAnneeCouranteLibelle(user.tenantId),
    );

    const classes = await prisma.classe.findMany({
      where: mergeFilters({ tenantId: user.tenantId }, classeFilter, anneeFilter),
      include: {
        eleves: {
          where: { statut: "ACTIF", ...eleveFilter },
          select: {
            id: true,
            nom: true,
            prenom: true,
            photoUrl: true,
            sexe: true,
            matricule: true,
          },
          orderBy: [{ prenom: "asc" }, { nom: "asc" }],
        },
      },
      orderBy: { nom: "asc" },
    });

    return NextResponse.json({ classes });
    });
  } catch (error) {
    console.error("[API/mobile/classes]", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
