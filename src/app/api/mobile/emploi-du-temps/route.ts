import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withMobileScope } from "@/lib/mobile-auth";
import { siteFilterForRelation } from "@/lib/site-filter";
import { anneeFilterForModel } from "@/lib/annee-scope";
import { getAnneeCouranteLibelle } from "@/lib/annee-scolaire";
import { mergeFilters } from "@/lib/site-scope";

export async function GET(req: NextRequest) {
  return withMobileScope(req, async (user) => {
  // `EmploiTemps` n'a pas de colonne `siteId` : filtrage via la classe.
  const emploi = await prisma.emploiTemps.findMany({
    where: mergeFilters(
      { tenantId: user.tenantId },
      siteFilterForRelation(user, "classe"),
      anneeFilterForModel(
        "emploiTemps",
        await getAnneeCouranteLibelle(user.tenantId),
      ),
    ),
    select: {
      id: true,
      jour: true,
      heureDebut: true,
      heureFin: true,
      salle: true,
      classe: { select: { id: true, nom: true, niveau: true } },
      matiere: { select: { id: true, nom: true, code: true, couleur: true } },
      enseignant: {
        select: {
          id: true,
          user: { select: { name: true } },
        },
      },
    },
    orderBy: [{ jour: "asc" }, { heureDebut: "asc" }],
  });

  return NextResponse.json({ emploi });
  });
}
