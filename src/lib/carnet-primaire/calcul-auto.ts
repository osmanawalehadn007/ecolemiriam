import { MODULES, type CarnetDef } from "./referentiel";
import { domaineDeMatiere, type MatiereRef } from "./correspondance";
import type { Evaluation, SaisieCarnet, SaisieModule } from "./notation";

/**
 * Valeurs du carnet déduites des notes saisies dans le module Notes.
 *
 * Seules comptent les évaluations qui portent un module du carnet (1 à 4) : les
 * notes d'une matière sont rattachées à un domaine (voir correspondance.ts),
 * puis moyennées en pondérant par le coefficient de la note.
 *
 * - format `points` : points du domaine = moyenne (sur 1) × barème du domaine ;
 * - format `competences` : A à partir de 70 %, EVA à partir de 40 %, NA en
 *   dessous — les seuils 7 et 4 sur 10 de l'échelle de maîtrise du carnet ; la
 *   note du module sur 10 est la moyenne des domaines notés.
 *
 * Ces valeurs sont des propositions : toute saisie manuelle du carnet les
 * remplace (voir fusionnerSaisie).
 */

export interface NoteCarnet {
  matiere: MatiereRef;
  /** Module du carnet porté par l'évaluation (1 à 4). */
  moduleCarnet: number;
  /** Ligne de compétence visée dans le domaine ; null = tout le domaine. */
  ligneCarnet: number | null;
  valeur: number;
  noteMax: number;
  coefficient: number;
}

export const SEUIL_ACQUIS = 0.7;
export const SEUIL_EN_VOIE = 0.4;

interface Mesure {
  ratio: number;
  poids: number;
  ligne: number | null;
}

const arrondi = (n: number) => Math.round(n * 100) / 100;

function moyennePonderee(mesures: Mesure[]): number | null {
  const poids = mesures.reduce((somme, m) => somme + m.poids, 0);
  if (poids <= 0) return null;
  return mesures.reduce((somme, m) => somme + m.ratio * m.poids, 0) / poids;
}

function evaluationDepuisRatio(ratio: number): Evaluation {
  if (ratio >= SEUIL_ACQUIS) return "A";
  if (ratio >= SEUIL_EN_VOIE) return "EVA";
  return "NA";
}

export function calculerSaisieAuto(definition: CarnetDef, notes: NoteCarnet[]): SaisieCarnet {
  // module → domaine → mesures
  const groupes = new Map<number, Map<string, Mesure[]>>();
  const domaines = new Map(definition.domaines.map((d) => [d.code, d]));

  for (const note of notes) {
    if (!(MODULES as readonly number[]).includes(note.moduleCarnet)) continue;
    if (!Number.isFinite(note.valeur) || !(note.noteMax > 0)) continue;
    const code = domaineDeMatiere(definition, note.matiere);
    if (!code || !domaines.has(code)) continue;

    const ratio = Math.min(1, Math.max(0, note.valeur / note.noteMax));
    const parDomaine = groupes.get(note.moduleCarnet) ?? new Map<string, Mesure[]>();
    const liste = parDomaine.get(code) ?? [];
    liste.push({ ratio, poids: note.coefficient > 0 ? note.coefficient : 0, ligne: note.ligneCarnet });
    parDomaine.set(code, liste);
    groupes.set(note.moduleCarnet, parDomaine);
  }

  const resultat: SaisieCarnet = {};
  for (const [module, parDomaine] of groupes) {
    const saisie: SaisieModule = {};
    const ratiosDomaines: number[] = [];

    for (const [code, mesures] of parDomaine) {
      const domaine = domaines.get(code)!;
      const ratioDomaine = moyennePonderee(mesures);
      if (ratioDomaine === null) continue;
      ratiosDomaines.push(ratioDomaine);

      if (definition.format === "points") {
        saisie.domaines = { ...saisie.domaines, [code]: arrondi(ratioDomaine * (domaine.bareme ?? 0)) };
        continue;
      }
      domaine.lignes.forEach((_, index) => {
        // Notes visant cette ligne, plus celles qui visent tout le domaine.
        const ratioLigne = moyennePonderee(mesures.filter((m) => m.ligne === null || m.ligne === index));
        if (ratioLigne === null) return;
        saisie.competences = { ...saisie.competences, [`${code}.${index}`]: evaluationDepuisRatio(ratioLigne) };
      });
    }

    if (definition.format === "competences" && ratiosDomaines.length > 0) {
      saisie.note = arrondi((ratiosDomaines.reduce((s, r) => s + r, 0) / ratiosDomaines.length) * 10);
    }
    if (saisie.competences || saisie.domaines || saisie.note !== undefined) {
      resultat[`${module}` as keyof SaisieCarnet] = saisie;
    }
  }
  return resultat;
}

/** Saisie effective : les valeurs saisies à la main l'emportent sur le calcul automatique. */
export function fusionnerSaisie(auto: SaisieCarnet, manuel: SaisieCarnet): SaisieCarnet {
  const resultat: SaisieCarnet = {};
  for (const m of MODULES) {
    const cle = `${m}` as keyof SaisieCarnet;
    const a = auto[cle];
    const b = manuel[cle];
    if (!a && !b) continue;
    resultat[cle] = {
      competences: { ...a?.competences, ...b?.competences },
      domaines: { ...a?.domaines, ...b?.domaines },
      note: b?.note ?? a?.note ?? null,
    };
  }
  return resultat;
}
