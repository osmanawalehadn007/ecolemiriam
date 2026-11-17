import type { CarnetDef } from "./referentiel";
import { normaliserNom } from "@/lib/matieres-defaut";

/**
 * Mots du nom d'une matière qui la rattachent à un domaine du carnet quand la
 * direction n'a pas désigné de matières pour ce domaine. « Lecture » et
 * « Graphisme » sont des matières du primaire de l'école (voir AGENTS.md).
 */
const MOTS_PAR_DOMAINE: Record<string, string[]> = {
  FRANCAIS: ["francais", "lecture", "ecriture", "langage", "grammaire", "dictee", "orthographe", "conjugaison", "vocabulaire", "expression", "poesie", "redaction"],
  ARABE: ["arabe", "coran"],
  ANGLAIS: ["anglais"],
  MATHS: ["math", "calcul", "geometrie", "numeration", "mesure", "arithmetique"],
  HISTOIRE: ["histoire"],
  GEOGRAPHIE: ["geographie"],
  SCIENCES: ["science", "svt"],
  EMCI: ["civique", "islamique", "morale", "emci", "education islamique"],
  EMT: ["manuelle", "technique", "emt", "graphisme", "dessin", "art"],
  TICE: ["tice", "informatique", "numerique"],
  EMT_TICE: ["manuelle", "technique", "emt", "graphisme", "dessin", "tice", "informatique"],
};

export interface MatiereRef {
  id: string;
  nom: string;
}

function contientMot(nomNormalise: string, mot: string): boolean {
  return new RegExp(`(^|[^a-z])${mot}`).test(nomNormalise);
}

/**
 * Domaine du carnet qui reçoit les notes d'une matière, ou null.
 * Les domaines où la matière est désignée explicitement priment ; à défaut,
 * le premier domaine, dans l'ordre du carnet, dont un mot correspond au nom.
 */
export function domaineDeMatiere(definition: CarnetDef, matiere: MatiereRef): string | null {
  const explicite = definition.domaines.find((d) => d.matieres?.includes(matiere.id));
  if (explicite) return explicite.code;

  const nom = normaliserNom(matiere.nom);
  for (const domaine of definition.domaines) {
    if (domaine.matieres && domaine.matieres.length > 0) continue; // domaine réglé à la main
    const mots = MOTS_PAR_DOMAINE[domaine.code] ?? [];
    if (mots.some((mot) => contientMot(nom, mot))) return domaine.code;
  }
  return null;
}
