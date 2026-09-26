/**
 * EcolPro — Facturation mensuelle automatique (cœur partagé)
 * ============================================================
 * Ce module contient la logique de génération des factures de scolarité du
 * mois. Il est appelé par :
 *
 *   1. l'action serveur `genererMensualites` (déclenchement manuel depuis
 *      /facturation, avec session utilisateur) ;
 *   2. le cron `GET /api/cron/facturation-mensuelle` (début de mois, sans
 *      session, protégé par CRON_SECRET).
 *
 * Aucun contrôle d'autorisation ici : il appartient à l'appelant. Les fragments
 * de périmètre (`eleveWhere`, `tarifWhere`) sont fournis par l'action serveur ;
 * le cron les omet volontairement pour traiter tous les sites.
 *
 * Les factures sont créées au statut `EN_ATTENTE` (impayée) et le restent
 * jusqu'à l'encaissement complet.
 */
import prisma from "@/lib/prisma";
import { choisirTarif, montantMensuel } from "@/lib/tarifs";

export const MOIS_NOMS = [
  "Janvier",
  "Février",
  "Mars",
  "Avril",
  "Mai",
  "Juin",
  "Juillet",
  "Août",
  "Septembre",
  "Octobre",
  "Novembre",
  "Décembre",
];

/**
 * Libellés acceptés pour une échéance mensuelle. L'ancienne génération écrivait
 * « Scolarité Septembre 2026 » (année seule) et la nouvelle
 * « Scolarité Septembre 2026-2027 » : les deux doivent être reconnus pour que
 * la génération reste idempotente et ne crée pas de facture en double.
 */
export function libellesMensualite(mois: number, annee: string): string[] {
  const moisNom = MOIS_NOMS[mois - 1] ?? `Mois ${mois}`;
  const debutAnnee = annee.split("-")[0];
  const libelles = [`Scolarité ${moisNom} ${annee}`];
  if (debutAnnee && debutAnnee !== annee) libelles.push(`Scolarité ${moisNom} ${debutAnnee}`);
  return libelles;
}

/** Libellé d'une échéance mensuelle — sert aussi de clé d'idempotence. */
export function libelleMensualite(mois: number, annee: string): string {
  return libellesMensualite(mois, annee)[0];
}

/** Clé de mois « 2026-10 » stockée dans `Facture.mois`. */
export function moisKey(mois: number, annee: string): string {
  return `${annee.split("-")[0]}-${String(mois).padStart(2, "0")}`;
}

/**
 * Vrai si l'erreur Prisma est une violation d'unicité. Elle survient quand deux
 * exécutions concurrentes tentent de créer la même mensualité : la base refuse
 * la seconde (index unique partiel `factures_unicite_mensuelle`), l'appelant la
 * compte alors comme « déjà facturée » au lieu d'échouer.
 */
export function estViolationUnicite(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}

/** Numérotation tenant-wide `FAC-<année>-<n>` (unique pour l'établissement). */
export async function numeroFactureSuivant(tenantId: string, annee: string): Promise<string> {
  // eslint-disable-next-line ecolpro/require-site-filter -- compteur tenant-wide : seul un NOMBRE est lu, aucune donnée d'un autre site n'est exposée
  const factureCount = await prisma.facture.count({ where: { tenantId } });
  return `FAC-${annee.split("-")[0]}-${String(factureCount + 1).padStart(5, "0")}`;
}

export interface GenerationMensualitesParams {
  tenantId: string;
  /** 1 à 12. */
  mois: number;
  /** Année scolaire « 2026-2027 ». */
  annee: string;
  inclureCantine?: boolean;
  inclureTransport?: boolean;
  /** Fragment de périmètre appliqué aux élèves (sites de l'utilisateur). */
  eleveWhere?: Record<string, unknown>;
  /** Fragment de périmètre appliqué à la grille tarifaire. */
  tarifWhere?: Record<string, unknown>;
  /** Utilisateur à l'origine de la génération ; `null` = tâche planifiée. */
  acteurId?: string | null;
}

export interface GenerationMensualitesResultat {
  /** Factures créées. */
  generated: number;
  /** Élèves ignorés (facture du mois déjà présente, ou sans tarif). */
  skipped: number;
  /** Dont élèves sans tarif pour leur niveau. */
  sansTarif: number;
  /** Montant total des factures créées. */
  montantTotal: number;
}

