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
import { reserverNumeroFacture } from "@/lib/facture-numero";
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
 * Mois de rentrée (premier mois de l'année scolaire) : seul mois pour lequel
 * les frais d'inscription / de réinscription peuvent être ajoutés à la
 * mensualité, et seulement sur demande explicite de l'appelant.
 */
export const MOIS_RENTREE = 9;

/**
 * Délai de paiement d'une mensualité : elle est due le 10 du mois facturé.
 * L'échéance suivait auparavant le dernier jour du mois (~30 jours), ce qui
 * retardait d'autant les relances automatiques (calées sur l'échéance).
 */
export const JOUR_ECHEANCE_MENSUALITE = 10;

/**
 * Échéance d'une mensualité : le 10 du mois facturé. Année scolaire
 * « 2026-2027 » : septembre à décembre tombent en 2026, janvier à août en 2027
 * (sinon une mensualité de janvier naîtrait déjà échue, donc « en retard »).
 * Une année simple (« 2026 ») est prise telle quelle.
 */
export function echeanceMensualite(mois: number, annee: string): Date {
  const [debut, fin] = annee.split("-").map((a) => parseInt(a, 10));
  const anneeCivile = fin && mois < MOIS_RENTREE ? fin : debut;
  return new Date(anneeCivile, mois - 1, JOUR_ECHEANCE_MENSUALITE);
}

/**
 * Libellés acceptés pour une échéance mensuelle. L'ancienne génération écrivait
 * « Scolarité Septembre 2026 » (année seule) et la nouvelle
 * « Scolarité Septembre 2026-2027 » : les deux doivent être reconnus pour que
 * la génération reste idempotente et ne crée pas de facture en double.
 *
 * On y ajoute les variantes enrichies des frais de rentrée
 * (« Scolarité Septembre 2026-2027 + Frais de réinscription »), écrites par
 * l'écran Facturation ou par les versions antérieures.
 *
 * Ces libellés ne sont qu'une OPTIMISATION de lecture : le verrou d'unicité
 * réel reste l'index partiel `factures_unicite_mensuelle`.
 */
export function libellesMensualite(mois: number, annee: string): string[] {
  const moisNom = MOIS_NOMS[mois - 1] ?? `Mois ${mois}`;
  const debutAnnee = annee.split("-")[0];
  const base = [`Scolarité ${moisNom} ${annee}`];
  if (debutAnnee && debutAnnee !== annee) base.push(`Scolarité ${moisNom} ${debutAnnee}`);
  return [
    ...base,
    ...base.flatMap((b) => [
      `${b} + Frais d'inscription`,
      `${b} + Frais de réinscription`,
      `${b} + Frais d'inscription + Frais de réinscription`,
    ]),
  ];
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

/**
 * Préfixe de numérotation d'une année scolaire : « 2026-2027 » → « 2026 ».
 *
 * Le numéro lui-même est réservé ATROUILLEMENT en base via
 * `reserverNumeroFacture` (src/lib/facture-numero.ts, PR #27) : la fonction SQL
 * `next_facture_numeros` réserve un bloc sous verrou pour tout l'établissement.
 * L'ancien `prisma.facture.count() + 1` passait par RLS (chaque site repartait
 * de sa propre séquence) et n'était pas atomique — 322 factures pour 257
 * numéros distincts constatés le 27/09/2026.
 */
export function prefixeNumero(annee: string): string {
  return annee.split("-")[0];
}

export interface GenerationMensualitesParams {
  tenantId: string;
  /** 1 à 12. */
  mois: number;
  /** Année scolaire « 2026-2027 ». */
  annee: string;
  inclureCantine?: boolean;
  inclureTransport?: boolean;
  /**
   * MOIS DE RENTRÉE UNIQUEMENT (septembre) : ajouter les frais d'inscription
   * et/ou de réinscription du niveau à la mensualité.
   *
   * Ce choix est EXPLICITE et non automatique : les frais de rentrée ne sont
   * pas facturés par le cron (une famille qui règle l'inscription à
   * l'admission ne doit pas être facturée deux fois), et l'établissement peut
   * préférer les facturer par leur propre flux
   * (`genererFraisInscription`, facture d'admission). Ignorés pour tout autre
   * mois que septembre.
   */
  inclureFraisInscription?: boolean;
  inclureFraisRenouvellement?: boolean;
  /** Fragment de périmètre appliqué aux élèves (sites de l'utilisateur). */
  eleveWhere?: Record<string, unknown>;
  /** Fragment de périmètre appliqué à la grille tarifaire. */
  tarifWhere?: Record<string, unknown>;
  /** Utilisateur à l'origine de la génération ; `null` = tâche planifiée. */
  acteurId?: string | null;
  /**
   * APERÇU : calcule exactement ce qui SERAIT créé (nombre de factures, montant
   * total, élèves ignorés ou sans tarif) **sans écrire** — aucune facture, aucune
   * réservation de numéro, aucune entrée d'audit. C'est le mode utilisé par
   * `?dry=1` du cron et par l'aperçu du CLI : l'exploitant doit voir les
   * chiffres réels avant la première génération, pas des zéros.
   */
  dryRun?: boolean;
}

export interface GenerationMensualitesResultat {
  /** Factures créées — ou, en mode `dryRun`, factures qui SERAIENT créées. */
  generated: number;
  /** Élèves ignorés (facture du mois déjà présente, ou sans tarif). */
  skipped: number;
  /** Dont élèves sans tarif pour leur niveau. */
  sansTarif: number;
  /** Montant total des factures créées (ou projeté en `dryRun`). */
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
    inclureFraisInscription = false,
    inclureFraisRenouvellement = false,
    eleveWhere = {},
    tarifWhere = {},
    acteurId = null,
    dryRun = false,
  } = params;

  if (!Number.isInteger(mois) || mois < 1 || mois > 12) {
    throw new Error("Mois invalide (1 à 12 attendu)");
  }

  // Les frais de rentrée ne s'appliquent QU'À septembre (premier mois de
  // l'année scolaire), et seulement si l'appelant les a demandés.
  const estRentree = mois === MOIS_RENTREE;
  const fraisRentree: string[] = [];
  if (estRentree && inclureFraisInscription) fraisRentree.push("Frais d'inscription");
  if (estRentree && inclureFraisRenouvellement) fraisRentree.push("Frais de réinscription");

  const libelleBase = libelleMensualite(mois, annee);
  const libelle = fraisRentree.length > 0 ? `${libelleBase} + ${fraisRentree.join(" + ")}` : libelleBase;
  const libellesDedoublonnage = libellesMensualite(mois, annee);
  const cleMois = moisKey(mois, annee);

  /* eslint-disable ecolemiriam/require-site-filter -- `eleveWhere`/`tarifWhere` sont construits par l'appelant via siteFilterForModel(...) (action serveur) ou laissés vides pour un traitement tenant-wide assumé (cron protégé par CRON_SECRET). */
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
  // Quatre repères sont testés — le mois structuré (`type` + `mois`) pour la
  // mensualité ET pour l'inscription, plus les conventions de libellé
  // historiques — pour couvrir les factures créées par les versions
  // antérieures (mois vide) ou par l'appel manuel.
  //
  // L'inscription du mois compte : le flux d'admission facture
  // « Frais d'inscription + Scolarité Septembre » en UNE facture
  // (`type=INSCRIPTION, mois=2026-09`). Sans ce repère, la génération de
  // septembre recréait une mensualité pour ces élèves — double facturation
  // constatée sur 4 dossiers le 29/09/2026.
  const facturesExistantes = await prisma.facture.findMany({
    where: {
      tenantId,
      statut: { not: "ANNULEE" },
      eleveId: { in: eleves.map((e) => e.id) },
      OR: [
        { type: "MENSUALITE", mois: cleMois },
        { type: "INSCRIPTION", mois: cleMois },
        { libelle: { in: libellesDedoublonnage } },
      ],
    },
    select: { eleveId: true },
  });
  /* eslint-enable ecolemiriam/require-site-filter */
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

    // Montant lu dans la grille tarifaire (mensualité + options demandées),
    // augmenté des frais de rentrée si l'appelant les a explicitement demandés
    // et que l'on facture septembre.
    const montant =
      montantMensuel(choix.tarif, {
        cantine: inclureCantine,
        transport: inclureTransport,
      }) +
      (estRentree
        ? (inclureFraisInscription ? choix.tarif.fraisInscription : 0) +
          (inclureFraisRenouvellement ? choix.tarif.fraisRenouvellement : 0)
        : 0);

    // Aperçu : on s'arrête AVANT toute écriture (pas de numéro réservé, pas de
    // facture, pas d'audit) — les compteurs reflètent ce qui serait créé.
    if (dryRun) {
      generated++;
      montantTotal += montant;
      continue;
    }

    const echeance = echeanceMensualite(mois, annee);
    const numero = await reserverNumeroFacture(tenantId, prefixeNumero(annee));

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
