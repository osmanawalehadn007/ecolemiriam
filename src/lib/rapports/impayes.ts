/**
 * Rapport mensuel des mensualités impayées, par site.
 * ============================================================
 * Pour chaque site : les élèves qui n'ont pas soldé leurs mensualités,
 * classés par structure puis par classe, avec
 *   - le reste dû sur la mensualité du MOIS du rapport ;
 *   - le reste dû cumulé sur TOUTE l'année scolaire (jusqu'à ce mois inclus).
 *
 * Le « reste dû » d'une facture est son montant moins les paiements nets
 * (les contre-passations sont des paiements négatifs) : un acompte ne fait donc
 * pas disparaître l'élève de la liste. Les factures PAYEE et ANNULEE sont
 * ignorées.
 *
 * `construireRapports` est pure (aucun accès base) ; `chargerRapportsImpayes`
 * l'alimente et doit être appelée dans un contexte tenant (`runWithTenant`).
 */
import prisma from "@/lib/prisma";

const ORDRE_STRUCTURES = ["MATERNELLE", "PRIMAIRE", "COLLEGE", "LYCEE"];

export interface FactureImpayee {
  montant: number;
  mois: string; // "2026-10"
  siteId: string | null;
  paiements: number[]; // montants nets (contre-passations négatives)
  eleve: {
    id: string;
    nom: string;
    prenom: string;
    matricule: string;
    siteId: string | null;
    classe: {
      id: string;
      nom: string;
      niveau: string;
      structure: { id: string; nom: string; type: string } | null;
    } | null;
  };
}

export interface LigneEleve {
  eleveId: string;
  nom: string;
  prenom: string;
  matricule: string;
  resteMois: number;
  resteAnnee: number;
}

export interface GroupeClasse {
  classeId: string | null;
  nom: string;
  eleves: LigneEleve[];
  totalMois: number;
  totalAnnee: number;
}

export interface GroupeStructure {
  structureId: string | null;
  nom: string;
  type: string | null;
  classes: GroupeClasse[];
  totalMois: number;
  totalAnnee: number;
}

export interface RapportSite {
  siteId: string | null;
  siteNom: string;
  structures: GroupeStructure[];
  nbEleves: number;
  totalMois: number;
  totalAnnee: number;
}

/** Reste dû d'une facture (jamais négatif : un trop-perçu ne compense pas une autre facture). */
export function resteDu(montant: number, paiements: number[]): number {
  const paye = paiements.reduce((s, p) => s + p, 0);
  return Math.max(0, Math.round((montant - paye) * 100) / 100);
}

/** Bornes de l'année scolaire (septembre → août). */
export function bornesAnneeScolaire(annee: number, mois: number): { debut: string; fin: string } {
  const anneeDebut = mois >= 9 ? annee : annee - 1;
  return { debut: `${anneeDebut}-09`, fin: `${anneeDebut + 1}-08` };
}

export function cleMois(annee: number, mois: number): string {
  return `${annee}-${String(mois).padStart(2, "0")}`;
}

const comparer = (a: string, b: string) => a.localeCompare(b, "fr", { sensitivity: "base", numeric: true });

