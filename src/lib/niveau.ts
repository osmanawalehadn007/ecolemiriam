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
 *
 * ⚠️ Ce module porte aussi le RÉFÉRENTIEL OFFICIEL des niveaux
 * (`NIVEAUX_CANONIQUES`) et sa normalisation (`normaliserNiveau`) : toute
 * écriture de `Classe.niveau` doit passer par lui.
 */

/**
 * LES NIVEAUX OFFICIELS — liste fermée (référentiel, pas du texte libre).
 *
 * `Classe.niveau` et `TarifNiveau.niveau` ne doivent contenir QUE ces valeurs.
 * La grille tarifaire est indexée sur ce référentiel : tant que le champ
 * restait du texte libre, « 2 », « 2eme » ou « 2ème année » créaient une classe
 * que plus aucune grille ne savait facturer (constaté le 28/09/2026 : 191
 * élèves de Campus Central invisibles du moteur tarifaire).
 *
 * ⚠️ Ne pas confondre :
 *   « 1ère »     = 1ère année (primaire)       → tarif primaire
 *   « Première » = classe de Première (lycée)  → tarif lycée (15 000 DJF)
 * Les deux sont volontairement présentes et distinctes.
 *
 * ⚠️ `Matiere.niveau` n'obéit PAS à ce référentiel : une matière y stocke le
 * numéro de niveau (1-12) de son suffixe (« Lecture 1 » → 1). Voir AGENTS.md
 * § « Règles d'affichage des matières ».
 */
export const NIVEAUX_CANONIQUES = [
  // Maternelle
  "Maternelle",
  // Primaire (1ère à 5ème année)
  "1ère",
  "2ème",
  "3ème",
  "4ème",
  "5ème",
  // Collège (6ème à 9ème année)
  "6ème",
  "7ème",
  "8ème",
  "9ème",
  // Lycée
  "Seconde",
  "Première",
  "Terminale",
] as const;

export type NiveauCanonique = (typeof NIVEAUX_CANONIQUES)[number];

/** Le référentiel rangé par cycle — pour les sélecteurs (optgroup). */
export const NIVEAUX_PAR_CYCLE: { cycle: string; niveaux: NiveauCanonique[] }[] = [
  { cycle: "Maternelle", niveaux: ["Maternelle"] },
  { cycle: "Primaire", niveaux: ["1ère", "2ème", "3ème", "4ème", "5ème"] },
  { cycle: "Collège", niveaux: ["6ème", "7ème", "8ème", "9ème"] },
  { cycle: "Lycée", niveaux: ["Seconde", "Première", "Terminale"] },
];

/** Rang d'affichage (maternelle → terminale), pour trier les listes. */
const RANG: Record<string, number> = Object.fromEntries(
  NIVEAUX_CANONIQUES.map((n, i) => [n, i])
);

/**
 * Tri « scolaire » : Maternelle, 1ère, 2ème, …, Terminale.
 * Les valeurs hors référentiel passent en dernier, par ordre alphabétique.
 */
export function comparerNiveaux(a: string, b: string): number {
  const rangA = RANG[a];
  const rangB = RANG[b];
  if (rangA !== undefined && rangB !== undefined) return rangA - rangB;
  if (rangA !== undefined) return -1;
  if (rangB !== undefined) return 1;
  return a.localeCompare(b);
}

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

// ------------------------------------------------------------
// Normalisation → référentiel officiel
// ------------------------------------------------------------

/** Synonymes non numériques → niveau officiel. */
const SYNONYMES_NIVEAU: Record<string, NiveauCanonique> = {
  // Primaire (1ère à 5ème année) — les libellés français classiques (CP, CE1,
  // CM2…) restent acceptés : ils étaient déjà reconnus par l'import
  // d'enseignants, on ne perd pas cette compatibilité en centralisant.
  cp: "1ère",
  ce1: "2ème",
  ce2: "3ème",
  cm1: "4ème",
  cm2: "5ème",
  // Maternelle
  maternelle: "Maternelle",
  maternel: "Maternelle",
  "petite section": "Maternelle",
  "moyenne section": "Maternelle",
  "grande section": "Maternelle",
  ps: "Maternelle",
  ms: "Maternelle",
  gs: "Maternelle",
  creche: "Maternelle",
  garderie: "Maternelle",
  prescolaire: "Maternelle",
  // Lycée
  seconde: "Seconde",
  "2nde": "Seconde",
  "2nd": "Seconde",
  premiere: "Première",
  terminale: "Terminale",
  terminal: "Terminale",
  tle: "Terminale",
  term: "Terminale",
};

