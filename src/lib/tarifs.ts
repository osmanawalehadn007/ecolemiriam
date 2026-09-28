// ============================================================
// RAPPROCHEMENT CLASSE ↔ GRILLE TARIFAIRE
// ============================================================
//
// Le libellé du niveau est saisi librement des deux côtés : une classe de
// « Campus Central » porte `niveau = "1"`, celle d'« ANNEXE PK12 » porte
// `niveau = "1ère"`, et la grille tarifaire utilise elle aussi ses propres
// libellés. Comparer les chaînes telles quelles (l'ancien
// `tarifMap.get(niveau.toLowerCase())`) faisait donc échouer silencieusement
// toute génération de factures pour ces classes.
//
// `cleNiveau` ramène ces écritures à une clé canonique. Attention à ne PAS
// confondre :
//   « 1ère » (1ère année)      → « an1 »
//   « Première » (classe lycée) → « premiere »
// ce sont deux tarifs distincts (7 000 DJF contre 15 000 DJF).
//
// La résolution d'un tarif applique ensuite la règle métier :
//   tarif du site de l'élève, sinon tarif global (`siteId = null`).

/** Types de frais facturables à partir de la grille tarifaire. */
export type TypeFrais = "MENSUALITE" | "INSCRIPTION" | "RENOUVELLEMENT";

/** Champs de `TarifNiveau` nécessaires au rapprochement. */
export interface TarifLike {
  niveau: string;
  siteId: string | null;
  mensualite: number;
  fraisInscription: number;
  fraisRenouvellement: number;
  fraisCantine?: number | null;
  fraisTransport?: number | null;
  devise: string;
  nbMois?: number;
  actif: boolean;
}

/** Libellés non numérotés (lycée, maternelle) → clé canonique. */
const SYNONYMES: Record<string, string> = {
  maternelle: "maternelle",
  maternel: "maternelle",
  "petite section": "maternelle",
  "moyenne section": "maternelle",
  "grande section": "maternelle",
  seconde: "seconde",
  "2nde": "seconde",
  "2nd": "seconde",
  premiere: "premiere",
  terminale: "terminale",
  terminal: "terminale",
  tle: "terminale",
};

/**
 * Clé canonique d'un niveau : « 1 », « 1er », « 1ère », « 1ère année » et
 * « 1ère A » convergent tous vers `an1` ; « Première » reste `premiere`.
 *
 * Renvoie `null` quand le libellé est vide ou inexploitable : l'appelant doit
 * alors refuser de facturer plutôt que d'appliquer un tarif au hasard.
 */
export function cleNiveau(niveau: string | null | undefined): string | null {
  if (!niveau) return null;

  let n = niveau
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // accents (è → e)
    .toLowerCase()
    .replace(/[’'`]/g, " ")
    .replace(/[-_/\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!n) return null;

  // « classe de 6ème », « niveau 1ère » → on retire le préfixe de saisie.
  n = n.replace(/^(classe|niveau|section)\s+(de\s+)?/, "").trim();
  // « 1ère année », « 6eme annee scolaire » → on retire le mot « année ».
  n = n.replace(/\s*(annee|scolaire)$/, "").trim();
  // « 1ère A », « 6ème B2 », « 3ème 1 » → on retire la section/le groupe.
  n = n.replace(/\s+([a-z]\d?|\d{1,2})$/, "").trim();

  if (SYNONYMES[n]) return SYNONYMES[n];

  // 1 , 1er , 1ere , 2e , 2eme , 6eme … → an1, an2, an6
  const ordinal = n.match(/^(\d{1,2})\s*(er|ere|re|e|eme)?$/);
  if (ordinal) return `an${parseInt(ordinal[1], 10)}`;

  return null;
}

export interface TarifChoisi<T extends TarifLike> {
  tarif: T;
  /** `SITE` = tarif propre au site de l'élève, `GLOBAL` = tarif hérité. */
  source: "SITE" | "GLOBAL";
}

/**
 * Tarif applicable à un élève : celui de son site s'il existe, sinon le tarif
 * global du tenant pour le même niveau. Un tarif appartenant à un AUTRE site
 * n'est jamais utilisé.
 */
export function choisirTarif<T extends TarifLike>(
  tarifs: readonly T[],
  siteId: string | null | undefined,
  niveau: string | null | undefined
): TarifChoisi<T> | null {
  const cle = cleNiveau(niveau);
  if (!cle) return null;

  const candidats = tarifs.filter((t) => t.actif && cleNiveau(t.niveau) === cle);
  if (candidats.length === 0) return null;

  if (siteId) {
    const duSite = candidats.find((t) => t.siteId === siteId);
    if (duSite) return { tarif: duSite, source: "SITE" };
  }

  const global = candidats.find((t) => t.siteId === null);
  return global ? { tarif: global, source: "GLOBAL" } : null;
}

/** Montant correspondant au type de frais facturé. */
export function montantPourTypeFrais(tarif: TarifLike, type: TypeFrais): number {
  switch (type) {
    case "INSCRIPTION":
      return tarif.fraisInscription;
    case "RENOUVELLEMENT":
      return tarif.fraisRenouvellement;
    case "MENSUALITE":
    default:
      return tarif.mensualite;
  }
}

/** Part du tarif liée au mois (mensualité + options), pour la cantine/transport. */
export function montantMensuel(
  tarif: TarifLike,
  options?: { cantine?: boolean; transport?: boolean }
): number {
  let montant = tarif.mensualite;
  if (options?.cantine && tarif.fraisCantine) montant += tarif.fraisCantine;
  if (options?.transport && tarif.fraisTransport) montant += tarif.fraisTransport;
  return montant;
}
