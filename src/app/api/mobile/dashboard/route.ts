import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withMobileScope } from "@/lib/mobile-auth";
import { eleveScopeFilter, siteFilterForModel, siteFilterForRelation } from "@/lib/site-scope";
import { anneeFilterForModel } from "@/lib/annee-scope";
import { getAnneeCouranteLibelle } from "@/lib/annee-scolaire";
import { mergeFilters } from "@/lib/site-scope";

export async function GET(req: NextRequest) {
  return withMobileScope(req, async (user) => {
  const tenantId = user.tenantId;

  // Les compteurs eux-mêmes fuitaient : ils révélaient les volumes de
  // l'ensemble de l'établissement, tous sites confondus.
  const eleveRelFilter = eleveScopeFilter(user, "eleve");
  const classeRelFilter = siteFilterForRelation(user, "classe");

  const classeFilter = siteFilterForModel("classe", user);
  const eleveFilter = siteFilterForModel("eleve", user);
  const [totalEleves, totalClasses, totalNotes] = await Promise.all([
    prisma.eleve.count({ where: { tenantId, statut: "ACTIF", ...eleveFilter } }),
    prisma.classe.count({
      where: mergeFilters({ tenantId }, classeFilter, anneeFilterForModel("classe", await getAnneeCouranteLibelle(tenantId))),
    }),
    prisma.note.count({ where: { tenantId, ...eleveRelFilter } }),
  ]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const totalAbsencesToday = await prisma.absence.count({
    where: { tenantId, date: { gte: today }, ...eleveRelFilter },
  });

  const [absencesRecentes, notesRecentes, prochainsExamens] = await Promise.all([
    prisma.absence.findMany({
      where: { tenantId, ...eleveRelFilter },
      select: {
        id: true,
        date: true,
        isRetard: true,
        statut: true,
        motif: true,
        eleve: { select: { id: true, nom: true, prenom: true, photoUrl: true } },
      },
      orderBy: { date: "desc" },
      take: 5,
    }),
    prisma.note.findMany({
      where: { tenantId, ...eleveRelFilter },
      select: {
        id: true,
        valeur: true,
        noteMax: true,
        date: true,
        intitule: true,
        eleve: { select: { id: true, nom: true, prenom: true } },
        matiere: { select: { nom: true, code: true } },
      },
      orderBy: { date: "desc" },
      take: 5,
    }),
    prisma.evaluation.findMany({
      where: mergeFilters(
        { tenantId, statut: "PLANIFIE" },
        classeRelFilter,
        anneeFilterForModel("evaluation", await getAnneeCouranteLibelle(tenantId)),
      ),
      select: {
        id: true,
        titre: true,
        date: true,
        classe: { select: { nom: true } },
        matiere: { select: { nom: true } },
      },
      orderBy: { date: "asc" },
      take: 5,
    }),
  ]);

  return NextResponse.json({
    stats: {
      totalEleves,
      totalClasses,
      totalAbsencesToday,
      totalNotes,
    },
    absencesRecentes,
    notesRecentes,
    prochainsExamens,
  });
  });
}
