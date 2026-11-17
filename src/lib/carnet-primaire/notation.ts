import {
  CARNETS,
  MODULES,
  baremeTotal,
  type Domaine,
  type Module,
  type NiveauCarnet,
} from "./referentiel";

/** Évaluation d'une ligne de compétence (format `competences`). */
export type Evaluation = "A" | "EVA" | "NA";

export type DegreMaitrise = "Acquis" | "En voie d'acquisition" | "Non acquis";

/**
 * Saisie d'un module pour un élève.
 * - `competences` : évaluation par ligne, clé = `${domaine}.${index}`.
 * - `domaines` : points par domaine (format `points`).
 * - `note` : note générale du module sur 10. Dans le format `points`, elle
 *   est calculée à partir des domaines ; dans le format `competences`, elle
 *   est saisie par l'enseignant.
 */
export interface SaisieModule {
  competences?: Record<string, Evaluation>;
  domaines?: Record<string, number>;
  note?: number | null;
}

export type SaisieCarnet = Partial<Record<`${Module}`, SaisieModule>>;

/**
 * Degré de maîtrise d'une note sur 10, selon le barème du carnet :
 * 7 à 10 = Acquis, 4 à 6 = en voie d'acquisition, 0 à 3 = non acquis.
 * Les valeurs décimales entre deux bornes entières suivent le seuil
 * inférieur : 3,5 est non acquis, 6,5 est en voie d'acquisition.
 */
export function degreMaitrise(note: number): DegreMaitrise {
  if (note < 4) return "Non acquis";
  if (note < 7) return "En voie d'acquisition";
  return "Acquis";
}

/**
 * Note sur 10 d'un module au format `points` : somme des points des domaines
 * rapportée au total des barèmes. Renvoie null si aucun domaine n'est saisi.
 */
export function noteModulePoints(niveau: NiveauCarnet, domaines: Record<string, number>): number | null {
  const saisis = Object.values(domaines).filter((v) => Number.isFinite(v));
  if (saisis.length === 0) return null;
  const total = saisis.reduce((somme, v) => somme + v, 0);
  return Math.round((total / baremeTotal(niveau)) * 10 * 100) / 100;
}

/**
 * Vérifie qu'une saisie ne dépasse pas le barème de chaque domaine.
 * Renvoie la liste des erreurs lisibles, vide si la saisie est valide.
 */
export function erreursDomaines(niveau: NiveauCarnet, domaines: Record<string, number>): string[] {
  const erreurs: string[] = [];
  for (const domaine of CARNETS[niveau].domaines) {
    const valeur = domaines[domaine.code];
    if (valeur === undefined) continue;
    if (domaine.bareme === undefined) continue;
    if (!Number.isFinite(valeur) || valeur < 0 || valeur > domaine.bareme) {
      erreurs.push(`${domaine.libelle} : la note doit être comprise entre 0 et ${domaine.bareme}.`);
    }
  }
  return erreurs;
}

/** Note de module effective, quel que soit le format du carnet. */
export function noteModule(niveau: NiveauCarnet, saisie: SaisieModule | undefined): number | null {
  if (!saisie) return null;
  if (CARNETS[niveau].format === "points") {
    return noteModulePoints(niveau, saisie.domaines ?? {});
  }
  return typeof saisie.note === "number" && Number.isFinite(saisie.note) ? saisie.note : null;
}

/** Moyenne générale annuelle : moyenne des modules dont la note est renseignée. */
export function moyenneAnnuelle(niveau: NiveauCarnet, saisie: SaisieCarnet): number | null {
  const notes = MODULES.map((m) => noteModule(niveau, saisie[`${m}`])).filter(
    (n): n is number => n !== null
  );
  if (notes.length === 0) return null;
  const moyenne = notes.reduce((somme, n) => somme + n, 0) / notes.length;
  return Math.round(moyenne * 100) / 100;
}

/** Clé d'une ligne de compétence dans `SaisieModule.competences`. */
export function cleCompetence(domaine: Domaine, index: number): string {
  return `${domaine.code}.${index}`;
}
