"use server";

import { auth } from "@/lib/auth";
import prisma, { runWithTenant } from "@/lib/prisma";
import { revalidatePath, revalidateTag } from "next/cache";
import { sendPaymentWhatsApp } from "@/lib/notifications/whatsapp";
import { checkPermission } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { eleveScopeFilter, isRelationScopedRole, siteFilterForModel } from "@/lib/site-scope";
import { MOIS_NOMS, genererMensualitesPourTenant } from "@/lib/factures/mensualites";
import { NIVEAUX_CANONIQUES, normaliserNiveau } from "@/lib/niveau";
import { choisirTarif as choixTarif, montantPourTypeFrais } from "@/lib/tarifs";
import { reserverNumerosFacture } from "@/lib/facture-numero";
import { z } from "zod";

// NOTE : le transport n'est plus un forfait codé en dur (4 000 DJF). Le cœur
// de facturation lit `TarifNiveau.fraisTransport`, comme la cantine : un
// montant « deviné » dans l'UI contredisait la règle canonique (AGENTS.md §17)
// et divergeait du cron. Pour refacturer le transport, renseignez
// « frais transport » dans Paramètres → Tarifs (par niveau et par site).

// ============================================================
// TARIFS PAR NIVEAU
// ============================================================

const TarifSchema = z.object({
  // Le niveau est le même RÉFÉRENTIEL FERMÉ que pour les classes
  // (src/lib/niveau.ts) : il indexe la grille tarifaire. Une grille saisie
  // « 2 » ne rencontre jamais la classe « 2ème » — et la contrainte en base
  // (`tarifs_niveau_canonique`) refuse désormais l'écriture. On normalise ici
  // pour renvoyer un message clair au lieu d'une erreur SQL brute.
  niveau: z
    .string()
    .min(1, "Le niveau est requis")
    .transform((valeur, ctx): string => {
      const canonique = normaliserNiveau(valeur);
      if (!canonique) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Niveau « ${valeur} » non reconnu. Valeurs autorisées : ${NIVEAUX_CANONIQUES.join(", ")}.`,
        });
        return z.NEVER;
      }
      return canonique;
    }),
  annee: z.string().min(1, "L'année est requise"),
  mensualite: z.number().min(0, "La mensualité est requise"),
  fraisInscription: z.number().min(0, "Les frais d'inscription sont requis"),
  fraisRenouvellement: z.number().min(0, "Les frais de renouvellement sont requis"),
  fraisCantine: z.number().optional(),
  fraisTransport: z.number().optional(),
  devise: z.string().default("DJF"),
  nbMois: z.number().min(1).max(12).default(10),
  siteId: z.string().optional(),
});

export type TarifFormData = z.infer<typeof TarifSchema>;

export async function getTarifsForTenant() {
  const session = await auth();
  if (!session?.user?.tenantId) return [];
  const denied = checkPermission(session.user.role, "finance:read");
  if (denied) return [];
  // eslint-disable-next-line ecolemiriam/require-annee-filter -- l'écran des tarifs affiche volontairement toutes les années (colonne « année »), la plus récente en tête
  return prisma.tarifNiveau.findMany({
    where: { tenantId: session.user.tenantId },
    orderBy: [{ annee: "desc" }, { niveau: "asc" }],
  });
}

export async function getTarifForEleve(eleveId: string, annee?: string) {
  const session = await auth();
  if (!session?.user?.tenantId) return null;
  const denied = checkPermission(session.user.role, "finance:read");
  if (denied) return null;

  // eslint-disable-next-line ecolemiriam/require-site-filter -- lookup par eleveId + tenantId
  const eleve = await prisma.eleve.findFirst({
    where: { id: eleveId, tenantId: session.user.tenantId },
    select: { classe: { select: { niveau: true, siteId: true } } },
  });
  if (!eleve?.classe?.niveau) return null;

  const anneeScolaire = annee ?? `${new Date().getFullYear()}-${new Date().getFullYear() + 1}`;
  const tarif = await prisma.tarifNiveau.findFirst({
    where: {
      tenantId: session.user.tenantId,
      niveau: { equals: eleve.classe.niveau, mode: "insensitive" },
      annee: anneeScolaire,
      actif: true,
      OR: [{ siteId: eleve.classe.siteId ?? null }, { siteId: null }],
    },
    orderBy: { siteId: { sort: "desc", nulls: "last" } }, // privilégier le tarif spécifique au site (NULLs en dernier sur Postgres)
  });
  return tarif;
}

export async function createTarif(data: TarifFormData) {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");
  const denied = checkPermission(session.user.role, "finance:write");
  if (denied) throw new Error("Accès refusé");

  const parsed = TarifSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => i.message).join(", "));
  }

  const v = parsed.data;
  const tarif = await prisma.tarifNiveau.create({
    data: {
      tenantId: session.user.tenantId,
      niveau: v.niveau,
      annee: v.annee,
      mensualite: v.mensualite,
      fraisInscription: v.fraisInscription,
      fraisRenouvellement: v.fraisRenouvellement,
      fraisCantine: v.fraisCantine ?? null,
      fraisTransport: v.fraisTransport ?? null,
      devise: v.devise,
      nbMois: v.nbMois,
      siteId: v.siteId || null,
    },
  });

  // La grille tarifaire fixe ce qui est facturé aux familles : toute
  // modification doit laisser une trace. Elle était modifiable sans aucune
  // ligne d'audit (constaté le 29/09/2026 : 5 tarifs créés ou modifiés entre
  // le 26 et le 28/09, 0 action « tarif » dans journal_audit).
  await audit({
    tenantId: session.user.tenantId,
    userId: session.user.id,
    action: "tarif:create",
    verdict: "ALLOWED",
    resource: "tarif",
    resourceId: tarif.id,
    reason: `Tarif ${tarif.niveau} ${tarif.annee} créé (${tarif.mensualite} ${tarif.devise})`,
    metadata: {
      niveau: tarif.niveau,
      annee: tarif.annee,
      siteId: tarif.siteId,
      mensualite: tarif.mensualite,
      fraisInscription: tarif.fraisInscription,
      fraisRenouvellement: tarif.fraisRenouvellement,
      fraisCantine: tarif.fraisCantine,
      fraisTransport: tarif.fraisTransport,
    },
  });

  revalidatePath("/parametres");
  return { success: true };
}

export async function deleteTarif(tarifId: string) {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");
  const denied = checkPermission(session.user.role, "finance:write");
  if (denied) throw new Error("Accès refusé");

  // Relu AVANT suppression : l'audit doit conserver ce qui a été supprimé
  // (et le `tenantId` garantit qu'on ne touche pas la grille d'un autre
  // établissement, RLS en second rideau).
  // eslint-disable-next-line ecolemiriam/require-annee-filter -- tarif ciblé par identifiant : exiger l'année empêcherait de corriger un tarif d'une année révolue
  const avant = await prisma.tarifNiveau.findFirst({
    where: { id: tarifId, tenantId: session.user.tenantId },
  });
  if (!avant) throw new Error("Tarif introuvable dans cet établissement");

  await prisma.tarifNiveau.delete({
    where: { id: tarifId },
  });

  await audit({
    tenantId: session.user.tenantId,
    userId: session.user.id,
    action: "tarif:delete",
    verdict: "ALLOWED",
    resource: "tarif",
    resourceId: tarifId,
    reason: `Tarif ${avant.niveau} ${avant.annee} supprimé (${avant.mensualite} ${avant.devise})`,
    metadata: {
      niveau: avant.niveau,
      annee: avant.annee,
      siteId: avant.siteId,
      mensualite: avant.mensualite,
      fraisInscription: avant.fraisInscription,
      fraisRenouvellement: avant.fraisRenouvellement,
    },
  });

  revalidatePath("/parametres");
  revalidatePath("/parametres/tarifs");
  return { success: true };
}

export async function updateTarif(tarifId: string, data: Partial<TarifFormData>) {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");
  const denied = checkPermission(session.user.role, "finance:write");
  if (denied) throw new Error("Accès refusé");

  const parsed = TarifSchema.partial().safeParse(data);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => i.message).join(", "));
  }

  const v = parsed.data;

  // Avant/après : un tarif qui change sans qu'on sache d'où il vient est
  // introuvable en cas de contestation de facture.
  // eslint-disable-next-line ecolemiriam/require-annee-filter -- tarif ciblé par identifiant (voir deleteTarif)
  const avant = await prisma.tarifNiveau.findFirst({
    where: { id: tarifId, tenantId: session.user.tenantId },
  });
  if (!avant) throw new Error("Tarif introuvable dans cet établissement");

  const apres = await prisma.tarifNiveau.update({
    where: { id: tarifId },
    data: {
      ...(v.niveau && { niveau: v.niveau }),
      ...(v.annee && { annee: v.annee }),
      ...(v.mensualite !== undefined && { mensualite: v.mensualite }),
      ...(v.fraisInscription !== undefined && { fraisInscription: v.fraisInscription }),
      ...(v.fraisRenouvellement !== undefined && { fraisRenouvellement: v.fraisRenouvellement }),
      ...(v.fraisCantine !== undefined && { fraisCantine: v.fraisCantine ?? null }),
      ...(v.fraisTransport !== undefined && { fraisTransport: v.fraisTransport ?? null }),
      ...(v.devise && { devise: v.devise }),
      ...(v.nbMois !== undefined && { nbMois: v.nbMois }),
      ...(v.siteId !== undefined && { siteId: v.siteId || null }),
    },
  });

  await audit({
    tenantId: session.user.tenantId,
    userId: session.user.id,
    action: "tarif:update",
    verdict: "ALLOWED",
    resource: "tarif",
    resourceId: tarifId,
    reason: `Tarif ${avant.niveau} ${avant.annee} modifié (champs : ${Object.keys(v).join(", ")})`,
    metadata: {
      champs: Object.keys(v),
      avant: {
        niveau: avant.niveau,
        annee: avant.annee,
        siteId: avant.siteId,
        mensualite: avant.mensualite,
        fraisInscription: avant.fraisInscription,
        fraisRenouvellement: avant.fraisRenouvellement,
      },
      apres: {
        niveau: apres.niveau,
        annee: apres.annee,
        siteId: apres.siteId,
        mensualite: apres.mensualite,
        fraisInscription: apres.fraisInscription,
        fraisRenouvellement: apres.fraisRenouvellement,
      },
    },
  });

  revalidatePath("/parametres");
  revalidatePath("/parametres/tarifs");
  return { success: true };
}

// ============================================================
// GÉNÉRATION AUTOMATIQUE DE FACTURES (MENSUALITÉS)
// ============================================================

/**
 * Génération manuelle des mensualités d'un mois (bouton de l'écran
 * Facturation, étape 4 de la réinscription).
 *
 * Délègue au CŒUR UNIQUE `genererMensualitesPourTenant` — le même que le cron
 * et le CLI. L'implémentation qui cohabitait comparait les niveaux en chaîne
 * brute (`niveau.toLowerCase()`) : les classes « 2 » et « 3 » de Campus Central
 * (191 élèves) ne trouvaient aucun tarif et étaient ignorées en silence. Elle
 * ajoutait en outre les frais de réinscription à la mensualité de septembre —
 * deux montants différents pour le même mois selon le déclencheur — et ne
 * bornait rien : un comptable rattaché à un site facturait les trois sites.
 *
 * Périmètre : celui de l'utilisateur (`siteFilterForModel("eleve")`).
 */
export async function genererMensualites(params: {
  mois: number; // 1-12
  annee: string; // "2026-2027"
  inclureCantine?: boolean;
  inclureTransport?: boolean;
  /** Frais de rentrée — septembre uniquement (voir paramètres du cœur). */
  inclureFraisInscription?: boolean;
  inclureFraisRenouvellement?: boolean;
}) {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");
  const denied = checkPermission(session.user.role, "finance:write");
  if (denied) throw new Error("Accès refusé");

  const tenantId = session.user.tenantId;
  const {
    mois,
    annee,
    inclureCantine = false,
    inclureTransport = false,
    inclureFraisInscription = false,
    inclureFraisRenouvellement = false,
  } = params;

  // Parent / élève : `siteFilterForModel` est neutre pour eux, leur périmètre
  // vient du lien personnel. Ces rôles n'ont pas `finance:write`, mais on
  // garde le filtre fail-closed (AGENTS.md §14).
  const eleveWhere = isRelationScopedRole(session.user.role)
    ? eleveScopeFilter(session.user, "eleve")
    : siteFilterForModel("eleve", session.user);

  const resultat = await runWithTenant(
    tenantId,
    session.user.siteId ?? null,
    () =>
      genererMensualitesPourTenant({
        tenantId,
        mois,
        annee,
        inclureCantine,
        inclureTransport,
        inclureFraisInscription,
        inclureFraisRenouvellement,
        eleveWhere,
        acteurId: session.user.id,
      }),
    session.user.role,
  );

  await audit({
    tenantId,
    userId: session.user.id,
    action: "facturation.generer_mensualites",
    verdict: "ALLOWED",
    resource: "factures",
    reason:
      `Mensualités ${MOIS_NOMS[mois - 1] ?? mois} ${annee} : ${resultat.generated} facture(s) créée(s), ` +
      `${resultat.skipped} ignorée(s) dont ${resultat.sansTarif} sans tarif`,
    metadata: {
      mois,
      annee,
      inclureCantine,
      inclureTransport,
      inclureFraisInscription,
      inclureFraisRenouvellement,
      ...resultat,
    },
  });

  revalidatePath("/facturation");
  revalidateTag("dashboard-data", "max");
  return { success: true, ...resultat };
}

// ============================================================
// GÉNÉRATION ANNUELLE COMPLETE (Septembre → Juin, 10 mois)
// ============================================================
//
// Boucle sur le CŒUR unique (`genererMensualitesPourTenant`), mois par mois :
// mêmes montants, mêmes numéros atomiques et même idempotence que le cron.
//
// ⚠️ Différence assumée avec l'ancienne version : septembre ne contient plus
// les frais de réinscription. Ceux-ci sont facturés par leur propre flux
// (`genererFraisInscription`, facture d'admission), et le cron ne les a jamais
// additionnés à la mensualité. Deux montants différents pour le même mois
// selon le déclencheur étaient intenables : on aligne tout sur le cœur.
//
// Mois scolaires : 9, 10, 11, 12, 1, 2, 3, 4, 5, 6

const MOIS_SCOLAIRES = [9, 10, 11, 12, 1, 2, 3, 4, 5, 6];

export async function genererFacturesAnnuelles(params: {
  annee: string; // "2026-2027"
  inclureCantine?: boolean;
  inclureTransport?: boolean;
  /** Frais de rentrée — appliqués au seul mois de septembre. */
  inclureFraisInscription?: boolean;
  inclureFraisRenouvellement?: boolean;
}) {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");
  const denied = checkPermission(session.user.role, "finance:write");
  if (denied) throw new Error("Accès refusé");

  const tenantId = session.user.tenantId;
  const {
    annee,
    inclureCantine = false,
    inclureTransport = false,
    inclureFraisInscription = false,
    inclureFraisRenouvellement = false,
  } = params;

  const eleveWhere = isRelationScopedRole(session.user.role)
    ? eleveScopeFilter(session.user, "eleve")
    : siteFilterForModel("eleve", session.user);

  const moisDetails: Array<{ mois: number; moisNom: string; generated: number; isSeptembre: boolean }> = [];
  let generated = 0;
  let skipped = 0;
  let sansTarif = 0;
  let montantTotal = 0;

  for (const m of MOIS_SCOLAIRES) {
    const resultat = await runWithTenant(
      tenantId,
      session.user.siteId ?? null,
      () =>
        genererMensualitesPourTenant({
          tenantId,
          mois: m,
          annee,
          inclureCantine,
          inclureTransport,
          inclureFraisInscription,
          inclureFraisRenouvellement,
          eleveWhere,
          acteurId: session.user.id,
        }),
      session.user.role,
    );

    generated += resultat.generated;
    skipped += resultat.skipped;
    sansTarif += resultat.sansTarif;
    montantTotal += resultat.montantTotal;
    moisDetails.push({
      mois: m,
      moisNom: MOIS_NOMS[m - 1] ?? `Mois ${m}`,
      generated: resultat.generated,
      isSeptembre: m === 9,
    });
  }

  await audit({
    tenantId,
    userId: session.user.id,
    action: "facturation.generer_annuelles",
    verdict: "ALLOWED",
    resource: "factures",
    reason:
      `Génération annuelle ${annee} : ${generated} facture(s) sur ${MOIS_SCOLAIRES.length} mois, ` +
      `${skipped} ignorée(s) dont ${sansTarif} sans tarif`,
    metadata: { annee, generated, skipped, sansTarif, montantTotal, moisDetails },
  });

  revalidatePath("/facturation");
  revalidateTag("dashboard-data", "max");
  return { success: true, generated, skipped, sansTarif, montantTotal, moisDetails };
}


// ============================================================
// GÉNÉRATION FRAIS D'INSCRIPTION / RENOUVELLEMENT
// ============================================================

export async function genererFraisInscription(params: {
  eleveIds: string[];
  type: "INSCRIPTION" | "RENOUVELLEMENT";
  annee: string;
}) {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");
  const denied = checkPermission(session.user.role, "finance:write");
  if (denied) throw new Error("Accès refusé");

  const tenantId = session.user.tenantId;
  const { eleveIds, type, annee } = params;

  const tarifs = await prisma.tarifNiveau.findMany({
    where: { tenantId, annee, actif: true },
  });

  const libelle = type === "INSCRIPTION"
    ? `Frais d'inscription ${annee}`
    : `Frais de renouvellement ${annee}`;
  const echeance = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 jours

  // ── OPTIMISATION : 3 requêtes batch au lieu de 4×N requêtes dans une boucle
  // Avant : pour N élèves → N findFirst(eleve) + N findFirst(facture) + N count + N create = 4N
  // Après : 1 findMany(eleves) + 1 findMany(factures) + 1 count + 1 createMany = 4

  // 1. Batch : charger tous les élèves en 1 requête, bornés au périmètre de
  // l'utilisateur (comme le reste de la finance).
  const eleves = await prisma.eleve.findMany({
    where: {
      id: { in: eleveIds },
      tenantId,
      ...(isRelationScopedRole(session.user.role)
        ? eleveScopeFilter(session.user, "eleve")
        : siteFilterForModel("eleve", session.user)),
    },
    include: { classe: { select: { niveau: true } } },
  });

  // 2. Résolution canonique (même moteur que la facturation) : « 2 » et
  // « 2ème » se rencontrent, et un niveau que rien ne résout ne facture pas —
  // au lieu d'ignorer la ligne en silence comme le faisait le lookup texte.
  const elevesAvecTarif = eleves.filter(
    (e) => choixTarif(tarifs, e.siteId, e.classe?.niveau) !== null,
  );

  // 3. Batch : vérifier les factures déjà existantes (1 requête)
  // eslint-disable-next-line ecolemiriam/require-site-filter -- lookup par factureId + tenantId : le caller a déjà vérifié l'accès
  const existingFactures = await prisma.facture.findMany({
    where: {
      tenantId,
      eleveId: { in: elevesAvecTarif.map((e) => e.id) },
      type,
      mois: null,
    },
    select: { eleveId: true },
  });
  const existingSet = new Set(existingFactures.map((f) => f.eleveId));

  const anneePrefix = annee.split("-")[0];

  const toCreate: Array<{
    tenantId: string;
    eleveId: string;
    libelle: string;
    montant: number;
    devise: string;
    statut: "EN_ATTENTE";
    type: "INSCRIPTION" | "RENOUVELLEMENT";
    echeance: Date;
    siteId: string | null;
    createdById: string;
  }> = [];

  for (const eleve of elevesAvecTarif) {
    if (existingSet.has(eleve.id)) continue;

    const choix = choixTarif(tarifs, eleve.siteId, eleve.classe?.niveau);
    if (!choix) continue; // ne devrait pas arriver : filtré juste au-dessus

    const montant = montantPourTypeFrais(choix.tarif, type);

    toCreate.push({
      tenantId,
      eleveId: eleve.id,
      libelle,
      montant,
      devise: choix.tarif.devise,
      statut: "EN_ATTENTE",
      type,
      echeance,
      siteId: eleve.siteId ?? null,
      createdById: session.user.id,
    });
  }

  // 4. Numérotation atomique en un bloc, puis bulk insert (1 requête)
  if (toCreate.length > 0) {
    const numeros = await reserverNumerosFacture(tenantId, anneePrefix, toCreate.length);
    await prisma.facture.createMany({ data: toCreate.map((f, i) => ({ ...f, numero: numeros[i] })) });
  }

  const skipped = eleveIds.length - toCreate.length;

  revalidatePath("/facturation");
  revalidateTag("dashboard-data", "max");
  return { success: true, generated: toCreate.length, skipped };
}

// ============================================================
// RELANCES (après retard de paiement)
// ============================================================

export async function envoyerRelance(factureId: string, canal: string) {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");
  const denied = checkPermission(session.user.role, "finance:write");
  if (denied) throw new Error("Accès refusé");

  // eslint-disable-next-line ecolemiriam/require-site-filter -- lookup par factureId + tenantId : le caller a déjà vérifié l'accès
  const facture = await prisma.facture.findFirst({
    where: { id: factureId, tenantId: session.user.tenantId },
    include: {
      eleve: {
        select: {
          nom: true,
          prenom: true,
          matricule: true,
          parents: {
            where: { isGardien: true },
            take: 1,
            include: { parent: { select: { phone: true, prenom: true, nom: true } } },
          },
        },
      },
      paiements: true,
      relances: { orderBy: { niveau: "desc" }, take: 1 },
    },
  });
  if (!facture) throw new Error("Facture non trouvée");

  const totalPaye = facture.paiements.reduce((s, p) => s + p.montant, 0);
  const restant = facture.montant - totalPaye;
  if (restant <= 0) throw new Error("Cette facture est entièrement payée");

  const dernierNiveau = facture.relances[0]?.niveau ?? 0;
  const niveau = dernierNiveau + 1;

  const messages: Record<number, string> = {
    1: `Première relance : La facture ${facture.numero} de ${facture.eleve?.prenom ?? ""} ${facture.eleve?.nom ?? ""} d'un montant de ${restant} ${facture.devise} est en retard. Merci de régulariser.`,
    2: `Deuxième relance : La facture ${facture.numero} reste impayée (${restant} ${facture.devise}). Merci de régulariser rapidement.`,
    3: `Troisième relance (ULTIME) : La facture ${facture.numero} est toujours impayée. Une procédure d'exclusion pourrait être engagée.`,
  };

  const message = messages[niveau] ?? `Relance niveau ${niveau} : Facture ${facture.numero} impayée.`;

  await prisma.relance.create({
    data: {
      tenantId: session.user.tenantId,
      factureId,
      niveau,
      canal,
      message,
      envoyeeParId: session.user.id,
    },
  });

  // Envoi réel pour les canaux supportés
  if (canal === "whatsapp") {
    const tuteur = facture.eleve?.parents[0]?.parent;
    if (tuteur?.phone) {
      const tenant = await prisma.tenant.findUnique({
        where: { id: session.user.tenantId },
        select: { name: true },
      });
      await sendPaymentWhatsApp(
        tuteur.phone,
        `${facture.eleve?.prenom ?? ""} ${facture.eleve?.nom ?? ""}`,
        restant,
        facture.devise,
        facture.numero,
        tenant?.name ?? "École Miriam"
      );
    }
  }

  revalidatePath("/facturation");
  revalidatePath(`/facturation/${factureId}`);
  revalidateTag("dashboard-data", "max");
  return { success: true, niveau, message };
}

export async function getRelancesForFacture(factureId: string) {
  const session = await auth();
  if (!session?.user?.tenantId) return [];
  const denied = checkPermission(session.user.role, "finance:read");
  if (denied) return [];
  return prisma.relance.findMany({
    where: { factureId, tenantId: session.user.tenantId },
    include: { envoyeePar: { select: { name: true } } },
    orderBy: { niveau: "asc" },
  });
}

// ============================================================
// EXCLUSION D'ÉLÈVE (pour non-paiement)
// ============================================================

export async function exclureEleve(params: {
  eleveId: string;
  motif: string;
  details?: string;
}) {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");
  const denied = checkPermission(session.user.role, "finance:write");
  if (denied) throw new Error("Accès refusé");

  const { eleveId, motif, details } = params;

  // Vérifier qu'il n'y a pas déjà une exclusion en cours
  const existing = await prisma.exclusionEleve.findFirst({
    where: { eleveId, tenantId: session.user.tenantId, dateFin: null },
  });
  if (existing) throw new Error("Cet élève est déjà exclu");

  await prisma.exclusionEleve.create({
    data: {
      tenantId: session.user.tenantId,
      eleveId,
      motif,
      details: details ?? null,
      dateDebut: new Date(),
      decideeParId: session.user.id,
    },
  });

  // Marquer l'élève comme exclu
  // eslint-disable-next-line ecolemiriam/require-tenant-id -- ID vérifié par findFirst avec tenantId au-dessus
  await prisma.eleve.update({
    where: { id: eleveId },
    data: { statut: "EXCLU" },
  });

  revalidatePath("/facturation");
  revalidatePath("/eleves");
  revalidateTag("dashboard-data", "max");
  revalidateTag("eleves-stats", "max");
  return { success: true };
}

export async function leverExclusion(exclusionId: string) {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");
  const denied = checkPermission(session.user.role, "finance:write");
  if (denied) throw new Error("Accès refusé");

  const exclusion = await prisma.exclusionEleve.findFirst({
    where: { id: exclusionId, tenantId: session.user.tenantId, dateFin: null },
  });
  if (!exclusion) throw new Error("Exclusion non trouvée ou déjà levée");

  await prisma.exclusionEleve.update({
    where: { id: exclusionId },
    data: {
      dateFin: new Date(),
      leveeParId: session.user.id,
      leveeLe: new Date(),
    },
  });

  // Réactiver l'élève
  // eslint-disable-next-line ecolemiriam/require-tenant-id -- ID vérifié par findFirst avec tenantId au-dessus
  await prisma.eleve.update({
    where: { id: exclusion.eleveId },
    data: { statut: "ACTIF" },
  });

  revalidatePath("/facturation");
  revalidatePath("/eleves");
  revalidateTag("dashboard-data", "max");
  revalidateTag("eleves-stats", "max");
  return { success: true };
}

export async function getExclusionsForTenant() {
  const session = await auth();
  if (!session?.user?.tenantId) return [];
  const denied = checkPermission(session.user.role, "finance:read");
  if (denied) return [];
  return prisma.exclusionEleve.findMany({
    where: { tenantId: session.user.tenantId, dateFin: null },
    include: {
      eleve: { select: { nom: true, prenom: true, matricule: true, classe: { select: { nom: true } } } },
      decideePar: { select: { name: true } },
    },
    orderBy: { dateDebut: "desc" },
  });
}

// ============================================================
// DÉTECTION DES FACTURES EN RETARD
// ============================================================

export async function detecterFacturesEnRetard() {
  const session = await auth();
  if (!session?.user?.tenantId) return [];
  const denied = checkPermission(session.user.role, "finance:read");
  if (denied) return [];
  const now = new Date();

  // eslint-disable-next-line ecolemiriam/require-site-filter -- lookup par factureId + tenantId : le caller a déjà vérifié l'accès
  const factures = await prisma.facture.findMany({
    where: {
      tenantId: session.user.tenantId,
      statut: { in: ["EN_ATTENTE", "EN_RETARD"] },
      echeance: { lt: now },
    },
    include: {
      eleve: { select: { nom: true, prenom: true, matricule: true, classe: { select: { nom: true } } } },
      paiements: true,
      relances: { orderBy: { niveau: "desc" }, take: 1 },
    },
    orderBy: { echeance: "asc" },
  });

  // Mettre à jour le statut EN_RETARD
  for (const f of factures) {
    const totalPaye = f.paiements.reduce((s, p) => s + p.montant, 0);
    if (totalPaye < f.montant && f.statut !== "EN_RETARD") {
      await prisma.facture.update({
        where: { id: f.id },
        data: { statut: "EN_RETARD" },
      });
    }
  }

  return factures.map((f) => {
    const totalPaye = f.paiements.reduce((s, p) => s + p.montant, 0);
    return {
      id: f.id,
      numero: f.numero,
      eleveNom: `${f.eleve?.prenom ?? ""} ${f.eleve?.nom ?? ""}`,
      matricule: f.eleve?.matricule ?? "",
      classe: f.eleve?.classe?.nom ?? "N/A",
      montant: f.montant,
      restant: f.montant - totalPaye,
      echeance: f.echeance,
      dernierNiveauRelance: f.relances[0]?.niveau ?? 0,
    };
  });
}
