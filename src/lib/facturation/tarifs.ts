import { normaliserNiveau } from "@/lib/niveau";

/** Clé de comparaison : forme canonique si reconnue, sinon la saisie brute. */
function cleNiveau(niveau: string | null | undefined): string {
  return (normaliserNiveau(niveau) ?? niveau?.trim() ?? "").toLowerCase();
}

export interface TarifIndexable {
  niveau: string;
  siteId: string | null;
}

/**
 * Indexe une liste de tarifs d'une même année et renvoie la fonction de
 * recherche : le tarif propre au site est prioritaire, le tarif global
 * (siteId null) sert de repli. Les niveaux sont comparés sous forme
 * canonique ("1" = "1ère" = "1ere").
 *
 * Utilisable côté serveur comme côté client (aucune dépendance serveur).
 */
export function indexerTarifs<T extends TarifIndexable>(tarifs: T[]) {
  const parSite = new Map<string, T>();
  const globaux = new Map<string, T>();
  for (const t of tarifs) {
    const cle = cleNiveau(t.niveau);
    if (t.siteId) parSite.set(`${cle}|${t.siteId}`, t);
    else globaux.set(cle, t);
  }
  return function trouverTarif(niveau: string | null | undefined, siteId: string | null | undefined): T | undefined {
    const cle = cleNiveau(niveau);
    if (!cle) return undefined;
    return (siteId ? parSite.get(`${cle}|${siteId}`) : undefined) ?? globaux.get(cle);
  };
}
