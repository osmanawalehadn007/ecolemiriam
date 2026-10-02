import { normaliserNiveau } from "@/lib/niveau";

/**
 * Regroupement des factures par cycle (maternelle, primaire, collège, lycée)
 * puis par classe, pour la vue de la liste quand elle devient trop longue.
 */

export const CYCLES = ["MATERNELLE", "PRIMAIRE", "COLLEGE", "LYCEE"] as const;
export type Cycle = (typeof CYCLES)[number];
/** Groupes hors cycle : candidatures d'admission et factures sans classe. */
export type CategorieFacture = Cycle | "ADMISSION" | "AUTRE";

export const ORDRE_CATEGORIES: CategorieFacture[] = [...CYCLES, "ADMISSION", "AUTRE"];

/** Au-delà de ce nombre de factures, la liste est organisée par catégorie. */
export const SEUIL_REGROUPEMENT = 30;

const CYCLE_PAR_NIVEAU: Record<string, Cycle> = {
  Maternelle: "MATERNELLE",
  "1ère": "PRIMAIRE", "2ème": "PRIMAIRE", "3ème": "PRIMAIRE", "4ème": "PRIMAIRE", "5ème": "PRIMAIRE",
  "6ème": "COLLEGE", "7ème": "COLLEGE", "8ème": "COLLEGE", "9ème": "COLLEGE",
  Seconde: "LYCEE", Première: "LYCEE", Terminale: "LYCEE",
};

/**
 * Cycle d'une classe : la structure pédagogique à laquelle elle est rattachée
 * fait foi ; à défaut, on le déduit du niveau (puis du nom de la classe).
 */
export function cycleDeClasse(classe: {
  nom: string;
  niveau?: string | null;
  structure?: { type: string } | null;
}): Cycle | null {
  const type = classe.structure?.type;
  if (type && (CYCLES as readonly string[]).includes(type)) return type as Cycle;
  return (
    CYCLE_PAR_NIVEAU[normaliserNiveau(classe.niveau) ?? ""] ??
    CYCLE_PAR_NIVEAU[normaliserNiveau(classe.nom) ?? ""] ??
    null
  );
}

interface FactureGroupable {
  statut: string;
  eleve: {
    classe: { nom: string; niveau?: string | null; structure?: { type: string } | null } | null;
  } | null;
  candidature: { classeVoulue: string } | null;
}

export function categorieFacture(f: FactureGroupable): CategorieFacture {
  if (f.eleve?.classe) return cycleDeClasse(f.eleve.classe) ?? "AUTRE";
  if (!f.eleve && f.candidature) return "ADMISSION";
  return "AUTRE";
}

/** Libellé de classe utilisé pour le regroupement. */
export function classeFacture(f: FactureGroupable): string {
  return f.eleve?.classe?.nom ?? f.candidature?.classeVoulue ?? "—";
}

export interface CompteurFactures {
  payees: number;
  impayees: number;
}

/** Payées / restant à payer ; les factures annulées ne comptent ni d'un côté ni de l'autre. */
export function compterFactures(factures: { statut: string }[]): CompteurFactures {
  let payees = 0;
  let impayees = 0;
  for (const f of factures) {
    if (f.statut === "PAYEE") payees++;
    else if (f.statut !== "ANNULEE") impayees++;
  }
  return { payees, impayees };
}

export interface GroupeClasse<T> {
  classe: string;
  factures: T[];
  compteur: CompteurFactures;
}

export interface GroupeCategorie<T> {
  categorie: CategorieFacture;
  factures: T[];
  compteur: CompteurFactures;
  classes: GroupeClasse<T>[];
}

/** Catégories présentes dans les données, dans l'ordre scolaire ; classes triées par nom. */
export function grouperFactures<T extends FactureGroupable>(factures: T[]): GroupeCategorie<T>[] {
  const parCategorie = new Map<CategorieFacture, Map<string, T[]>>();
  for (const f of factures) {
    const cat = categorieFacture(f);
    const classes = parCategorie.get(cat) ?? new Map<string, T[]>();
    const nom = classeFacture(f);
    classes.set(nom, [...(classes.get(nom) ?? []), f]);
    parCategorie.set(cat, classes);
  }

  return ORDRE_CATEGORIES.filter((c) => parCategorie.has(c)).map((categorie) => {
    const classes = Array.from(parCategorie.get(categorie)!.entries())
      .sort(([a], [b]) => a.localeCompare(b, "fr", { numeric: true }))
      .map(([classe, fs]) => ({ classe, factures: fs, compteur: compterFactures(fs) }));
    const toutes = classes.flatMap((c) => c.factures);
    return { categorie, factures: toutes, compteur: compterFactures(toutes), classes };
  });
}
