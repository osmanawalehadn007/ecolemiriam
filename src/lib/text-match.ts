/**
 * École Miriam — Recherche floue partagée (assistant IA + moteur de suggestion)
 * ============================================================
 * Tolère accents et abréviations : le modèle ou l'utilisateur écrivent
 * "maths" pour "Mathématiques", "1ere L" pour "1ère L", etc.
 */

export function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Substring dans un sens ou l'autre, ou préfixe commun d'au moins 3 caractères.
 */
export function fuzzyFind<T extends { nom: string }>(candidates: T[], needle: string): T[] {
  const n = normalizeText(needle);
  return candidates.filter((c) => {
    const nc = normalizeText(c.nom);
    if (nc.includes(n) || n.includes(nc)) return true;
    const prefixLen = Math.min(4, n.length, nc.length);
    return prefixLen >= 3 && n.slice(0, prefixLen) === nc.slice(0, prefixLen);
  });
}

/**
 * Recherche floue STRICTE pour l'import d'emploi du temps.
 *
 * Règles plus strictes que fuzzyFind pour éviter les faux positifs :
 * 1. Le needle doit faire au moins 4 caractères (refuser les abréviations)
 * 2. Préfixe commun d'au moins 5 caractères (pas 3)
 * 3. Substring dans un sens ou l'autre
 *
 * Ex: "Graphisme" ne matche PAS "Écriture" (préfixe "grap" ≠ "ecri")
 *     "EM" ne matche PAS "EMT" ni "EMCI" (trop court, ambigu)
 *     "Lecture" matche "LECTURE" (exact après normalisation)
 *     "Maths" matche "Mathématiques" (substring "maths" dans "mathematiques")
 */
export function fuzzyFindStrict<T extends { nom: string }>(candidates: T[], needle: string): T[] {
  const n = normalizeText(needle);
  if (n.length < 3) return []; // Trop court → ambigu, refuser
  return candidates.filter((c) => {
    const nc = normalizeText(c.nom);
    // 1. Substring (dans un sens ou l'autre)
    if (nc.includes(n) || n.includes(nc)) return true;
    // 2. Préfixe commun d'au moins 5 caractères
    const prefixLen = Math.min(5, n.length, nc.length);
    return prefixLen >= 5 && n.slice(0, prefixLen) === nc.slice(0, prefixLen);
  });
}

/**
 * Normalise une heure exprimée de façon souple par le modèle ("8h", "8h30",
 * "8:00", "08:00") vers le format strict "HH:MM" attendu par la base.
 */
export function normalizeHeure(raw: string): string | null {
  const match = raw.trim().toLowerCase().match(/^(\d{1,2})\s*[h:]\s*(\d{1,2})?$/);
  if (!match) return null;
  const heures = parseInt(match[1], 10);
  const minutes = match[2] ? parseInt(match[2], 10) : 0;
  if (heures < 0 || heures > 23 || minutes < 0 || minutes > 59) return null;
  return `${String(heures).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}
