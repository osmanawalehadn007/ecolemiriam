/**
 * Mapping des niveaux scolaires vers le niveau suivant.
 * Utilisé par la procédure de réinscription pour la promotion automatique.
 *
 * Si un niveau n'est pas dans cette liste, la promotion est manuelle
 * (l'élève reste dans sa classe actuelle et est signalé).
 */
const ORDRE_NIVEAUX: Record<string, string | null> = {
  // Maternelle
  "petite section": "Moyenne Section",
  "moyenne section": "Grande Section",
  "grande section": "CP",
  // Primaire
  "cp": "CE1",
  "ce1": "CE2",
  "ce2": "CM1",
  "cm1": "CM2",
  "cm2": "6ème",
  // Collège
  "6ème": "5ème",
  "6eme": "5ème",
  "5ème": "4ème",
  "5eme": "4ème",
  "4ème": "3ème",
  "4eme": "3ème",
  "3ème": "2nde",
  "3eme": "2nde",
  // Lycée
  "2nde": "1ère",
  "2nd": "1ère",
  "1ère": "Terminale",
  "1ere": "Terminale",
  "terminale": null, // Dernière année → diplomé
};

/**
 * Retourne le niveau suivant pour un niveau donné.
 * - null → l'élève est diplomé (dernière année)
 * - undefined → niveau non reconnu, promotion manuelle requise
 */
export function niveauSuivant(niveau: string): string | null | undefined {
  return ORDRE_NIVEAUX[niveau.toLowerCase().trim()];
}
