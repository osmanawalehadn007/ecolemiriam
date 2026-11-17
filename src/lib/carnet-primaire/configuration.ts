import { z } from "zod";
import { CARNETS, type CarnetDef, type Domaine, type NiveauCarnet } from "./referentiel";

/**
 * Configuration d'un niveau par la direction : la liste des domaines (avec
 * leurs lignes de compétence et, au format `points`, leur barème). Le format
 * du carnet (compétences ou points) reste fixé par le niveau.
 *
 * Les saisies existantes sont indexées par code de domaine et, pour les
 * compétences, par position de la ligne dans le domaine. Modifier un texte
 * ou ajouter une ligne à la fin ne perd donc rien ; réordonner les lignes
 * d'un domaine déplacerait les évaluations déjà saisies.
 */

export const MAX_DOMAINES = 20;
export const MAX_LIGNES = 12;
export const BAREME_MAX = 100;

const CODE_RE = /^[A-Z0-9_]{1,30}$/;

export const DomaineSchema = z.object({
  code: z.string().regex(CODE_RE, "Code de domaine invalide"),
  libelle: z.string().trim().min(1, "Le libellé d'un domaine est requis").max(200),
  lignes: z
    .array(z.string().trim().min(1, "Une ligne de compétence ne peut pas être vide").max(400))
    .min(1, "Chaque domaine doit comporter au moins une ligne de compétence")
    .max(MAX_LIGNES),
  bareme: z.number().positive("Le barème doit être supérieur à 0").max(BAREME_MAX).optional(),
  matieres: z.array(z.string().min(1)).max(40).optional(),
});

export const DomainesSchema = z.array(DomaineSchema).min(1, "Au moins un domaine est requis").max(MAX_DOMAINES);

export type ResultatValidation =
  | { ok: true; domaines: Domaine[] }
  | { ok: false; erreur: string };

/**
 * Valide une liste de domaines pour un niveau : forme, codes uniques et barème
 * cohérent avec le format (obligatoire au format `points`, retiré sinon).
 */
export function validerDomaines(niveau: NiveauCarnet, brut: unknown): ResultatValidation {
  const analyse = DomainesSchema.safeParse(brut);
  if (!analyse.success) {
    return { ok: false, erreur: analyse.error.issues[0]?.message ?? "Configuration invalide" };
  }
  const domaines = analyse.data;

  const codes = new Set<string>();
  for (const d of domaines) {
    if (codes.has(d.code)) return { ok: false, erreur: `Le code « ${d.code} » est utilisé deux fois` };
    codes.add(d.code);
  }

  if (CARNETS[niveau].format === "points") {
    const sansBareme = domaines.find((d) => d.bareme === undefined);
    if (sansBareme) return { ok: false, erreur: `Le domaine « ${sansBareme.libelle} » doit avoir un barème` };
    return { ok: true, domaines };
  }
  return {
    ok: true,
    domaines: domaines.map((d) => ({ code: d.code, libelle: d.libelle, lignes: d.lignes, matieres: d.matieres })),
  };
}

/** Définition effective d'un niveau : la personnalisation valide, sinon le modèle par défaut. */
export function definitionEffective(niveau: NiveauCarnet, personnalisee: unknown): CarnetDef {
  const defaut = CARNETS[niveau];
  if (personnalisee == null) return defaut;
  const resultat = validerDomaines(niveau, personnalisee);
  return resultat.ok ? { ...defaut, domaines: resultat.domaines } : defaut;
}
