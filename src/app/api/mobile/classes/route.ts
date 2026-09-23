import { NextRequest, NextResponse } from "next/server";
import { verifyMobileScope, mobileUnauthorized } from "@/lib/mobile-auth";
import prisma from "@/lib/prisma";
import { eleveScopeFilter, siteFilterForModel, mergeFilters } from "@/lib/site-scope";
import { teacherClasseFilter, teacherEleveFilter } from "@/lib/teacher-classes";

export async function GET(req: NextRequest) {
  try {
    const user = await verifyMobileScope(req);
    if (!user) return mobileUnauthorized();
    if (!user.tenantId) {
      return NextResponse.json({ error: "Aucun établissement associé" }, { status: 403 });
    }
    const eleveFilter = eleveScopeFilter(user, null);
    const classeFilter = siteFilterForModel("classe", user);

    // Périmètre ENSEIGNANT : la liste des classes ET les élèves imbriqués sont
    // bornés. `_count`/`include` non borné aurait ramené les effectifs complets
    // des classes du site, avec les noms des élèves.
    const [teacherClasseScope, teacherEleveScope] = await Promise.all([
      teacherClasseFilter(user),
      teacherEleveFilter(user),
    ]);

    // `Classe` porte `siteId` ; les élèves imbriqués sont filtrés séparément
    // pour qu'un parent ne récupère pas la liste complète de la classe.

    const classes = await prisma.classe.findMany({
      where: mergeFilters({ tenantId: user.tenantId }, classeFilter, teacherClasseScope),
      include: {
        eleves: {
          where: mergeFilters({ statut: "ACTIF" }, eleveFilter, teacherEleveScope),
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
  } catch (error) {
    console.error("[API/mobile/classes]", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
