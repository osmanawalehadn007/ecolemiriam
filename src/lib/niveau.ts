/**
 * Convertit un niveau brut (numéro ou texte) en nom lisible en français.
 *
 * Depuis la migration du 2026-08-27, les niveaux sont stockés directement
 * en texte ("1ère", "2ème", "9ème", "Seconde", "Première", "Terminale").
 * Cette fonction conserve la conversion des anciens numéros (1-12) pour
 * la rétro-compatibilité avec d'éventuelles données non migrées.
 *
 * 1 → "1ère année", 2 → "2ème année", ..., 9 → "9ème année"
 * 10 → "Seconde", 11 → "Première", 12 → "Terminale"
 *
 * L'identifiant unique en base (ex: "1ère", "2ème") est préservé ;
 * seul l'affichage UI ajoute le suffixe " année" pour les niveaux
 * primaire (1ère–5ème) et collège (6ème–9ème) afin d'éviter toute
 * confusion (ex: "1ère année" au lieu de "1ère" qui pourrait être
 * confondu avec la classe de "Première" du lycée).
 *
 * Utilisé côté serveur (page.tsx) et côté client (FournituresView.tsx).
 */

/** Variantes textuelles des niveaux primaire + collège (1ère–9ème année). */
const NIVEAUX_ANNEE: Record<string, string> = {
  "1ère": "1ère année",
  "1ere": "1ère année",
  "1er": "1ère année",
  "2ème": "2ème année",
  "2eme": "2ème année",
  "3ème": "3ème année",
  "3eme": "3ème année",
  "4ème": "4ème année",
  "4eme": "4ème année",
  "5ème": "5ème année",
  "5eme": "5ème année",
  "6ème": "6ème année",
  "6eme": "6ème année",
  "7ème": "7ème année",
  "7eme": "7ème année",
  "8ème": "8ème année",
  "8eme": "8ème année",
  "9ème": "9ème année",
  "9eme": "9ème année",
};

export function niveauToLabel(niveau: string | null | undefined): string {
  if (!niveau) return "";
  const n = niveau.trim();

  // 1) Anciens numéros (1-12) → conversion explicite
  if (/^\d+$/.test(n)) {
    const num = parseInt(n, 10);
    const map: Record<number, string> = {
      1: "1ère année",
      2: "2ème année",
      3: "3ème année",
      4: "4ème année",
      5: "5ème année",
      6: "6ème année",
      7: "7ème année",
      8: "8ème année",
      9: "9ème année",
      10: "Seconde",
      11: "Première",
      12: "Terminale",
    };
    return map[num] ?? n;
  }

  // 2) Formes textuelles "1ère"…"9ème" (et variantes sans accent) → ajouter " année"
  const labelAnnee = NIVEAUX_ANNEE[n.toLowerCase()];
  if (labelAnnee) return labelAnnee;

  // 3) Déjà en texte lisible (Seconde, Première, Terminale, Maternelle, etc.) → tel quel
  return n;
}
