import { z } from "zod";
import { FORMAT_CARNET, type CarnetDef, type Domaine, type NiveauCarnet } from "./referentiel";

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
  titre: z.string().trim().min(1).max(200).optional(),
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

  if (FORMAT_CARNET[niveau] === "points") {
    const sansBareme = domaines.find((d) => d.bareme === undefined);
    if (sansBareme) return { ok: false, erreur: `Le domaine « ${sansBareme.libelle} » doit avoir un barème` };
    return { ok: true, domaines };
  }
  return {
    ok: true,
    domaines: domaines.map((d) => ({ code: d.code, libelle: d.libelle, titre: d.titre, lignes: d.lignes, matieres: d.matieres })),
  };
}

export interface LigneCompetence {
  domaine: string;
  ordre: number;
  libelle: string;
}

/** Domaine tel que stocké dans `carnet_configurations` : sans les lignes, qui sont dans `competences`. */
export function domainesStockes(domaines: Domaine[]): Omit<Domaine, "lignes">[] {
  return domaines.map(({ lignes: _lignes, ...reste }) => reste);
}

const DomaineStockeSchema = DomaineSchema.extend({ lignes: z.array(z.string()).max(MAX_LIGNES).default([]) });

/**
 * Définition effective d'un niveau, lue en base : domaines de `carnet_configurations`
 * (ordre, libellé, barème, matières), lignes de compétence de `competences`.
 * Une configuration absente ou invalide donne un carnet sans domaine (amorçage : initialiser.ts).
 * Les lignes d'un ancien enregistrement JSON servent tant que la table n'a rien pour ce domaine.
 */
export function definitionEffective(
  niveau: NiveauCarnet,
  stockee: unknown,
  competences: LigneCompetence[] = []
): CarnetDef {
  const analyse = z.array(DomaineStockeSchema).safeParse(stockee);
  const base = analyse.success ? analyse.data : [];
  const domaines: Domaine[] = base.map((d) => {
    const lignes = competences
      .filter((c) => c.domaine === d.code)
      .sort((a, b) => a.ordre - b.ordre)
      .map((c) => c.libelle);
    return { ...d, lignes: lignes.length > 0 ? lignes : d.lignes };
  });
  return { niveau, format: FORMAT_CARNET[niveau], domaines };
}
