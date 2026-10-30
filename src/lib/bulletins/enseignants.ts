/**
 * Nom du ou des enseignants d'une matière dans une classe, pour le bulletin.
 *
 * Source : les affectations enseignant ↔ classe ↔ matière. Une affectation sans
 * matière (primaire : un enseignant pour toutes les matières) sert de repli.
 */
export type AffectationNom = { matiereId: string | null; nom: string | null };

const TOUTES_MATIERES = "*";

export function nomsEnseignantsParMatiere(affectations: AffectationNom[]): Map<string, string> {
  const parMatiere = new Map<string, string[]>();
  for (const a of affectations) {
    const nom = a.nom?.trim();
    if (!nom) continue;
    const cle = a.matiereId ?? TOUTES_MATIERES;
    const noms = parMatiere.get(cle) ?? [];
    if (!noms.includes(nom)) noms.push(nom);
    parMatiere.set(cle, noms);
  }
  return new Map([...parMatiere].map(([cle, noms]) => [cle, noms.join(" / ")]));
}

export function nomEnseignantMatiere(noms: Map<string, string>, matiereId: string): string | null {
  return noms.get(matiereId) ?? noms.get(TOUTES_MATIERES) ?? null;
}
