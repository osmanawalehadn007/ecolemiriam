// Niveaux nécessitant un professeur principal (collège + lycée)
const NIVEAUX_AVEC_PROF_PRINCIPAL = [
  "6ème", "6eme", "6e", "5ème", "5eme", "5e", "4ème", "4eme", "4e",
  "3ème", "3eme", "3e", "2nde", "seconde", "1ère", "1ere", "première",
  "premiere", "terminale", "tle",
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
