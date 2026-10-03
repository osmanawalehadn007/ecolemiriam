import { compareAlpha } from "@/lib/utils";

interface FactureTriable {
  numero: string;
  statut: string;
  eleve: { nom: string; prenom: string } | null;
  candidature: { nom: string; prenom: string } | null;
}

/** Impayées (en attente, en retard) d'abord, puis payées, annulées en dernier. */
function rangStatut(statut: string): number {
  if (statut === "PAYEE") return 1;
  if (statut === "ANNULEE") return 2;
  return 0;
}

/** Nom tel qu'affiché dans les listes : prénom puis nom. */
function nomAffiche(f: FactureTriable): string {
  const p = f.eleve ?? f.candidature;
  return p ? `${p.prenom} ${p.nom}`.trim() : "";
}

/**
 * Ordre d'affichage des factures, quel que soit le groupe montré (toutes,
 * une catégorie, une classe, un mois) : les impayées en haut, les payées
 * ensuite, chaque bloc par ordre alphabétique d'élève.
 */
export function trierFactures<T extends FactureTriable>(factures: readonly T[]): T[] {
  return [...factures].sort(
    (a, b) =>
      rangStatut(a.statut) - rangStatut(b.statut) ||
      compareAlpha(nomAffiche(a), nomAffiche(b)) ||
      compareAlpha(a.numero, b.numero)
  );
}
