/**
 * École Miriam — Isolation par année scolaire
 * ===========================================
 *
 * Source unique de vérité pour le filtrage par année scolaire.
 *
 * POURQUOI
 * --------
 * Le site est cloisonné par une couche dédiée (site-scope.ts, RLS, règle
 * ESLint `require-site-filter`). L'année ne l'était par rien : un sélecteur
 * de classe pouvait proposer des classes de 2025-2026 pour une candidature
 * 2026-2027, et un repli silencieux rattachait des élèves à des classes
 * d'une année précédente.
 *
 * Ce module symétrise le filtrage année avec le filtrage site :
 *
 *   - `anneeFilterForModel("classe", anneeCourante)` → fragment `where` Prisma
 *   - `requireAnneeFilter(claims)` → garde-fou pour les créations
 *
 * PRINCIPES
 * ---------
 * 1. FAIL-CLOSED. Si `anneeCourante` est null/undefined, on renvoie un
 *    prédicat toujours faux (DENY_ALL) — jamais un filtre vide qui laisserait
 *    passer toutes les années.
 *
 * 2. FILTRE INVIOLABLE. Le fragment est encapsulé dans `AND`, jamais
 *    étalable par l'appelant.
 *
 * 3. HISTORIQUE LÉGITIME. `ParcoursScolaire` est un journal d'historique :
 *    le filtrer par année courante n'a pas de sens. `ANNEE_EXEMPT_MODELS`
 *    liste les modèles où le filtre d'année est intentionnellement absent.
 */

import { mergeFilters } from "@/lib/site-scope";
import type { SessionSiteClaims } from "@/lib/site-scope";

/**
 * Valeur impossible utilisée pour construire un prédicat toujours faux.
 * (Symétrique de `IMPOSSIBLE_ID` dans site-scope.ts.)
 */
const IMPOSSIBLE_ANNEE = "__ecolemiriam_no_annee__";

/**
 * Fragment `where` qui ne correspond à aucune ligne.
 */
const DENY_ALL: Record<string, unknown> = {
  AND: [{ id: IMPOSSIBLE_ANNEE }],
};

// ------------------------------------------------------------
// Modèles portant un champ `annee` (String, format "2025-2026")
// ------------------------------------------------------------

/**
 * Comment atteindre le champ `annee` depuis chaque modèle.
 *
 *  - `"column"`    → le modèle porte directement `annee` (ou `anneeInscription`)
 *  - `"exempt"`    → historique légitime, pas de filtre d'année requis
 *  - `{ one }`     → relation vers-un portant `annee` (ex. Note → classe)
 */
export type AnneePath =
  | "column"
  | "exempt"
  | { one: string };

/**
 * Nom du champ `annee` sur chaque modèle "column".
 * La plupart utilisent `annee`, mais `Eleve` utilise `anneeInscription`.
 */
const ANNEE_FIELD: Record<string, string> = {
  classe: "annee",
  emploiTemps: "annee",
  tarifNiveau: "annee",
  candidature: "annee",
  fournitureListe: "annee",
  eleve: "anneeInscription",
};

/**
 * Modèles où le filtrage par année est intentionnellement absent
 * (historique, journal, données transverses).
 */
const ANNEE_EXEMPT_MODELS = new Set([
  "parcoursScolaire", // Journal de l'historique scolaire d'un élève
]);

/**
 * Table de routage : pour chaque modèle, comment atteindre le champ `annee`.
 *
 * Étendue au fur et à mesure que de nouveaux modèles sont identifiés.
 * `annee-scope.model.test.ts` (à créer) vérifiera chaque entrée contre le
 * schéma Prisma, comme le fait `site-scope.model.test.ts`.
 */
export const ANNEE_PATHS: Record<string, AnneePath> = {
  // --- colonne `annee` directe ---
  classe: "column",
  emploiTemps: "column",
  tarifNiveau: "column",
  candidature: "column",
  fournitureListe: "column",
  // `Eleve` porte `anneeInscription` (pas `annee`) — l'année d'inscription
  // de l'élève, pas l'année de sa classe. Le filtrage par année sur les
  // élèves est sémantiquement différent : on filtre les élèves inscrits
  // cette année, pas les élèves « de » cette année.
  eleve: "column",

  // --- rattachement via la classe ---
  evaluation: { one: "classe" },
  cahierTexte: { one: "classe" },
  devoir: { one: "classe" },
  chapitre: { one: "classe" },

  // --- historique légitime : pas de filtre d'année ---
  parcoursScolaire: "exempt",
};