export async function genererMensualitesPourTenant(
  params: GenerationMensualitesParams
): Promise<GenerationMensualitesResultat> {
  const {
    tenantId,
    mois,
    annee,
    inclureCantine = false,
    inclureTransport = false,
    eleveWhere = {},
    tarifWhere = {},
    acteurId = null,
  } = params;

  if (!Number.isInteger(mois) || mois < 1 || mois > 12) {
    throw new Error("Mois invalide (1 à 12 attendu)");
  }

  const libelle = libelleMensualite(mois, annee);
  const libellesDedoublonnage = libellesMensualite(mois, annee);
  const cleMois = moisKey(mois, annee);

  /* eslint-disable ecolpro/require-site-filter -- `eleveWhere`/`tarifWhere` sont construits par l'appelant via siteFilterForModel(...) (action serveur) ou laissés vides pour un traitement tenant-wide assumé (cron protégé par CRON_SECRET). */
  const eleves = await prisma.eleve.findMany({
    where: { tenantId, statut: "ACTIF", deletedAt: null, ...eleveWhere },
    include: { classe: { select: { niveau: true, nom: true, annee: true } } },
  });

  // La grille peut être saisie pour l'année de la classe de l'élève, qui n'est
  // pas forcément celle passée en paramètre : on charge les deux.
  const anneesTarifs = Array.from(
    new Set([annee, ...eleves.map((e) => e.classe?.annee).filter((a): a is string => !!a)])
  );
  const tarifs = await prisma.tarifNiveau.findMany({
    where: { tenantId, actif: true, annee: { in: anneesTarifs }, ...tarifWhere },
  });

  // Factures déjà émises pour ce mois : le cron peut être rejoué sans doublon.
  // Trois repères sont testés — le mois structuré (`type` + `mois`), les deux
  // conventions de libellé — pour couvrir aussi les factures créées par les
  // versions antérieures (mois vide) ou par l'appel manuel.
  const facturesExistantes = await prisma.facture.findMany({
    where: {
      tenantId,
      statut: { not: "ANNULEE" },
      eleveId: { in: eleves.map((e) => e.id) },
      OR: [{ type: "MENSUALITE", mois: cleMois }, { libelle: { in: libellesDedoublonnage } }],
    },
    select: { eleveId: true },
  });
  /* eslint-enable ecolpro/require-site-filter */
  const dejaFactures = new Set(facturesExistantes.map((f) => f.eleveId));

  // Tarifs regroupés par année scolaire.
  const tarifsParAnnee = new Map<string, typeof tarifs>();
  for (const t of tarifs) {
    const liste = tarifsParAnnee.get(t.annee);
    if (liste) liste.push(t);
    else tarifsParAnnee.set(t.annee, [t]);
  }

  let generated = 0;
  let skipped = 0;
  let sansTarif = 0;
  let montantTotal = 0;

  for (const eleve of eleves) {
    // Tarif du site de l'élève, sinon tarif global, comparés sur une clé de
    // niveau canonique : une classe « 1 » et un tarif « 1ère » se rencontrent.
    const choix = choisirTarif(
      tarifsParAnnee.get(eleve.classe?.annee ?? annee) ?? tarifs,
      eleve.siteId,
      eleve.classe?.niveau
    );
    if (!choix) {
      sansTarif++;
      skipped++;
      continue;
    }

    if (dejaFactures.has(eleve.id)) {
      skipped++;
      continue;
    }

    // Montant lu dans la grille tarifaire (mensualité + options demandées).
    const montant = montantMensuel(choix.tarif, {
      cantine: inclureCantine,
      transport: inclureTransport,
    });

    // Échéance = dernier jour du mois facturé.
    const echeance = new Date(parseInt(annee.split("-")[0], 10), mois, 0);
    const numero = await numeroFactureSuivant(tenantId, annee);

    try {
      await prisma.facture.create({
        data: {
          tenantId,
          // La facture hérite du site de l'élève : sans cela elle serait créée
          // « non assignée » et invisible dans toutes les vues filtrées par site.
          siteId: eleve.siteId,
          eleveId: eleve.id,
          numero,
          libelle,
          montant,
          devise: choix.tarif.devise,
          statut: "EN_ATTENTE",
          // Clé d'unicité mensuelle. C'est l'INDEX PARTIEL en base
          // (`factures_unicite_mensuelle`) qui garantit l'unicité — atomique,
          // y compris entre deux exécutions simultanées — et non le test
          // applicatif ci-dessus (qui n'est qu'une optimisation).
          type: "MENSUALITE",
          mois: cleMois,
          echeance,
          createdById: acteurId,
        },
      });
    } catch (e) {
      if (estViolationUnicite(e)) {
        // Une autre exécution a créé la facture du mois entre-temps.
        skipped++;
        continue;
      }
      throw e;
    }

    generated++;
    montantTotal += montant;
  }

  return { generated, skipped, sansTarif, montantTotal };
}
