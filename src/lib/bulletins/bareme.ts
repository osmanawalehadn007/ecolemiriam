/**
 * Barème du bulletin (modèle Excel de l'établissement).
 *
 * Source unique pour l'appréciation par matière, l'appréciation générale et la
 * décision de passage : la génération et l'affichage du bulletin s'y réfèrent.
 */

/** Appréciation d'une moyenne /20. Les bornes hautes sont exclues, 10 pile = « Moyen ». */
export function appreciationBareme(moyenne: number | null | undefined): string {
  if (moyenne === null || moyenne === undefined || Number.isNaN(moyenne)) return "";
  if (moyenne < 7) return "En difficultés";
  if (moyenne < 10) return "Insuffisant";
  if (moyenne === 10) return "Moyen";
  if (moyenne < 12) return "Passable";
  if (moyenne < 14) return "Assez Bien";
  if (moyenne < 16) return "Bien";
  if (moyenne < 18) return "Très Bien";
  return "Excellent";
}

/** Décision de passage : 10/20 est admis. */
export function decisionPassage(moyenne: number | null | undefined): "Admis" | "Ajourné" | null {
  if (moyenne === null || moyenne === undefined || Number.isNaN(moyenne)) return null;
  return moyenne >= 10 ? "Admis" : "Ajourné";
}

/** Rang « compétition » : les ex æquo partagent le même rang (comme RANK d'Excel). */
export function rangsCompetition(moyennes: (number | null)[]): (number | null)[] {
  return moyennes.map((m) =>
    m === null ? null : 1 + moyennes.filter((o) => o !== null && o > m).length
  );
}

export function libelleRang(rang: number | null | undefined): string {
  if (!rang) return "";
  return rang === 1 ? "1er" : `${rang}ème`;
}
