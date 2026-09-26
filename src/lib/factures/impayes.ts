/**
 * EcolPro — Impayés : indicateur et alerte au responsable
 * ============================================================
 * Deux usages :
 *   1. `getImpayesStats()` alimente le KPI « factures impayées » du tableau de
 *      bord (rôles disposant de `finance:read`).
 *   2. `alerterImpayes()` est appelée par le cron `GET /api/cron/alerte-impayes`
 *      (le 15 de chaque mois) : elle notifie par e-mail les responsables de
 *      l'établissement (administration + gestionnaire) et journalise l'alerte.
 *
 * Une facture est « impayée » tant qu'elle est au statut EN_ATTENTE ou
 * EN_RETARD — c'est-à-dire jusqu'à l'encaissement complet du montant.
 */
import prisma from "@/lib/prisma";
import { sendEmail, renderNotificationEmail } from "@/lib/notifications/email";
import { audit } from "@/lib/audit";
import { anneeScolaireParDefaut, getAnneeCourante } from "@/lib/annee-scolaire";
import { MOIS_NOMS, libelleMensualite } from "./mensualites";

/** Rôles destinataires d'une alerte financière. */
export const ROLES_RESPONSABLES = ["TENANT_ADMIN", "PRINCIPAL", "ACCOUNTANT"] as const;

export interface ImpayesStats {
  /** Nombre de factures impayées. */
  nbFactures: number;
  /** Nombre d'élèves concernés. */
  nbEleves: number;
  /** Montant total facturé (factures impayées). */
  montantTotal: number;
  /** Montant déjà encaissé sur ces factures. */
  montantEncaisse: number;
  /** Reste à recouvrer. */
  montantRestant: number;
  /** Factures dont l'échéance est dépassée. */
  nbEnRetard: number;
  /** Reste à recouvrer sur les seules factures en retard. */
  montantEnRetard: number;
  /** Devise observée (celle de la majorité des factures impayées). */
  devise: string;
}

export const IMPAYES_VIDE: ImpayesStats = {
  nbFactures: 0,
  nbEleves: 0,
  montantTotal: 0,
  montantEncaisse: 0,
  montantRestant: 0,
  nbEnRetard: 0,
  montantEnRetard: 0,
  devise: "DJF",
};

/**
 * Indicateur des impayés. `factureWhere` reçoit le périmètre de sites construit
 * par l'appelant (tableau de bord) ; le cron le laisse vide pour couvrir tous
 * les sites de l'établissement.
 */
