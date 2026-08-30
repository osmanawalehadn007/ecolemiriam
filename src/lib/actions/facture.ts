"use server";

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { revalidatePath, revalidateTag } from "next/cache";
import { PAYMENT_METHOD_IDS } from "@/lib/payment-methods";
import { checkPermission } from "@/lib/rbac";
import { z } from "zod";
import { endOfDay } from "date-fns";
import { Prisma, TypeFacture } from "@prisma/client";

const FACTURE_TYPES: [string, ...string[]] = [
  "MENSUALITE",
  "INSCRIPTION",
  "RENOUVELLEMENT",
  "CANTINE",
  "TRANSPORT",
  "LIBRE",
];

const FactureSchema = z.object({
  eleveId: z.string().min(1, "L'élève est requis"),
  libelle: z.string().min(1, "Le libellé est requis"),
  montant: z.number().min(0.01, "Le montant doit être positif"),
  devise: z.string().default("DJF"),
  mois: z.string().optional().nullable(),
  type: z.enum(FACTURE_TYPES, { message: "Le type de facture est requis" }),
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
      relances: { select: { id: true, niveau: true, envoyeeLe: true } },
      createdBy: { select: { id: true, name: true } },
      // Inclure la candidature pour les factures d'admission (eleveId = null)
      candidature: { select: { id: true, nom: true, prenom: true, classeVoulue: true, annee: true, statut: true } },
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
      // Facture d'admission : l'élève n'existe pas encore (créé à l'inscription).
      // On charge la candidature pour afficher le nom et la classe souhaitée.
      candidature: {
        select: {
          id: true,
          nom: true,
          prenom: true,
          classeVoulue: true,
          statut: true,
          parentNom: true,
          parentPrenom: true,
          parentPhone: true,
          parentEmail: true,
        },
      },
      // eslint-disable-next-line ecolemiriam/require-site-filter -- include filtré par le where parent (tenantId sur facture)
      paiements: { orderBy: { date: "desc" }, include: { enregistrePar: { select: { id: true, name: true } } } },
      createdBy: { select: { id: true, name: true } },
    },
  });

  return facture;
}

// Types de facture mensuels (ils s'identifient par un mois)
const TYPES_MENSUELS = new Set<TypeFacture>(["MENSUALITE", "CANTINE", "TRANSPORT"]);

// Vérifie si une facture identique existe déjà et, le cas échéant, si elle est
// "bloquante" (payée / validée / non annulée). Renvoie null si la création est autorisée.
export async function canCreateFacture(
  eleveId: string,
  type: TypeFacture,
  mois: string | null,
  tenantId: string
): Promise<{ blocked: false } | { blocked: true; statut: string; paid: boolean; numero?: string }> {
  const where: Prisma.FactureWhereInput = {
    tenantId,
    eleveId,
    type,
  };

  // Les types mensuels doivent être uniques par mois ; inscription / renouvellement
  // et libre sont uniques globalement pour l'élève.
  if (TYPES_MENSUELS.has(type) && mois) {
    where.mois = mois;
  } else {
    where.mois = mois ?? null;
  }

  // eslint-disable-next-line ecolemiriam/require-site-filter -- lookup par eleveId + tenantId
  const existing = await prisma.facture.findFirst({
    where,
    select: { id: true, statut: true, numero: true, montant: true, paiements: { select: { id: true, montant: true } } },
  });

  if (!existing) return { blocked: false };

  const totalPaye = existing.paiements.reduce((s, p) => s + p.montant, 0);
  const paid = existing.statut === "PAYEE" || totalPaye >= existing.montant;

  // On ne bloque que si la facture n'est pas annulée (ANNULEE = une erreur a été corrigée,
  // il est légitime de la recréer). Tout autre statut (EN_ATTENTE, PAYEE, EN_RETARD)
  // est bloquant car la facture existe déjà pour ce service / ce mois.
  if (existing.statut === "ANNULEE") {
    return { blocked: false };
  }

  return { blocked: true, statut: existing.statut, paid, numero: existing.numero };
}

