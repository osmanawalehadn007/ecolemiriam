import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifyMobileScope, mobileUnauthorized } from "@/lib/mobile-auth";
import { siteFilterForRelation, mergeFilters } from "@/lib/site-filter";
import { teacherEmploiTempsFilter } from "@/lib/teacher-classes";

export async function GET(req: NextRequest) {
  const user = await verifyMobileScope(req);
  if (!user) return mobileUnauthorized();
  if (!user.tenantId) {
    return NextResponse.json({ error: "Aucun établissement associé" }, { status: 403 });
  }

  // `EmploiTemps` n'a pas de colonne `siteId` : filtrage via la classe.
  // Pour un enseignant, on borne en plus sur SA propre fiche : `teacherClasseFilter`
  // ne suffirait pas — il montrerait les créneaux de ses collègues pour les
  // mêmes classes. Un rôle non enseignant reçoit `{}` : rien ne change.
  const emploi = await prisma.emploiTemps.findMany({
    where: mergeFilters(
      { tenantId: user.tenantId },
      siteFilterForRelation(user, "classe"),
      await teacherEmploiTempsFilter(user)
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
}
