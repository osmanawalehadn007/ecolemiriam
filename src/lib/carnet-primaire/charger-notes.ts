import prisma from "@/lib/prisma";
import { normaliserAnnee } from "./referentiel";
import type { NoteCarnet } from "./calcul-auto";

/**
 * Notes d'un élève qui alimentent son carnet pour une année scolaire
 * ("2026-2027") : celles des évaluations qui portent un module du carnet,
 * quel que soit leur type (contrôle, devoir, examen…). L'année est celle de la
 * période de l'évaluation.
 */
export async function chargerNotesCarnet(tenantId: string, eleveId: string, annee: string): Promise<NoteCarnet[]> {
  // eslint-disable-next-line ecolemiriam/require-site-filter -- le site est contrôlé par l'appelant, qui a chargé l'élève avec siteFilterForModel ; l'année est filtrée plus bas sur le libellé de l'année de la période
  const notes = await prisma.note.findMany({
    where: { tenantId, eleveId, evaluation: { is: { moduleCarnet: { not: null } } } },
    select: {
      valeur: true,
      noteMax: true,
      coefficient: true,
      matiere: { select: { id: true, nom: true } },
      evaluation: {
        select: {
          moduleCarnet: true,
          ligneCarnet: true,
          periode: { select: { annee: { select: { libelle: true } } } },
        },
      },
    },
  });

  return notes.flatMap((n) => {
    const evaluation = n.evaluation;
    if (!evaluation || evaluation.moduleCarnet === null) return [];
    if (normaliserAnnee(evaluation.periode.annee.libelle) !== annee) return [];
    return [
      {
        matiere: n.matiere,
        moduleCarnet: evaluation.moduleCarnet,
        ligneCarnet: evaluation.ligneCarnet,
        valeur: n.valeur,
        noteMax: n.noteMax,
        coefficient: n.coefficient,
      },
    ];
  });
}
