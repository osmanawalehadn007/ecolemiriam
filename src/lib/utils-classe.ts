// Niveaux nécessitant un professeur principal (collège + lycée)
// Depuis la migration du 2026-08-27, les niveaux primaires (1ère à 5ème année)
// et collège (6ème à 9ème) ont des noms distincts.
const NIVEAUX_AVEC_PROF_PRINCIPAL = [
  // Collège
  "6ème", "6eme", "6e",
  "7ème", "7eme", "7e",
  "8ème", "8eme", "8e",
  "9ème", "9eme", "9e",
  // Lycée
  "seconde", "2nde",
  "première", "premiere",
  "terminale", "tle",
];

export function niveauRequiresProfPrincipal(niveau: string): boolean {
  const n = niveau.toLowerCase().trim();
  return NIVEAUX_AVEC_PROF_PRINCIPAL.some((nv) => n === nv || n.startsWith(nv));
}

// Niveaux primaire / maternelle : l'enseignant enseigne toutes les matières
// dans une classe unique. Pas de lien matière obligatoire.
const NIVEAUX_PRIMAIRE = [
  "maternelle", "ps", "ms", "gs", // petite/moyenne/grande section
  "cp", "ce1", "ce2", "cm1", "cm2",
  "1ère", "1ere", // 1ère année primaire
  "2ème", "2eme", // 2ème année primaire
  "3ème", "3eme", // 3ème année primaire
  "4ème", "4eme", // 4ème année primaire
  "5ème", "5eme", // 5ème année primaire
  "1ère année", "2ème année", "3ème année", "4ème année", "5ème année", "6ème année",
  "sil", "cp1", "cp2", "cl", "cm",
];

// Tout ce qui n'est pas collège/lycée est considéré comme primaire/maternelle
export function isNiveauPrimaire(niveau: string): boolean {
  return !niveauRequiresProfPrincipal(niveau);
}

// Détermine si un niveau nécessite une matière obligatoire (collège/lycée)
export function niveauRequiresMatiere(niveau: string): boolean {
  return niveauRequiresProfPrincipal(niveau);
}
