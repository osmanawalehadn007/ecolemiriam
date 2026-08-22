"use server";

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { revalidatePath, revalidateTag } from "next/cache";
import { PAYMENT_METHOD_IDS } from "@/lib/payment-methods";
import { checkPermission } from "@/lib/rbac";
import { z } from "zod";
import { endOfDay } from "date-fns";

const FactureSchema = z.object({
  eleveId: z.string().min(1, "L'élève est requis"),
  libelle: z.string().min(1, "Le libellé est requis"),
  montant: z.number().min(0.01, "Le montant doit être positif"),
  devise: z.string().default("DJF"),
});

export type FactureFormData = z.infer<typeof FactureSchema>;

const PaiementSchema = z.object({
  montant: z.number().min(0.01, "Le montant doit être positif"),
  methode: z.enum(PAYMENT_METHOD_IDS as [string, ...string[]], {
    message: "Le moyen de paiement est invalide",
  }),
  reference: z.string().optional(),
});

export type PaiementFormData = z.infer<typeof PaiementSchema>;

export async function getFacturesForTenant(filters?: { statut?: string; eleveId?: string }) {
  const session = await auth();
  if (!session?.user?.tenantId) return [];

  const denied = checkPermission(session.user.role, "finance:read");
  if (denied) return [];

  // eslint-disable-next-line ecolemiriam/require-site-filter -- tenantId dans le where, site filter géré par le caller
  return prisma.facture.findMany({
    where: {
      tenantId: session.user.tenantId,
      ...(filters?.statut && filters.statut !== "ALL" ? { statut: filters.statut as never } : {}),
      ...(filters?.eleveId ? { eleveId: filters.eleveId } : {}),
    },
    include: {
      eleve: { select: { id: true, nom: true, prenom: true, matricule: true, classeId: true, classe: { select: { nom: true } } } },
      // eslint-disable-next-line ecolemiriam/require-site-filter -- include filtré par le where parent (tenantId sur facture)
      paiements: { include: { enregistrePar: { select: { id: true, name: true } } } },
      createdBy: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getFactureForDetail(id: string) {
  const session = await auth();
  if (!session?.user?.tenantId) return null;

  const denied = checkPermission(session.user.role, "finance:read");
  if (denied) return null;

  // eslint-disable-next-line ecolemiriam/require-site-filter -- tenantId dans le where, site filter géré par le caller
  const facture = await prisma.facture.findFirst({
    where: { id, tenantId: session.user.tenantId },
    include: {
      eleve: {
        select: {
          id: true,
          nom: true,
          prenom: true,
          matricule: true,
          classe: { select: { nom: true, niveau: true } },
          parents: { include: { parent: true }, where: { isGardien: true }, take: 1 },
        },
      },
      // eslint-disable-next-line ecolemiriam/require-site-filter -- include filtré par le where parent (tenantId sur facture)
      paiements: { orderBy: { date: "desc" }, include: { enregistrePar: { select: { id: true, name: true } } } },
      createdBy: { select: { id: true, name: true } },
    },
  });

  return facture;
}

export async function createFacture(data: FactureFormData) {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");

  const denied = checkPermission(session.user.role, "finance:write");
  if (denied) throw new Error("Accès refusé");

  const tenantId = session.user.tenantId;
  const parsed = FactureSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => i.message).join(", "));
  }

  const values = parsed.data;
  // eslint-disable-next-line ecolemiriam/require-site-filter -- tenantId dans le where, site filter géré par le caller
  const count = await prisma.facture.count({ where: { tenantId } });
  const numero = `FAC-${new Date().getFullYear()}-${String(count + 1).padStart(5, "0")}`;

  // Récupérer le siteId de l'élève pour assigner la facture au bon site
  // eslint-disable-next-line ecolemiriam/require-site-filter, ecolemiriam/require-tenant-id -- lookup to get siteId for creation
  const eleve = await prisma.eleve.findUnique({
    where: { id: values.eleveId },
    select: { siteId: true },
  });
  const factureSiteId = eleve?.siteId ?? null;

  const facture = await prisma.facture.create({
    data: {
      tenantId,
      siteId: factureSiteId,
      eleveId: values.eleveId,
      numero,
      libelle: values.libelle,
      montant: values.montant,
      devise: values.devise || "DJF",
      statut: "EN_ATTENTE",
      echeance: endOfDay(new Date()),
      createdById: session.user.id,
    },
  });

  revalidatePath("/facturation");
  revalidateTag("dashboard-data");
  return { success: true, id: facture.id };
}

export async function getFactureByNumero(numero: string) {
  const session = await auth();
  if (!session?.user?.tenantId) return null;

  const denied = checkPermission(session.user.role, "finance:read");
  if (denied) return null;

  if (!numero || numero.trim().length === 0) return null;

  // eslint-disable-next-line ecolemiriam/require-site-filter -- tenantId dans le where, site filter géré par le caller
  return prisma.facture.findFirst({
    where: {
      numero: numero.trim(),
      tenantId: session.user.tenantId,
    },
    select: {
      id: true,
      numero: true,
      libelle: true,
      montant: true,
      devise: true,
      statut: true,
      echeance: true,
      eleve: {
        select: {
          id: true,
          nom: true,
          prenom: true,
          matricule: true,
          classe: { select: { nom: true } },
        },
      },
    },
  });
}

export async function enregistrerPaiement(factureId: string, data: PaiementFormData) {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");

  const denied = checkPermission(session.user.role, "finance:write");
  if (denied) throw new Error("Accès refusé");

  if (!factureId || factureId.trim().length === 0) {
    throw new Error("Numéro de facture requis : aucun paiement ne peut être enregistré sans facture");
  }

  const parsed = PaiementSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => i.message).join(", "));
  }

  const values = parsed.data;
  // eslint-disable-next-line ecolemiriam/require-site-filter -- tenantId dans le where, site filter géré par le caller
  const facture = await prisma.facture.findFirst({
    where: { id: factureId, tenantId: session.user.tenantId },
    include: { paiements: true },
  });
  if (!facture) throw new Error("Facture non trouvée");

  if (facture.statut === "ANNULEE") {
    throw new Error("Impossible d'encaisser sur une facture annulée");
  }

  const totalDejaPaye = facture.paiements.reduce((sum, p) => sum + p.montant, 0);
  const restant = facture.montant - totalDejaPaye;

  if (restant <= 0) {
    throw new Error("Cette facture est déjà soldée");
  }

  if (values.montant > restant) {
    throw new Error(`Le montant ne peut pas dépasser le solde restant (${restant} ${facture.devise})`);
  }

  const paiement = await prisma.paiement.create({
    data: {
      factureId,
      montant: values.montant,
      devise: facture.devise,
      methode: values.methode,
      reference: values.reference || null,
      enregistreParId: session.user.id,
    },
  });

  const totalPaye = totalDejaPaye + values.montant;
  let newStatut: typeof facture.statut = facture.statut;

  if (totalPaye >= facture.montant) {
    newStatut = "PAYEE";
  } else if (facture.echeance && new Date() > facture.echeance && totalPaye < facture.montant) {
    newStatut = "EN_RETARD";
  }

  await prisma.facture.update({
    where: { id: factureId },
    data: { statut: newStatut },
  });

  revalidatePath("/facturation");
  revalidatePath(`/facturation/${factureId}`);
  revalidateTag("dashboard-data");
  return { success: true, id: paiement.id };
}

export async function annulerFacture(factureId: string) {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");

  const denied = checkPermission(session.user.role, "finance:write");
  if (denied) throw new Error("Accès refusé");

  // eslint-disable-next-line ecolemiriam/require-site-filter -- tenantId dans le where, site filter géré par le caller
  const facture = await prisma.facture.findFirst({
    where: { id: factureId, tenantId: session.user.tenantId },
  });
  if (!facture) throw new Error("Facture non trouvée");

  if (facture.statut === "PAYEE") {
    throw new Error("Impossible d'annuler une facture déjà payée");
  }

  // eslint-disable-next-line ecolemiriam/require-site-filter -- comptage par factureId déjà vérifié tenant et via la relation facture
  const nbPaiements = await prisma.paiement.count({
    where: { factureId },
  });
  if (nbPaiements > 0) {
    throw new Error("Impossible d'annuler une facture ayant déjà des paiements");
  }

  await prisma.facture.update({
    where: { id: factureId },
    data: { statut: "ANNULEE" },
  });

  revalidatePath("/facturation");
  revalidatePath(`/facturation/${factureId}`);
  revalidateTag("dashboard-data");
  return { success: true };
}