export async function getExistingFacturesForEleve(eleveId: string) {
  const session = await auth();
  if (!session?.user?.tenantId) return [];

  const denied = checkPermission(session.user.role, "finance:read");
  if (denied) return [];

  // eslint-disable-next-line ecolemiriam/require-site-filter -- lookup par eleveId + tenantId
  return prisma.facture.findMany({
    where: { tenantId: session.user.tenantId, eleveId, statut: { not: "ANNULEE" } },
    select: { id: true, type: true, mois: true, statut: true, numero: true, montant: true },
    orderBy: { mois: "asc" },
  });
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
  const check = await canCreateFacture(values.eleveId, values.type as TypeFacture, values.mois ?? null, tenantId);
  if (check.blocked) {
    const raison = check.paid
      ? `Cette facture existe déjà (${check.numero ?? ""}) et est payée. Impossible de la régénérer.`
      : `Une facture existe déjà pour ce service (${check.numero ?? ""}). Veuillez l'annuler avant de la régénérer.`;
    throw new Error(raison);
  }

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
      type: values.type as TypeFacture,
      echeance: endOfDay(new Date()),
      mois: values.mois || null,
      createdById: session.user.id,
    },
  });

  revalidatePath("/facturation");
  revalidateTag("dashboard-data");
  return { success: true, id: facture.id };
}

const CombineesSchema = z.object({
  eleveId: z.string().min(1, "L'élève est requis"),
  factures: z.array(
    z.object({
      type: z.enum(FACTURE_TYPES),
      libelle: z.string().min(1, "Le libellé est requis"),
      montant: z.number().min(0.01, "Le montant doit être positif"),
      devise: z.string().default("DJF"),
      mois: z.string().optional().nullable(),
    })
  ).min(1, "Au moins une facture est requise"),
});

export type FacturesCombineesData = z.infer<typeof CombineesSchema>;

export async function createFacturesCombinees(data: FacturesCombineesData) {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");

  const denied = checkPermission(session.user.role, "finance:write");
  if (denied) throw new Error("Accès refusé");

  const tenantId = session.user.tenantId;
  const parsed = CombineesSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => i.message).join(", "));
  }

  const { eleveId, factures } = parsed.data;

  // Inscription et renouvellement sont mutuellement exclusifs : vérifier ici
  // que le batch n'en contient pas les deux.
  const hasInscription = factures.some((f) => f.type === "INSCRIPTION");
  const hasRenouvellement = factures.some((f) => f.type === "RENOUVELLEMENT");
  if (hasInscription && hasRenouvellement) {
    throw new Error("Inscription et réinscription ne peuvent pas être générées simultanément.");
  }

  // Vérifier les doublons avant toute transaction
  const blocked: Array<{ type: string; mois?: string | null; numero?: string; paid: boolean }> = [];
  const toCreate: Array<{ type: TypeFacture; libelle: string; montant: number; devise: string; mois: string | null }> = [];

  for (const f of factures) {
    const check = await canCreateFacture(eleveId, f.type as TypeFacture, f.mois ?? null, tenantId);
    if (check.blocked) {
      blocked.push({ type: f.type, mois: f.mois, numero: check.numero, paid: check.paid });
    } else {
      toCreate.push({ type: f.type as TypeFacture, libelle: f.libelle, montant: f.montant, devise: f.devise || "DJF", mois: f.mois ?? null });
    }
  }

  if (toCreate.length === 0) {
    return { success: false, created: [], blocked };
  }

  // Récupérer le siteId de l'élève
  // eslint-disable-next-line ecolemiriam/require-site-filter, ecolemiriam/require-tenant-id -- lookup to get siteId for creation
  const eleve = await prisma.eleve.findUnique({
    where: { id: eleveId },
    select: { siteId: true },
  });
  const factureSiteId = eleve?.siteId ?? null;

  // eslint-disable-next-line ecolemiriam/require-site-filter -- TenantId dans le where, site filter géré par le caller
  const count = await prisma.facture.count({ where: { tenantId } });
  const year = new Date().getFullYear();

  const created = await prisma.$transaction(async (tx) => {
    const results: { id: string; type: TypeFacture }[] = [];
    let seq = count + 1;
    for (const f of toCreate) {
      const numero = `FAC-${year}-${String(seq).padStart(5, "0")}`;
      const facture = await tx.facture.create({
        data: {
          tenantId,
          siteId: factureSiteId,
          eleveId,
          numero,
          libelle: f.libelle,
          montant: f.montant,
          devise: f.devise,
          statut: "EN_ATTENTE",
          type: f.type,
          echeance: endOfDay(new Date()),
          mois: f.mois,
          createdById: session.user.id,
        },
      });
      results.push({ id: facture.id, type: f.type });
      seq++;
    }
    return results;
  });

  revalidatePath("/facturation");
  revalidateTag("dashboard-data");
  return { success: true, created, blocked };
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