export async function getImpayesStats(params: {
  tenantId: string;
  factureWhere?: Record<string, unknown>;
}): Promise<ImpayesStats> {
  const { tenantId, factureWhere = {} } = params;
  const maintenant = new Date();

  /* eslint-disable ecolpro/require-site-filter -- `factureWhere` est construit par l'appelant via siteFilterForModel("facture", session.user) ; vide = traitement tenant-wide assumé (cron protégé par CRON_SECRET). */
  const factures = await prisma.facture.findMany({
    where: {
      tenantId,
      statut: { in: ["EN_ATTENTE", "EN_RETARD"] },
      ...factureWhere,
    },
    select: {
      id: true,
      eleveId: true,
      montant: true,
      devise: true,
      echeance: true,
      paiements: { select: { montant: true } },
    },
  });
  /* eslint-enable ecolpro/require-site-filter */

  if (factures.length === 0) return IMPAYES_VIDE;

  const stats = factures.reduce(
    (acc, f) => {
      const encaisse = f.paiements.reduce((s, p) => s + p.montant, 0);
      const restant = Math.max(0, f.montant - encaisse);
      const enRetard = f.echeance !== null && f.echeance < maintenant;

      acc.total += f.montant;
      acc.encaisse += encaisse;
      acc.restant += restant;
      if (enRetard) {
        acc.nbEnRetard++;
        acc.montantEnRetard += restant;
      }
      acc.devises.set(f.devise, (acc.devises.get(f.devise) ?? 0) + 1);
      return acc;
    },
    {
      total: 0,
      encaisse: 0,
      restant: 0,
      nbEnRetard: 0,
      montantEnRetard: 0,
      devises: new Map<string, number>(),
      eleves: new Set<string>(),
    }
  );
  factures.forEach((f) => stats.eleves.add(f.eleveId));

  const devise =
    Array.from(stats.devises.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "DJF";

  return {
    nbFactures: factures.length,
    nbEleves: stats.eleves.size,
    montantTotal: stats.total,
    montantEncaisse: stats.encaisse,
    montantRestant: stats.restant,
    nbEnRetard: stats.nbEnRetard,
    montantEnRetard: stats.montantEnRetard,
    devise,
  };
}

export interface Responsable {
  id: string;
  name: string | null;
  email: string;
}

/**
 * Destinataires de l'alerte financière : administration + gestionnaire de
 * l'établissement. `ALERTE_IMPAYES_DESTINATAIRES` (liste séparée par des
 * virgules) permet d'ajouter des adresses hors application — utile pour un
 * comptable externe, et pour tester l'envoi.
 */
export async function responsablesDuTenant(tenantId: string): Promise<Responsable[]> {
  /* eslint-disable-next-line ecolpro/require-site-filter -- alerte financière : destinataires tenant-wide (administration + gestionnaire), jamais bornés à un site */
  const users = await prisma.user.findMany({
    where: { tenantId, isActive: true, role: { in: [...ROLES_RESPONSABLES] } },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });

  const externes = (process.env.ALERTE_IMPAYES_DESTINATAIRES ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter((e) => e.length > 3 && e.includes("@"));

  const parEmail = new Map<string, Responsable>();
  for (const u of users) {
    if (u.email) parEmail.set(u.email.toLowerCase(), { id: u.id, name: u.name, email: u.email });
  }
  for (const email of externes) {
    if (!parEmail.has(email.toLowerCase())) {
      parEmail.set(email.toLowerCase(), { id: `externe:${email}`, name: null, email });
    }
  }

  return Array.from(parEmail.values());
}

export interface AlerteImpayesParams {
  tenantId: string;
  /** Périmètre de sites (vide = tous les sites, cas du cron). */
  factureWhere?: Record<string, unknown>;
  /** Neutralise l'envoi (diagnostic / répétition à blanc). */
  sansEnvoi?: boolean;
  /** Date de référence (tests) ; par défaut : maintenant. */
  reference?: Date;
}

export interface AlerteImpayesResultat {
  /** Impayés DU MOIS en cours : c'est eux qui déclenchent l'alerte du 15. */
  statsMois: ImpayesStats;
  /** Tous les impayés, toutes échéances confondues (contexte de l'e-mail). */
  statsGlobal: ImpayesStats;
  /** Libellé du mois facturé, ex. « Scolarité Septembre 2026-2027 ». */
  libelleMois: string;
  destinataires: string[];
  emailEnvoye: boolean;
  erreurEmail?: string;
  sujet: string;
  /** Faux tant qu'aucun impayé du mois n'exige d'alerte. */
  alerteEnvoyee: boolean;
}

function formaterMontant(montant: number, devise: string): string {
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(montant)} ${devise}`;
}

/**
 * Construit et envoie l'alerte « factures impayées » au responsable, puis
 * journalise l'opération. Ne lève jamais : un échec d'e-mail est retourné dans
 * `erreurEmail` afin que le cron reste idempotent et rejouable.
 */
export async function alerterImpayes(params: AlerteImpayesParams): Promise<AlerteImpayesResultat> {
  const { tenantId, factureWhere = {}, sansEnvoi = false, reference = new Date() } = params;

  // L'année scolaire active détermine le libellé du mois facturé
  // (« Scolarité Septembre 2026-2027 ») : c'est la clé de rattachement des
  // factures d'un mois, il n'existe pas de colonne « mois » sur Facture.
  const anneeActive =
    (await getAnneeCourante(tenantId))?.libelle ?? anneeScolaireParDefaut(reference);
  const moisCourant = reference.getMonth() + 1;
  const libelleMois = libelleMensualite(moisCourant, anneeActive);

  const [statsMois, statsGlobal] = await Promise.all([
    getImpayesStats({ tenantId, factureWhere: { ...factureWhere, libelle: libelleMois } }),
    getImpayesStats({ tenantId, factureWhere }),
  ]);

  const periode = `${MOIS_NOMS[moisCourant - 1]} ${reference.getFullYear()}`;
  const sujet = `Factures impayées — ${periode} (${statsMois.nbFactures})`;

  const responsables = await responsablesDuTenant(tenantId);
  const destinataires = responsables.map((r) => r.email);

  const contenu = [
    `État des impayés au ${reference.toLocaleDateString("fr-FR")}.`,
    ``,
    `MOIS EN COURS — ${libelleMois}`,
    `• Factures impayées : ${statsMois.nbFactures} (${statsMois.nbEleves} élève(s))`,
    `• Reste à recouvrer : ${formaterMontant(statsMois.montantRestant, statsMois.devise)}`,
    ``,
    `ENSEMBLE DES IMPAYÉS (toutes échéances)`,
    `• Factures impayées : ${statsGlobal.nbFactures} (${statsGlobal.nbEleves} élève(s)), dont ${statsGlobal.nbEnRetard} en retard`,
    `• Montant facturé : ${formaterMontant(statsGlobal.montantTotal, statsGlobal.devise)}`,
    `• Déjà encaissé : ${formaterMontant(statsGlobal.montantEncaisse, statsGlobal.devise)}`,
    `• Reste à recouvrer : ${formaterMontant(statsGlobal.montantRestant, statsGlobal.devise)}`,
    `• Dont en retard (échéance dépassée) : ${formaterMontant(statsGlobal.montantEnRetard, statsGlobal.devise)}`,
    ``,
    `Les factures concernées restent au statut « impayée » jusqu'à l'encaissement complet.`,
    `Détail et encaissement : Facturation → Factures.`,
  ].join("\n");

  // L'alerte du 15 ne part QUE s'il reste des factures impayées pour le mois :
  // un mois entièrement encaissé n'entraîne aucun envoi.
  const rienAEnVoyer = statsMois.nbFactures === 0 || destinataires.length === 0 || sansEnvoi;
  if (rienAEnVoyer) {
    await audit({
      tenantId,
      action: "ALERTE_IMPAYES",
      verdict: "ALLOWED",
      resource: "Facture",
      reason: sujet,
      metadata: {
        libelleMois,
        statsMois,
        statsGlobal,
        destinataires: destinataires.length,
        emailEnvoye: false,
        motif: statsMois.nbFactures === 0 ? "aucun impayé sur le mois" : sansEnvoi ? "envoi désactivé" : "aucun destinataire",
      },
    });
    return {
      statsMois,
      statsGlobal,
      libelleMois,
      destinataires,
      sujet,
      emailEnvoye: false,
      alerteEnvoyee: false,
    };
  }

  const tenant = await prisma.tenant.findFirst({
    where: { id: tenantId },
    select: { name: true },
  });

  const resultat = await sendEmail(
    destinataires,
    `[${tenant?.name ?? "Établissement"}] ${sujet}`,
    renderNotificationEmail(tenant?.name ?? "École Miriam", sujet, contenu)
  );

  await audit({
    tenantId,
    action: "ALERTE_IMPAYES",
    verdict: "ALLOWED",
    resource: "Facture",
    reason: sujet,
    metadata: {
      libelleMois,
      statsMois,
      statsGlobal,
      destinataires: destinataires.length,
      emailEnvoye: resultat.success,
      erreurEmail: resultat.error ?? null,
    },
  });

  return {
    statsMois,
    statsGlobal,
    libelleMois,
    destinataires,
    sujet,
    emailEnvoye: resultat.success,
    erreurEmail: resultat.error,
    alerteEnvoyee: true,
  };
}