// ------------------------------------------------------------
// Construction des fragments `where`
// ------------------------------------------------------------

/**
 * Fragment d'isolation par année pour un modèle donné.
 *
 * À utiliser conjointement avec `siteFilterForModel` :
 *
 *   const annee = await getAnneeCouranteLibelle(tenantId);
 *   const where = mergeFilters(
 *     { tenantId, ...siteFilterForModel("classe", session.user) },
 *     anneeFilterForModel("classe", annee),
 *   );
 *   prisma.classe.findMany({ where });
 *
 * @param model nom du modèle Prisma (doit figurer dans ANNEE_PATHS)
 * @param anneeCourante libellé de l'année courante (ex: "2026-2027"), ou null
 *   si non disponible → fail-closed (DENY_ALL)
 */
export function anneeFilterForModel(
  model: keyof typeof ANNEE_PATHS | string,
  anneeCourante: string | null | undefined,
): Record<string, unknown> {
  const path = ANNEE_PATHS[model];

  // Modèle inconnu de la table : fail-closed.
  if (!path) return DENY_ALL;

  if (path === "exempt") return {};

  // Fail-closed : pas d'année courante = aucune donnée.
  if (!anneeCourante) return DENY_ALL;

  if (path === "column") {
    const field = ANNEE_FIELD[model] ?? "annee";
    return { AND: [{ [field]: anneeCourante }] };
  }

  // Relation vers-un : filtrer via la relation.
  if ("one" in path) {
    return { AND: [{ [path.one]: { annee: anneeCourante } }] };
  }

  return DENY_ALL;
}

/**
 * Filtre combiné site + année pour un modèle donné.
 *
 * Raccourci pour `mergeFilters(siteFilterForModel(...), anneeFilterForModel(...))`.
 *
 *   const where = scopedFilterForModel("classe", session.user, anneeCourante);
 */
export function scopedFilterForModel(
  model: string,
  claims: SessionSiteClaims,
  anneeCourante: string | null | undefined,
): Record<string, unknown> {
  // Import dynamique pour éviter la dépendance circulaire au niveau module.
  // site-scope.ts n'importe pas annee-scope.ts, mais on garde la symétrie.
  const { siteFilterForModel } = require("@/lib/site-scope");
  return mergeFilters(
    siteFilterForModel(model, claims),
    anneeFilterForModel(model, anneeCourante),
  );
}

/**
 * Vérifie qu'une année est obligatoire pour une création.
 *
 * Symétrique de `requireSiteIdForCreate` : si l'année courante n'est pas
 * disponible, retourne un message d'erreur. Sinon retourne `null` (OK).
 *
 * À utiliser en début de chaque fonction de création qui implique l'année
 * (classe, emploi du temps, tarif, candidature).
 */
export function requireAnneeForCreate(
  anneeCourante: string | null | undefined,
): string | null {
  if (!anneeCourante) {
    return "Aucune année scolaire courante définie. Activez une année dans les paramètres avant de créer cet élément.";
  }
  return null;
}

/**
 * Valide qu'une classe appartient bien à l'année courante.
 *
 * À utiliser côté serveur lors de la validation d'une candidature ou d'une
 * affectation d'élève, en complément de la validation par site.
 *
 * @returns `null` si OK, sinon un message d'erreur.
 */
export function validateClasseAnnee(
  classeAnnee: string | null | undefined,
  anneeCourante: string,
): string | null {
  if (!classeAnnee) {
    return "La classe n'a pas d'année scolaire définie.";
  }
  if (classeAnnee !== anneeCourante) {
    return `La classe appartient à l'année ${classeAnnee}, mais l'année courante est ${anneeCourante}. Sélectionnez une classe de l'année courante.`;
  }
  return null;
}

export { DENY_ALL as ANNEE_DENY_ALL, IMPOSSIBLE_ANNEE };
