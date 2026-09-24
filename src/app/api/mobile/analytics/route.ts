import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withMobileScope } from "@/lib/mobile-auth";
import { siteFilterForModel, siteFilterForRelation, mergeFilters } from "@/lib/site-scope";
import { anneeFilterForModel } from "@/lib/annee-scope";
import { getAnneeCouranteLibelle } from "@/lib/annee-scolaire";
import { verifyMobileScope, mobileUnauthorized } from "@/lib/mobile-auth";
import {
  teacherClasseFilter,
  teacherEleveFilter,
  teacherEleveRelationFilter,
  teacherMatiereFilter,
  teacherNoteFilter,
} from "@/lib/teacher-classes";

export async function GET(req: NextRequest) {
  return withMobileScope(req, async (user) => {
  // Les statistiques agrégées ne doivent pas trahir les volumes des sites
  // auxquels l'utilisateur n'a pas accès.
  if (user.role === "PARENT" || user.role === "STUDENT") {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const tenantId = user.tenantId;
  const eleveRelFilter = siteFilterForRelation(user, "eleve");
  const classeRelFilter = siteFilterForRelation(user, "classe");

  const eleveFilter = siteFilterForModel("eleve", user);

  // Périmètre ENSEIGNANT : les statistiques d'un enseignant ne portent que sur
  // ses classes et ses matières. Sans lui, six agrégats et trois listes
  // décrivaient tout le site (effectifs, moyennes, volumes d'absences).
  const [
    teacherEleveScope,
    teacherClasseScope,
    teacherMatiereScope,
    teacherNoteScope,
    teacherEleveRelScope,
  ] = await Promise.all([
    teacherEleveFilter(user),
    teacherClasseFilter(user),
    teacherMatiereFilter(user),
    teacherNoteFilter(user),
    teacherEleveRelationFilter(user, "eleve"),
  ]);

  const [
    totalEleves,
    totalClasses,
    totalEnseignants,
    totalNotes,
    totalAbsences,
    totalIncidents,
  ] = await Promise.all([
    prisma.eleve.count({ where: { tenantId, statut: "ACTIF", ...eleveFilter } }),
    prisma.classe.count({
      where: mergeFilters({ tenantId }, eleveFilter, anneeFilterForModel("classe", await getAnneeCouranteLibelle(tenantId))),
    }),
    prisma.enseignant.count({ where: { tenantId, ...siteFilterForModel("enseignant", user) } }),
    prisma.note.count({ where: { tenantId, ...eleveRelFilter } }),
    prisma.absence.count({ where: { tenantId, ...eleveRelFilter } }),
    prisma.incident.count({ where: { tenantId, ...eleveRelFilter } }),
  ]);

  const classes = await prisma.classe.findMany({
    where: mergeFilters(
      { tenantId },
      eleveFilter,
      anneeFilterForModel("classe", await getAnneeCouranteLibelle(tenantId)),
    ),
    prisma.eleve.count({
      where: mergeFilters({ tenantId, statut: "ACTIF" }, eleveFilter, teacherEleveScope),
      where: mergeFilters({ tenantId }, eleveFilter, teacherClasseScope),
    prisma.note.count({
      where: mergeFilters({ tenantId }, eleveRelFilter, teacherNoteScope),
    prisma.absence.count({
      where: mergeFilters({ tenantId }, eleveRelFilter, teacherEleveRelScope),
    prisma.incident.count({
      where: mergeFilters({ tenantId }, eleveRelFilter, teacherEleveRelScope),
    where: mergeFilters({ tenantId }, eleveFilter, teacherClasseScope),
    select: { id: true, nom: true, niveau: true },
    orderBy: { nom: "asc" },
  });

  const elevesParClasse = await Promise.all(
    classes.map(async (c) => {
      const effectif = await prisma.eleve.count({
        where: mergeFilters(
          { tenantId, classeId: c.id, statut: "ACTIF" },
          eleveFilter,
          teacherEleveScope
        ),
      });
      return { id: c.id, nom: c.nom, niveau: c.niveau, effectif };
    })
  );

  const matieres = await prisma.matiere.findMany({
    where: { tenantId, ...siteFilterForModel("matiere", user) },
    where: mergeFilters(
      { tenantId },
      siteFilterForModel("matiere", user),
      teacherMatiereScope
    ),
    select: { id: true, nom: true, code: true, couleur: true },
    orderBy: { nom: "asc" },
  });

  const notesParMatiere = await Promise.all(
    matieres.map(async (m) => {
      const count = await prisma.note.count({
        where: mergeFilters({ tenantId, matiereId: m.id }, eleveRelFilter, teacherNoteScope),
      });
      return { id: m.id, nom: m.nom, code: m.code, couleur: m.couleur, count };
    })
  );

  const moyennesParClasse = await Promise.all(
    classes.map(async (c) => {
      const notes = await prisma.note.findMany({
        where: mergeFilters({ tenantId, classeId: c.id }, eleveRelFilter, teacherNoteScope),
        select: { valeur: true, noteMax: true, coefficient: true },
      });

      const moyenne =
        notes.length > 0
          ? notes.reduce((acc, n) => acc + (n.valeur / n.noteMax) * 20 * n.coefficient, 0) /
            notes.reduce((acc, n) => acc + n.coefficient, 0)
          : null;
      return { classeId: c.id, classeNom: c.nom, moyenne };
    })
  );

  return NextResponse.json({
    stats: {
      totalEleves,
      totalClasses,
      totalEnseignants,
      totalNotes,
      totalAbsences,
      totalIncidents,
    },
    elevesParClasse,
    notesParMatiere,
    moyennesParClasse,
    absencesParMois: totalAbsences,
  });
  });
}
