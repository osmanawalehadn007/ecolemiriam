"use server";

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { revalidatePath, revalidateTag } from "next/cache";
import { sendPaymentWhatsApp } from "@/lib/notifications/whatsapp";
import { siteFilterForModel } from "@/lib/site-scope";
import { getAnneeCouranteLibelle } from "@/lib/annee-scolaire";
import { choisirTarif, montantPourTypeFrais, type TypeFrais } from "@/lib/tarifs";
import { genererMensualitesPourTenant } from "@/lib/factures/mensualites";
import { z } from "zod";

// ============================================================
// TARIFS PAR NIVEAU
// ============================================================

const TarifSchema = z.object({
  niveau: z.string().min(1, "Le niveau est requis"),
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
  return prisma.tarifNiveau.findMany({
    // `tarifNiveau` est un modèle « partagé » : un tarif sans site (tarif
    // global, hérité par tous les sites) reste visible d'un compte site-scopé,
    // en plus des tarifs propres à ses sites.
    where: { tenantId: session.user.tenantId, ...siteFilterForModel("tarifNiveau", session.user) },
    include: { site: { select: { id: true, nom: true, code: true } } },
    orderBy: [{ annee: "desc" }, { siteId: "asc" }, { niveau: "asc" }],
  });
}

export async function createTarif(data: TarifFormData) {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");
  if (session.user.role !== "TENANT_ADMIN" && session.user.role !== "SUPER_ADMIN" && session.user.role !== "PRINCIPAL") {
    throw new Error("Permissions insuffisantes");
  }

  const parsed = TarifSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => i.message).join(", "));
  }

  const v = parsed.data;

  // `siteId` vient du formulaire : la clé étrangère `Site` est globale, donc un
  // tarif pouvait être rattaché au site d'un autre établissement. On vérifie
  // l'appartenance au tenant ET au périmètre de l'utilisateur.
  if (v.siteId) {
    const isAdmin = session.user.role === "TENANT_ADMIN" || session.user.role === "SUPER_ADMIN";
    const site = await prisma.site.findFirst({
      where: {
        id: v.siteId,
        tenantId: session.user.tenantId,
        deletedAt: null,
        ...(isAdmin ? {} : { userSites: { some: { userId: session.user.id } } }),
      },
      select: { id: true },
    });
    if (!site) throw new Error("Site introuvable ou hors de votre périmètre");
  }

  await prisma.tarifNiveau.create({
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

  revalidatePath("/parametres");
  return { success: true };
}

export async function deleteTarif(tarifId: string) {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");
  if (session.user.role !== "TENANT_ADMIN" && session.user.role !== "SUPER_ADMIN" && session.user.role !== "PRINCIPAL") {
    throw new Error("Permissions insuffisantes");
  }

  // Suppression par identifiant : on vérifie d'abord que le tarif appartient au
  // tenant et au périmètre de sites (un tarif peut être propre à un site).
  const tarif = await prisma.tarifNiveau.findFirst({
    where: { id: tarifId, tenantId: session.user.tenantId, ...siteFilterForModel("tarifNiveau", session.user) },
    select: { id: true },
  });
  if (!tarif) throw new Error("Tarif introuvable ou hors de votre périmètre");

  await prisma.tarifNiveau.delete({
    where: { id: tarif.id },
  });

  revalidatePath("/parametres");
  return { success: true };
}

// ============================================================
// GÉNÉRATION AUTOMATIQUE DE FACTURES (MENSUALITÉS)
// ============================================================

export async function genererMensualites(params: {
  mois: number; // 1-12
  annee: string; // "2025-2026"
  inclureCantine?: boolean;
  inclureTransport?: boolean;
}) {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");
  if (session.user.role !== "TENANT_ADMIN" && session.user.role !== "SUPER_ADMIN" && session.user.role !== "PRINCIPAL") {
    throw new Error("Permissions insuffisantes");
  }

  // Délégation au cœur partagé (`src/lib/factures/mensualites.ts`), également
  // utilisé par le cron de début de mois. Le périmètre de sites de
  // l'utilisateur est transmis en fragments de `where` ; les tarifs globaux
  // (`siteId = null`) restent visibles d'un compte site-scopé.
  const resultat = await genererMensualitesPourTenant({
    tenantId: session.user.tenantId,
    mois: params.mois,
    annee: params.annee,
    inclureCantine: params.inclureCantine,
    inclureTransport: params.inclureTransport,
    eleveWhere: siteFilterForModel("eleve", session.user),
    tarifWhere: siteFilterForModel("tarifNiveau", session.user),
    acteurId: session.user.id,
  });

  revalidatePath("/facturation");
  revalidateTag("dashboard-data");
  return { success: true, ...resultat };
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
  if (session.user.role !== "TENANT_ADMIN" && session.user.role !== "SUPER_ADMIN" && session.user.role !== "PRINCIPAL") {
    throw new Error("Permissions insuffisantes");
  }

  const tenantId = session.user.tenantId;
  const { eleveIds, type, annee } = params;

  const tarifs = await prisma.tarifNiveau.findMany({
    where: {
      tenantId,
      actif: true,
      ...siteFilterForModel("tarifNiveau", session.user),
    },
  });
  // Tarifs regroupés par année scolaire (la classe porte la sienne).
  const tarifsParAnnee = new Map<string, typeof tarifs>();
  for (const t of tarifs) {
    const liste = tarifsParAnnee.get(t.annee);
    if (liste) liste.push(t);
    else tarifsParAnnee.set(t.annee, [t]);
  }

  let count = 0;
  let skipped = 0;
  let sansTarif = 0;

  for (const eleveId of eleveIds) {
    // `eleveIds` vient de l'appelant : sans filtre de site, on pouvait facturer
    // des élèves d'un autre site du même établissement.
    const eleve = await prisma.eleve.findFirst({
      where: { id: eleveId, tenantId, ...siteFilterForModel("eleve", session.user) },
      include: { classe: { select: { niveau: true, annee: true } } },
    });
    if (!eleve) { skipped++; continue; }

    // Tarif du site de l'élève, sinon tarif global (rapprochement canonique).
    const choix = choisirTarif(
      tarifsParAnnee.get(eleve.classe?.annee ?? annee) ?? tarifs,
      eleve.siteId,
      eleve.classe?.niveau
    );
    if (!choix) { sansTarif++; skipped++; continue; }
    const tarif = choix.tarif;

    const libelle = type === "INSCRIPTION"
      ? `Frais d'inscription ${annee}`
      : `Frais de renouvellement ${annee}`;

    // Vérifier si déjà facturé
    const existing = await prisma.facture.findFirst({
      where: { tenantId, eleveId, libelle, ...siteFilterForModel("facture", session.user) },
      select: { id: true },
    });
    if (existing) { skipped++; continue; }

    const montant = montantPourTypeFrais(tarif, type);
    // Numérotation tenant-wide (unicité du numéro pour tout l'établissement) :
    // seul un NOMBRE est lu, aucune donnée d'un autre site n'est exposée.
    // eslint-disable-next-line ecolpro/require-site-filter
    const factureCount = await prisma.facture.count({ where: { tenantId } });
    const numero = `FAC-${annee.split("-")[0]}-${String(factureCount + 1).padStart(5, "0")}`;

    await prisma.facture.create({
      data: {
        tenantId,
        // Rattachée au site de l'élève (sinon invisible dans les vues filtrées).
        siteId: eleve.siteId,
        eleveId,
        numero,
        libelle,
        montant,
        devise: tarif.devise,
        statut: "EN_ATTENTE",
        // Type tracé pour le dédoublonnage annuel ; `mois` reste vide : les
        // frais d'inscription ne relèvent pas du verrou mensuel.
        type,
        mois: null,
        echeance: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 jours
        createdById: session.user.id,
      },
    });
    count++;
  }

  revalidatePath("/facturation");
  revalidateTag("dashboard-data");
  return { success: true, generated: count, skipped, sansTarif };
}

/**
 * Frais d'inscription / renouvellement pour TOUS les élèves du périmètre.
 * `genererFraisInscription` exige une liste d'élèves ; l'écran Facturation
 * raisonne sur l'ensemble des élèves actifs — d'où cette enveloppe, qui
 * applique le même périmètre de sites que le reste de la facturation.
 */
export async function genererFraisInscriptionPourTous(params: {
  type: "INSCRIPTION" | "RENOUVELLEMENT";
  annee: string;
}) {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");
  if (session.user.role !== "TENANT_ADMIN" && session.user.role !== "SUPER_ADMIN" && session.user.role !== "PRINCIPAL") {
    throw new Error("Permissions insuffisantes");
  }

  const eleves = await prisma.eleve.findMany({
    where: {
      tenantId: session.user.tenantId,
      statut: "ACTIF",
      deletedAt: null,
      ...siteFilterForModel("eleve", session.user),
    },
    select: { id: true },
  });

  return genererFraisInscription({
    eleveIds: eleves.map((e) => e.id),
    type: params.type,
    annee: params.annee,
  });
}

// ============================================================
// TARIF APPLICABLE À UN ÉLÈVE (remplissage du formulaire de facture)
// ============================================================

export interface TarifEleve {
  montant: number;
  devise: string;
  /** Niveau de la classe de l'élève (« 1 », « 1ère », « 6ème »…). */
  niveau: string;
  /** `SITE` = tarif propre au site de l'élève, `GLOBAL` = tarif hérité. */
  source: "SITE" | "GLOBAL";
  /** Vrai si le tarif appliqué est celui du site de l'élève. */
  propreAuSite: boolean;
  type: TypeFrais;
}

/**
 * Tarif à appliquer à un élève, lu dans la grille du niveau de sa classe.
 * C'est ce que le formulaire de facture appelle pour pré-remplir le montant,
 * et ce que `createFacture` réapplique côté serveur (`typeFrais` transmis).
 */
export async function getTarifPourEleve(
  eleveId: string,
  type: TypeFrais = "MENSUALITE"
): Promise<TarifEleve | null> {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");

  const tenantId = session.user.tenantId;
  if (!eleveId) return null;

  const eleve = await prisma.eleve.findFirst({
    where: { id: eleveId, tenantId, ...siteFilterForModel("eleve", session.user) },
    select: { siteId: true, classe: { select: { niveau: true, annee: true } } },
  });
  if (!eleve) return null;

  const niveau = eleve.classe?.niveau ?? null;
  if (!niveau) return null;

  const annee =
    eleve.classe?.annee ?? (await getAnneeCouranteLibelle(tenantId)) ?? null;

  const tarifs = await prisma.tarifNiveau.findMany({
    where: {
      tenantId,
      actif: true,
      ...(annee ? { annee } : {}),
      ...siteFilterForModel("tarifNiveau", session.user),
    },
  });

  const choix = choisirTarif(tarifs, eleve.siteId, niveau);
  if (!choix) return null;

  return {
    montant: montantPourTypeFrais(choix.tarif, type),
    devise: choix.tarif.devise,
    niveau,
    source: choix.source,
    propreAuSite: choix.source === "SITE",
    type,
  };
}

// ============================================================
// RELANCES (après retard de paiement)
// ============================================================

export async function envoyerRelance(factureId: string, canal: string) {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");
  if (session.user.role !== "TENANT_ADMIN" && session.user.role !== "SUPER_ADMIN" && session.user.role !== "PRINCIPAL" && session.user.role !== "ACCOUNTANT") {
    throw new Error("Permissions insuffisantes");
  }

  const facture = await prisma.facture.findFirst({
    where: {
      id: factureId,
      tenantId: session.user.tenantId,
      ...siteFilterForModel("facture", session.user),
    },
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
    1: `Première relance : La facture ${facture.numero} de ${facture.eleve.prenom} ${facture.eleve.nom} d'un montant de ${restant} ${facture.devise} est en retard. Merci de régulariser.`,
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
    const tuteur = facture.eleve.parents[0]?.parent;
    if (tuteur?.phone) {
      const tenant = await prisma.tenant.findUnique({
        where: { id: session.user.tenantId },
        select: { name: true },
      });
      await sendPaymentWhatsApp(
        tuteur.phone,
        `${facture.eleve.prenom} ${facture.eleve.nom}`,
        restant,
        facture.devise,
        facture.numero,
        tenant?.name ?? "EcolPro"
      );
    }
  }

  revalidatePath("/facturation");
  revalidatePath(`/facturation/${factureId}`);
  revalidateTag("dashboard-data");
  return { success: true, niveau, message };
}

export async function getRelancesForFacture(factureId: string) {
  const session = await auth();
  if (!session?.user?.tenantId) return [];
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
  if (session.user.role !== "TENANT_ADMIN" && session.user.role !== "SUPER_ADMIN" && session.user.role !== "PRINCIPAL") {
    throw new Error("Permissions insuffisantes");
  }

  const { eleveId, motif, details } = params;

  // `eleveId` vient de l'appelant : contrôle d'appartenance au périmètre AVANT
  // toute écriture (la ligne précédente ne l'exécutait pas et permettait
  // d'exclure un élève d'un autre site).
  const eleveCible = await prisma.eleve.findFirst({
    where: { id: eleveId, tenantId: session.user.tenantId, ...siteFilterForModel("eleve", session.user) },
    select: { id: true },
  });
  if (!eleveCible) throw new Error("Élève introuvable ou hors de votre périmètre");

  // Vérifier qu'il n'y a pas déjà une exclusion en cours
  const existing = await prisma.exclusionEleve.findFirst({
    where: {
      eleveId,
      tenantId: session.user.tenantId,
      dateFin: null,
      ...siteFilterForModel("exclusionEleve", session.user),
    },
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
  await prisma.eleve.update({
    where: { id: eleveCible.id },
    data: { statut: "EXCLU" },
  });

  revalidatePath("/facturation");
  revalidatePath("/eleves");
  revalidateTag("dashboard-data");
  revalidateTag("eleves-stats");
  return { success: true };
}

export async function leverExclusion(exclusionId: string) {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");
  if (session.user.role !== "TENANT_ADMIN" && session.user.role !== "SUPER_ADMIN" && session.user.role !== "PRINCIPAL") {
    throw new Error("Permissions insuffisantes");
  }

  const exclusion = await prisma.exclusionEleve.findFirst({
    where: {
      id: exclusionId,
      tenantId: session.user.tenantId,
      dateFin: null,
      ...siteFilterForModel("exclusionEleve", session.user),
    },
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

  // Réactiver l'élève — l'exclusion validée porte l'élève, on revérifie
  // néanmoins son appartenance au périmètre avant d'écrire.
  const eleveCible = await prisma.eleve.findFirst({
    where: {
      id: exclusion.eleveId,
      tenantId: session.user.tenantId,
      ...siteFilterForModel("eleve", session.user),
    },
    select: { id: true },
  });
  if (eleveCible) {
    await prisma.eleve.update({
      where: { id: eleveCible.id },
      data: { statut: "ACTIF" },
    });
  }

  revalidatePath("/facturation");
  revalidatePath("/eleves");
  revalidateTag("dashboard-data");
  revalidateTag("eleves-stats");
  return { success: true };
}

export async function getExclusionsForTenant() {
  const session = await auth();
  if (!session?.user?.tenantId) return [];
  return prisma.exclusionEleve.findMany({
    where: {
      tenantId: session.user.tenantId,
      dateFin: null,
      ...siteFilterForModel("exclusionEleve", session.user),
    },
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
  const now = new Date();

  const factures = await prisma.facture.findMany({
    where: {
      tenantId: session.user.tenantId,
      statut: { in: ["EN_ATTENTE", "EN_RETARD"] },
      echeance: { lt: now },
      ...siteFilterForModel("facture", session.user),
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
      eleveNom: `${f.eleve.prenom} ${f.eleve.nom}`,
      matricule: f.eleve.matricule,
      classe: f.eleve.classe?.nom ?? "N/A",
      montant: f.montant,
      restant: f.montant - totalPaye,
      echeance: f.echeance,
      dernierNiveauRelance: f.relances[0]?.niveau ?? 0,
    };
  });
}
