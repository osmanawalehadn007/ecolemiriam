/**
 * Mapping des niveaux scolaires vers le niveau suivant.
 * Utilisé par la procédure de réinscription pour la promotion automatique.
 *
 * Depuis la migration du 2026-08-27, les niveaux sont stockés en texte.
 * L'ordre est: 1ère → 2ème → ... → 9ème → Seconde → Première → Terminale → diplomé.
 *
 * Si un niveau n'est pas dans cette liste, la promotion est manuelle
 * (l'élève reste dans sa classe actuelle et est signalé).
 */
const ORDRE_NIVEAUX: Record<string, string | null> = {
  // Primaire (1ère à 5ème année)
  "1ère": "2ème",
  "1ere": "2ème",
  "2ème": "3ème",
  "2eme": "3ème",
  "3ème": "4ème",
  "3eme": "4ème",
  "4ème": "5ème",
  "4eme": "5ème",
  "5ème": "6ème",
  "5eme": "6ème",
  // Collège (6ème à 9ème)
  "6ème": "7ème",
  "6eme": "7ème",
  "7ème": "8ème",
  "7eme": "8ème",
  "8ème": "9ème",
  "8eme": "9ème",
  "9ème": "Seconde",
  "9eme": "Seconde",
  // Lycée
  "seconde": "Première",
  "2nde": "Première",
  "première": "Terminale",
  "premiere": "Terminale",
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
