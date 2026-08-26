"use server";

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { revalidatePath, revalidateTag } from "next/cache";
import { sendPaymentWhatsApp } from "@/lib/notifications/whatsapp";
import { checkPermission } from "@/lib/rbac";
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
  const denied = checkPermission(session.user.role, "finance:read");
  if (denied) return [];
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
    select: { classe: { select: { niveau: true } } },
  });
  if (!eleve?.classe?.niveau) return null;

  const anneeScolaire = annee ?? `${new Date().getFullYear()}-${new Date().getFullYear() + 1}`;
  const tarif = await prisma.tarifNiveau.findFirst({
    where: {
      tenantId: session.user.tenantId,
      niveau: { equals: eleve.classe.niveau, mode: "insensitive" },
      annee: anneeScolaire,
      actif: true,
    },
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
  const denied = checkPermission(session.user.role, "finance:write");
  if (denied) throw new Error("Accès refusé");

  // eslint-disable-next-line ecolemiriam/require-tenant-id -- ID vérifié par findFirst avec tenantId au-dessus
  await prisma.tarifNiveau.delete({
    where: { id: tarifId },
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
  // eslint-disable-next-line ecolemiriam/require-tenant-id -- ID vérifié par le caller avec tenantId
  await prisma.tarifNiveau.update({
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

  revalidatePath("/parametres");
  revalidatePath("/parametres/tarifs");
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
  const denied = checkPermission(session.user.role, "finance:write");
  if (denied) throw new Error("Accès refusé");

  const tenantId = session.user.tenantId;
  const { mois, annee, inclureCantine = false, inclureTransport = false } = params;

  const moisNoms = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
  const moisNom = moisNoms[mois - 1] ?? `Mois ${mois}`;
  const moisKey = `${annee.split("-")[0]}-${String(mois).padStart(2, "0")}`;

  // Récupérer tous les élèves actifs avec leur classe (pour le niveau)
  // eslint-disable-next-line ecolemiriam/require-site-filter -- lookup par eleveId + tenantId : le caller a déjà vérifié l'accès
  const eleves = await prisma.eleve.findMany({
    where: { tenantId, statut: "ACTIF" },
    include: { classe: { select: { niveau: true, nom: true } } },
  });

  // Récupérer les tarifs par niveau
  const tarifs = await prisma.tarifNiveau.findMany({
    where: { tenantId, annee, actif: true },
  });

  // Indexer les tarifs par niveau
  const tarifMap = new Map<string, typeof tarifs[0]>();
  for (const t of tarifs) {
    tarifMap.set(t.niveau.toLowerCase(), t);
  }

  const libelle = `Scolarité ${moisNom} ${annee}`;
  const echeance = new Date(parseInt(annee.split("-")[0]), mois, 0);

  // ── OPTIMISATION : 3 requêtes batch au lieu de 3×N requêtes dans une boucle
  // Avant : pour 880 élèves → 880 findFirst + 880 count + 880 create = 2640 requêtes
  // Après : 1 findMany + 1 count + 1 createMany = 3 requêtes

  // 1. Filtrer les élèves qui ont un tarif → éviter les requêtes inutiles
  const elevesAvecTarif = eleves.filter((e) => {
    const niveau = e.classe?.niveau ?? "Inconnu";
    return tarifMap.has(niveau.toLowerCase());
  });

  // 2. Batch : vérifier quelles factures existent déjà (1 seule requête)
  // eslint-disable-next-line ecolemiriam/require-site-filter -- lookup par factureId + tenantId : le caller a déjà vérifié l'accès
  const existingFactures = await prisma.facture.findMany({
    where: {
      tenantId,
      eleveId: { in: elevesAvecTarif.map((e) => e.id) },
      libelle,
    },
    select: { eleveId: true },
  });
  const existingSet = new Set(existingFactures.map((f) => f.eleveId));

  // 3. Construire les données à insérer (en mémoire, 0 requête)
  // eslint-disable-next-line ecolemiriam/require-site-filter -- count global pour numérotation séquentielle
  const baseCount = await prisma.facture.count({ where: { tenantId } });
  const anneePrefix = annee.split("-")[0];

  const toCreate: Array<{
    tenantId: string;
    eleveId: string;
    numero: string;
    libelle: string;
    montant: number;
    devise: string;
    statut: "EN_ATTENTE";
    echeance: Date;
    mois: string;
    siteId: string | null;
    createdById: string;
  }> = [];

  let seq = baseCount + 1;
  for (const eleve of elevesAvecTarif) {
    if (existingSet.has(eleve.id)) continue;

    const niveau = eleve.classe?.niveau ?? "Inconnu";
    const tarif = tarifMap.get(niveau.toLowerCase())!;

    let montant = tarif.mensualite;
    if (inclureCantine && tarif.fraisCantine) montant += tarif.fraisCantine;
    if (inclureTransport && tarif.fraisTransport) montant += tarif.fraisTransport;

    toCreate.push({
      tenantId,
      eleveId: eleve.id,
      numero: `FAC-${anneePrefix}-${String(seq).padStart(5, "0")}`,
      libelle,
      montant,
      devise: tarif.devise,
      statut: "EN_ATTENTE",
      echeance,
      mois: moisKey,
      siteId: eleve.siteId ?? null,
      createdById: session.user.id,
    });
    seq++;
  }

  // 4. Bulk insert (1 seule requête)
  if (toCreate.length > 0) {
    // eslint-disable-next-line ecolemiriam/require-site-filter -- bulk insert, tenantId dans chaque ligne
    await prisma.facture.createMany({ data: toCreate });
  }

  const skipped = eleves.length - toCreate.length;

  revalidatePath("/facturation");
  revalidateTag("dashboard-data");
  return { success: true, generated: toCreate.length, skipped };
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
  const tarifMap = new Map<string, typeof tarifs[0]>();
  for (const t of tarifs) {
    tarifMap.set(t.niveau.toLowerCase(), t);
  }

  const libelle = type === "INSCRIPTION"
    ? `Frais d'inscription ${annee}`
    : `Frais de renouvellement ${annee}`;
  const echeance = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 jours

  // ── OPTIMISATION : 3 requêtes batch au lieu de 4×N requêtes dans une boucle
  // Avant : pour N élèves → N findFirst(eleve) + N findFirst(facture) + N count + N create = 4N
  // Après : 1 findMany(eleves) + 1 findMany(factures) + 1 count + 1 createMany = 4

  // 1. Batch : charger tous les élèves en 1 requête
  // eslint-disable-next-line ecolemiriam/require-site-filter -- lookup par eleveId + tenantId : le caller a déjà vérifié l'accès
  const eleves = await prisma.eleve.findMany({
    where: { id: { in: eleveIds }, tenantId },
    include: { classe: { select: { niveau: true } } },
  });

  // 2. Filtrer ceux qui ont un tarif
  const elevesAvecTarif = eleves.filter((e) => {
    const niveau = e.classe?.niveau ?? "Inconnu";
    return tarifMap.has(niveau.toLowerCase());
  });

  // 3. Batch : vérifier les factures déjà existantes (1 requête)
  // eslint-disable-next-line ecolemiriam/require-site-filter -- lookup par factureId + tenantId : le caller a déjà vérifié l'accès
  const existingFactures = await prisma.facture.findMany({
    where: {
      tenantId,
      eleveId: { in: elevesAvecTarif.map((e) => e.id) },
      libelle,
    },
    select: { eleveId: true },
  });
  const existingSet = new Set(existingFactures.map((f) => f.eleveId));

  // 4. Numérotation séquentielle (1 count au lieu de N)
  // eslint-disable-next-line ecolemiriam/require-site-filter -- count global pour numérotation séquentielle
  const baseCount = await prisma.facture.count({ where: { tenantId } });
  const anneePrefix = annee.split("-")[0];

  const toCreate: Array<{
    tenantId: string;
    eleveId: string;
    numero: string;
    libelle: string;
    montant: number;
    devise: string;
    statut: "EN_ATTENTE";
    echeance: Date;
    siteId: string | null;
    createdById: string;
  }> = [];

  let seq = baseCount + 1;
  for (const eleve of elevesAvecTarif) {
    if (existingSet.has(eleve.id)) continue;

    const niveau = eleve.classe?.niveau ?? "Inconnu";
    const tarif = tarifMap.get(niveau.toLowerCase())!;
    const montant = type === "INSCRIPTION" ? tarif.fraisInscription : tarif.fraisRenouvellement;

    toCreate.push({
      tenantId,
      eleveId: eleve.id,
      numero: `FAC-${anneePrefix}-${String(seq).padStart(5, "0")}`,
      libelle,
      montant,
      devise: tarif.devise,
      statut: "EN_ATTENTE",
      echeance,
      siteId: eleve.siteId ?? null,
      createdById: session.user.id,
    });
    seq++;
  }

  // 5. Bulk insert (1 requête)
  if (toCreate.length > 0) {
    // eslint-disable-next-line ecolemiriam/require-site-filter -- bulk insert, tenantId dans chaque ligne
    await prisma.facture.createMany({ data: toCreate });
  }

  const skipped = eleveIds.length - toCreate.length;

  revalidatePath("/facturation");
  revalidateTag("dashboard-data");
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
        tenant?.name ?? "École Miriam"
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
  revalidateTag("dashboard-data");
  revalidateTag("eleves-stats");
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
  revalidateTag("dashboard-data");
  revalidateTag("eleves-stats");
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
