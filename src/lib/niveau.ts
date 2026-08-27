/**
 * Convertit un niveau brut (numéro ou texte) en nom lisible en français.
 *
 * Depuis la migration du 2026-08-27, les niveaux sont stockés directement
 * en texte ("1ère", "2ème", "9ème", "Seconde", "Première", "Terminale").
 * Cette fonction conserve la conversion des anciens numéros (1-12) pour
 * la rétro-compatibilité avec d'éventuelles données non migrées.
 *
 * 1 → "1ère", 2 → "2ème", ..., 9 → "9ème"
 * 10 → "Seconde", 11 → "Première", 12 → "Terminale"
 *
 * Utilisé côté serveur (page.tsx) et côté client (FournituresView.tsx).
 */
export function niveauToLabel(niveau: string): string {
  const n = niveau.trim();
  // Si déjà en texte (contient des lettres), retourner tel quel
  if (/[a-zA-Zà-ÿ]/.test(n)) return n;
  const num = parseInt(n, 10);
  if (isNaN(num)) return n;
  const map: Record<number, string> = {
    1: "1ère",
    2: "2ème",
    3: "3ème",
    4: "4ème",
    5: "5ème",
    6: "6ème",
    7: "7ème",
    8: "8ème",
    9: "9ème",
    10: "Seconde",
    11: "Première",
    12: "Terminale",
  };
  return map[num] ?? n;
}
