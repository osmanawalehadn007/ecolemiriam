import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withMobileScope } from "@/lib/mobile-auth";
import { eleveScopeFilter, siteFilterForModel, mergeFilters } from "@/lib/site-scope";
import { anneeFilterForModel } from "@/lib/annee-scope";
import { getAnneeCouranteLibelle } from "@/lib/annee-scolaire";
import {
  teacherClasseFilter,
  teacherMatiereFilter,
  teacherNoteFilter,
} from "@/lib/teacher-classes";

export async function GET(req: NextRequest) {
  return withMobileScope(req, async (user) => {
  const { searchParams } = new URL(req.url);
  const eleveId = searchParams.get("eleveId");
  const matiereId = searchParams.get("matiereId");

  // Sans filtre, un appel sans `eleveId` renvoyait les notes de TOUS les élèves
  // du tenant — tous sites confondus, et y compris pour un compte parent.
  const noteFilter = eleveScopeFilter(user, "eleve");

  const classeFilter = siteFilterForModel("classe", user);

  // Périmètre ENSEIGNANT : borné sur SES classes ET SES matières. `Note` porte
  // les deux colonnes, le filtre doit donc porter sur les deux — borner la
  // seule classe laisserait lire les notes de ses collègues pour ses classes.
  // Les listes de filtres proposées à l'écran sont bornées de la même façon :
  // sans cela, l'enseignant se voit proposer les classes des autres.
  const [teacherNoteScope, teacherClasseScope, teacherMatiereScope] =
    await Promise.all([
      teacherNoteFilter(user),
      teacherClasseFilter(user),
      teacherMatiereFilter(user),
    ]);
  const [notes, matieres, classes] = await Promise.all([
    prisma.note.findMany({
      where: mergeFilters(
        {
          tenantId: user.tenantId,
          ...(eleveId ? { eleveId } : {}),
          ...(matiereId ? { matiereId } : {}),
        },
        noteFilter,
        teacherNoteScope
      ),
      select: {
        id: true,
        valeur: true,
        noteMax: true,
        coefficient: true,
        date: true,
        intitule: true,
        type: true,
        eleve: { select: { id: true, nom: true, prenom: true } },
        matiere: { select: { id: true, nom: true, code: true, couleur: true, coefficient: true } },
        classe: { select: { id: true, nom: true } },
      },
      orderBy: { date: "desc" },
      take: 50,
    }),
    prisma.matiere.findMany({
      where: { tenantId: user.tenantId, ...siteFilterForModel("matiere", user) },
      where: mergeFilters(
        { tenantId: user.tenantId, ...siteFilterForModel("matiere", user) },
        teacherMatiereScope
      ),
      select: { id: true, nom: true, code: true, couleur: true, coefficient: true },
      orderBy: { nom: "asc" },
    }),
    prisma.classe.findMany({
      where: mergeFilters(
        { tenantId: user.tenantId },
        classeFilter,
        anneeFilterForModel(
          "classe",
          await getAnneeCouranteLibelle(user.tenantId),
        ),
      ),
      where: mergeFilters({ tenantId: user.tenantId, ...classeFilter }, teacherClasseScope),
      select: { id: true, nom: true, niveau: true },
      orderBy: { nom: "asc" },
    }),
  ]);

  return NextResponse.json({ notes, matieres, classes });
  });
}