export function construireRapports(
  factures: FactureImpayee[],
  sites: Array<{ id: string; nom: string }>,
  moisCourant: string,
): RapportSite[] {
  // site → élève → cumul
  const parSite = new Map<string | null, Map<string, { ligne: LigneEleve; classe: FactureImpayee["eleve"]["classe"] }>>();
  for (const s of sites) parSite.set(s.id, new Map());

  for (const f of factures) {
    const reste = resteDu(f.montant, f.paiements);
    if (reste <= 0) continue;

    const siteId = f.eleve.siteId ?? f.siteId;
    if (!parSite.has(siteId)) parSite.set(siteId, new Map());
    const eleves = parSite.get(siteId)!;

    let entree = eleves.get(f.eleve.id);
    if (!entree) {
      entree = {
        classe: f.eleve.classe,
        ligne: {
          eleveId: f.eleve.id,
          nom: f.eleve.nom,
          prenom: f.eleve.prenom,
          matricule: f.eleve.matricule,
          resteMois: 0,
          resteAnnee: 0,
        },
      };
      eleves.set(f.eleve.id, entree);
    }
    entree.ligne.resteAnnee += reste;
    if (f.mois === moisCourant) entree.ligne.resteMois += reste;
  }

  const nomSite = new Map<string | null, string>(sites.map((s) => [s.id, s.nom]));
  nomSite.set(null, "Sans site");

  const rapports: RapportSite[] = [];
  for (const [siteId, eleves] of parSite) {
    // Un site fantôme (élève sans site) n'a un PDF que s'il y a des impayés ;
    // les vrais sites en ont toujours un, même vide, pour confirmer l'exécution.
    if (siteId === null && eleves.size === 0) continue;

    const structures = new Map<string, GroupeStructure>();
    const classes = new Map<string, GroupeClasse>();

    for (const { ligne, classe } of eleves.values()) {
      const struct = classe?.structure ?? null;
      const cleStruct = struct?.id ?? "_aucune";
      let gs = structures.get(cleStruct);
      if (!gs) {
        gs = { structureId: struct?.id ?? null, nom: struct?.nom ?? "Sans structure", type: struct?.type ?? null, classes: [], totalMois: 0, totalAnnee: 0 };
        structures.set(cleStruct, gs);
      }
      const cleClasse = classe?.id ?? "_aucune";
      let gc = classes.get(cleClasse);
      if (!gc) {
        gc = { classeId: classe?.id ?? null, nom: classe?.nom ?? "Sans classe", eleves: [], totalMois: 0, totalAnnee: 0 };
        classes.set(cleClasse, gc);
        gs.classes.push(gc);
      }
      gc.eleves.push(ligne);
      gc.totalMois += ligne.resteMois;
      gc.totalAnnee += ligne.resteAnnee;
      gs.totalMois += ligne.resteMois;
      gs.totalAnnee += ligne.resteAnnee;
    }

    const rang = (gs: GroupeStructure) => {
      const idx = ORDRE_STRUCTURES.indexOf(gs.type ?? "");
      return idx === -1 ? ORDRE_STRUCTURES.length : idx;
    };
    const liste = [...structures.values()].sort((a, b) => rang(a) - rang(b) || comparer(a.nom, b.nom));
    for (const gs of liste) {
      gs.classes.sort((a, b) => comparer(a.nom, b.nom));
      for (const gc of gs.classes) {
        gc.eleves.sort((a, b) => comparer(a.nom, b.nom) || comparer(a.prenom, b.prenom));
      }
    }

    rapports.push({
      siteId,
      siteNom: nomSite.get(siteId) ?? "Site inconnu",
      structures: liste,
      nbEleves: eleves.size,
      totalMois: liste.reduce((s, g) => s + g.totalMois, 0),
      totalAnnee: liste.reduce((s, g) => s + g.totalAnnee, 0),
    });
  }

  return rapports.sort((a, b) => (a.siteId === null ? 1 : b.siteId === null ? -1 : comparer(a.siteNom, b.siteNom)));
}

/** Charge les données d'un établissement. À appeler dans `runWithTenant`. */
export async function chargerRapportsImpayes(
  tenantId: string,
  annee: number,
  mois: number,
  siteIds?: string[] | null, // null/absent = tous les sites du tenant (y compris « Sans site »)
): Promise<RapportSite[]> {
  const { debut } = bornesAnneeScolaire(annee, mois);
  const courant = cleMois(annee, mois);

  const sites = await prisma.site.findMany({
    where: { tenantId, deletedAt: null, actif: true, ...(siteIds ? { id: { in: siteIds } } : {}) },
    select: { id: true, nom: true },
    orderBy: { nom: "asc" },
  });

  // eslint-disable-next-line ecolemiriam/require-site-filter -- cron (CRON_SECRET) : toutes les factures du tenant, regroupées par site
  const factures = await prisma.facture.findMany({
    where: {
      tenantId,
      type: "MENSUALITE",
      eleveId: { not: null },
      statut: { notIn: ["PAYEE", "ANNULEE"] },
      mois: { gte: debut, lte: courant },
      eleve: { is: { statut: "ACTIF", deletedAt: null } },
    },
    select: {
      montant: true,
      mois: true,
      siteId: true,
      paiements: { select: { montant: true } },
      eleve: {
        select: {
          id: true,
          nom: true,
          prenom: true,
          matricule: true,
          siteId: true,
          classe: {
            select: {
              id: true,
              nom: true,
              niveau: true,
              structure: { select: { id: true, nom: true, type: true } },
            },
          },
        },
      },
    },
  });

  const aplaties: FactureImpayee[] = [];
  for (const f of factures) {
    if (!f.eleve || !f.mois) continue;
    aplaties.push({
      montant: f.montant,
      mois: f.mois,
      siteId: f.siteId,
      paiements: f.paiements.map((p) => p.montant),
      eleve: f.eleve,
    });
  }

  const rapports = construireRapports(aplaties, sites, courant);
  return siteIds ? rapports.filter((r) => r.siteId !== null && siteIds.includes(r.siteId)) : rapports;
}
