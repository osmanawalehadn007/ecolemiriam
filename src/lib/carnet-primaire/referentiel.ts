/**
 * Référentiel des carnets de l'enseignement fondamental (école de base),
 * 1ère à 5ème année. Transcrit des modèles Word « CARNET DE LA … ANNEE ».
 *
 * Deux formats coexistent :
 * - `competences` (1ère, 2ème) : chaque ligne de compétence est évaluée
 *   A (acquis), EVA (en voie d'acquisition) ou NA (non acquis) par module.
 * - `points` (3ème à 5ème) : chaque domaine reçoit une note sur son barème
 *   (/40, /20, /10) par module. Le total des barèmes vaut 200.
 *
 * Dans les deux cas, la note générale d'un module est sur 10 et la moyenne
 * générale annuelle est la moyenne des modules renseignés.
 */

export const NIVEAUX_CARNET = ["1ère", "2ème", "3ème", "4ème", "5ème"] as const;
export type NiveauCarnet = (typeof NIVEAUX_CARNET)[number];

export const MODULES = [1, 2, 3, 4] as const;
export type Module = (typeof MODULES)[number];

export interface Domaine {
  code: string;
  libelle: string;
  /** Intitulé imprimé (modèle de l'école) ; à défaut, le libellé en majuscules. */
  titre?: string;
  /** Lignes de compétence (CB1, CB2, …) telles qu'imprimées sur le carnet. */
  lignes: string[];
  /** Barème du domaine — présent uniquement dans le format `points`. */
  bareme?: number;
  /**
   * Matières dont les notes alimentent ce domaine (identifiants). Sans liste,
   * la correspondance se fait par le nom de la matière (voir correspondance.ts).
   */
  matieres?: string[];
}

export type FormatCarnet = "competences" | "points";

export interface CarnetDef {
  niveau: NiveauCarnet;
  format: FormatCarnet;
  domaines: Domaine[];
}

/**
 * Format du carnet de chaque niveau (structure fixe). Les domaines, leurs
 * compétences et barèmes sont en base (tables `carnet_configurations` et
 * `competences`), amorcés depuis modeles-carnets.json (voir initialiser.ts).
 */
export const FORMAT_CARNET: Record<NiveauCarnet, FormatCarnet> = {
  "1ère": "competences",
  "2ème": "competences",
  "3ème": "points",
  "4ème": "points",
  "5ème": "points",
};

/** Total des barèmes du format `points` : la note de module est ramenée sur 10. */
export function baremeTotal(definition: CarnetDef): number {
  return definition.domaines.reduce((somme, d) => somme + (d.bareme ?? 0), 0);
}

export function estNiveauCarnet(valeur: string): valeur is NiveauCarnet {
  return (NIVEAUX_CARNET as readonly string[]).includes(valeur);
}

/**
 * Normalise le libellé d'une année scolaire ("2026/2027", "2026 - 2027",
 * "2026-2027") vers "2026-2027". Renvoie null si deux années n'y figurent pas.
 */
export function normaliserAnnee(libelle: string | null | undefined): string | null {
  const m = libelle?.match(/(\d{4})\D+(\d{4})/);
  return m ? `${m[1]}-${m[2]}` : null;
}
