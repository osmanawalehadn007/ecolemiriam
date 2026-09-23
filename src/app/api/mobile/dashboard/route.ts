import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifyMobileScope, mobileUnauthorized } from "@/lib/mobile-auth";
import { eleveScopeFilter, siteFilterForModel, siteFilterForRelation, mergeFilters } from "@/lib/site-scope";
import {
  teacherClasseFilter,
  teacherEleveFilter,
  teacherEleveRelationFilter,
  teacherEvaluationFilter,
  teacherNoteFilter,
} from "@/lib/teacher-classes";

export async function GET(req: NextRequest) {
  const user = await verifyMobileScope(req);
  if (!user) return mobileUnauthorized();
  if (!user.tenantId) {
    return NextResponse.json({ error: "Aucun établissement associé" }, { status: 403 });
  }

  const tenantId = user.tenantId;

  // Les compteurs eux-mêmes fuitaient : ils révélaient les volumes de
  // l'ensemble de l'établissement, tous sites confondus.
  const eleveRelFilter = eleveScopeFilter(user, "eleve");
  const classeRelFilter = siteFilterForRelation(user, "classe");

  const classeFilter = siteFilterForModel("classe", user);
  const eleveFilter = siteFilterForModel("eleve", user);

  // Périmètre ENSEIGNANT sur les six agrégats : sans lui, les compteurs du
  // tableau de bord révélaient les volumes du SITE entier et les listes
  // « récentes » nommaient les élèves des collègues.
  const [
    teacherEleveScope,
    teacherClasseScope,
    teacherNoteScope,
    teacherEleveRelScope,
    teacherEvaluationScope,
  ] = await Promise.all([
    teacherEleveFilter(user),
    teacherClasseFilter(user),
    teacherNoteFilter(user),
    teacherEleveRelationFilter(user, "eleve"),
    teacherEvaluationFilter(user),
  ]);

  const [totalEleves, totalClasses, totalNotes] = await Promise.all([
    prisma.eleve.count({
      where: mergeFilters({ tenantId, statut: "ACTIF" }, eleveFilter, teacherEleveScope),
    }),
    prisma.classe.count({
      where: mergeFilters({ tenantId }, classeFilter, teacherClasseScope),
    }),
    prisma.note.count({
      where: mergeFilters({ tenantId }, eleveRelFilter, teacherNoteScope),
    }),
  ]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const totalAbsencesToday = await prisma.absence.count({
    where: mergeFilters({ tenantId, date: { gte: today } }, eleveRelFilter, teacherEleveRelScope),
  });

  const [absencesRecentes, notesRecentes, prochainsExamens] = await Promise.all([
    prisma.absence.findMany({
      where: mergeFilters({ tenantId }, eleveRelFilter, teacherEleveRelScope),
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
      where: mergeFilters({ tenantId }, eleveRelFilter, teacherNoteScope),
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
        teacherEvaluationScope
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
}