/** Numéro → niveau officiel (1 = 1ère année … 9 = 9ème, 10-12 = lycée). */
const NUMERO_VERS_NIVEAU: Record<number, NiveauCanonique> = {
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

/**
 * Ramène n'importe quelle saisie de niveau au référentiel officiel.
 *
 * Accepte (liste non exhaustive) : « 2 », « 2e », « 2eme », « 2ème »,
 * « 2ème année », « 2ème ANNÉE », « 2ème Année B », « niveau 2 », « classe de
 * 6ème », « 6eme », « GS », « PS/MS » (→ Maternelle), « 2nde », « Tle ».
 *
 * Renvoie `null` si la valeur est vide ou inclassable : l'appelant doit alors
 * REFUSER l'écriture, jamais deviner un niveau — même règle que la résolution
 * tarifaire (`choisirTarif`).
 */
export function normaliserNiveau(niveau: string | null | undefined): NiveauCanonique | null {
  if (!niveau) return null;

  let n = niveau
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // accents (è → e, é → e)
    .toLowerCase()
    .replace(/[’'`]/g, " ")
    .replace(/[-_/\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!n) return null;

  if (SYNONYMES_NIVEAU[n]) return SYNONYMES_NIVEAU[n];

  // « classe de 6ème », « niveau 2 », « section 1ère » → on retire le préfixe.
  n = n.replace(/^(classe|niveau|section|annee)\s+(de\s+)?/, "").trim();
  if (SYNONYMES_NIVEAU[n]) return SYNONYMES_NIVEAU[n];

  // « 1ère année », « 6eme annee scolaire » → on retire le mot « année ».
  n = n.replace(/\s*(annee|scolaire|scolaires)$/, "").trim();
  if (SYNONYMES_NIVEAU[n]) return SYNONYMES_NIVEAU[n];

  // « 1ère A », « 6ème B2 », « 3ème 1 », « PS/MS » → on retire la section
  // (1 ou 2 lettres, éventuellement numérotées) ou le groupe.
  n = n.replace(/\s+([a-z]{1,2}\d?|\d{1,2})$/, "").trim();
  if (SYNONYMES_NIVEAU[n]) return SYNONYMES_NIVEAU[n];

  // « 1ère année A » : le retrait de la section a pu laisser « 1ere annee ».
  n = n.replace(/\s*(annee|scolaire|scolaires)$/, "").trim();
  if (SYNONYMES_NIVEAU[n]) return SYNONYMES_NIVEAU[n];

  // 1 , 1er , 1ere , 2e , 2eme , 6eme … → référentiel officiel
  const ordinal = n.match(/^(\d{1,2})\s*(er|ere|re|e|eme|ieme)?$/);
  if (ordinal) {
    const num = parseInt(ordinal[1], 10);
    return NUMERO_VERS_NIVEAU[num] ?? null;
  }

  return null;
}

/** Vrai si la valeur est exactement une valeur du référentiel officiel. */
export function estNiveauCanonique(niveau: string | null | undefined): niveau is NiveauCanonique {
  return !!niveau && (NIVEAUX_CANONIQUES as readonly string[]).includes(niveau);
}

/**
 * Normalise OU refuse. À utiliser avant toute écriture de `Classe.niveau` :
 * le message cite la liste autorisée, de sorte que l'utilisateur corrige sa
 * saisie au lieu de créer une classe infacturable.
 */
export function niveauOuErreur(
  niveau: string | null | undefined,
  champ = "Niveau"
): NiveauCanonique {
  const canonique = normaliserNiveau(niveau);
  if (!canonique) {
    throw new Error(
      `${champ} « ${(niveau ?? "").trim()} » non reconnu. Valeurs autorisées : ${NIVEAUX_CANONIQUES.join(", ")}.`
    );
  }
  return canonique;
}

