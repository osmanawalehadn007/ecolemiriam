"use server";

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { siteFilterForModel } from "@/lib/site-scope";

const DepenseSchema = z.object({
  categorie: z.string().min(1, "La catégorie est requise"),
  description: z.string().optional(),
  fournisseur: z.string().optional(),
  montant: z.number().min(0.01, "Le montant doit être positif"),
  devise: z.string().default("DJF"),
  date: z.string().min(1, "La date est requise"),
  siteId: z.string().optional().nullable(),
  typeEngagement: z.string().optional(),
  autoriseParId: z.string().optional().nullable(),
  payeParId: z.string().optional().nullable(),
});

const BudgetSchema = z.object({
  categorie: z.string().min(1, "La catégorie est requise"),
  periode: z.string().min(1, "La période est requise"),
  montantPrevu: z.number().min(0.01, "Le montant doit être positif"),
  siteId: z.string().optional().nullable(),
});

export async function getDepensesForPeriod(siteId: string | null, start: Date, end: Date) {
  const session = await auth();
  if (!session?.user?.tenantId) return [];

  const siteFilter = siteFilterForModel("depense", { ...session.user, siteId });
  return prisma.depense.findMany({
    where: {
      tenantId: session.user.tenantId,
      ...siteFilter,
      date: { gte: start, lte: end },
    },
    include: { createdBy: { select: { name: true } }, site: { select: { nom: true } } },
    orderBy: { date: "desc" },
    take: 200,
  });
}

export async function getBudgets(siteId: string | null) {
  const session = await auth();
  if (!session?.user?.tenantId) return [];

  const siteFilter = siteFilterForModel("budget", { ...session.user, siteId });
  return prisma.budget.findMany({
    where: { tenantId: session.user.tenantId, ...siteFilter },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}

export async function createDepense(data: z.infer<typeof DepenseSchema>) {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");

  const parsed = DepenseSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => i.message).join(", "));
  }

  await prisma.depense.create({
    data: {
      tenantId: session.user.tenantId,
      createdById: session.user.id,
      categorie: parsed.data.categorie,
      description: parsed.data.description,
      fournisseur: parsed.data.fournisseur,
      montant: parsed.data.montant,
      devise: parsed.data.devise || "DJF",
      date: new Date(parsed.data.date),
      siteId: parsed.data.siteId ?? null,
      typeEngagement: parsed.data.typeEngagement ?? null,
      autoriseParId: parsed.data.autoriseParId ?? null,
      payeParId: parsed.data.payeParId ?? null,
    },
  });

  revalidatePath("/finances");
  return { success: true };
}

export async function deleteDepense(id: string) {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");

  const siteFilter = siteFilterForModel("depense", session.user);
  const depense = await prisma.depense.findFirst({
    where: { id, tenantId: session.user.tenantId, ...siteFilter },
  });
  if (!depense) throw new Error("Dépense introuvable");

  await prisma.depense.delete({ where: { id } });
  revalidatePath("/finances");
  return { success: true };
}

export async function createBudget(data: z.infer<typeof BudgetSchema>) {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");

  const parsed = BudgetSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => i.message).join(", "));
  }

  await prisma.budget.create({
    data: {
      tenantId: session.user.tenantId,
      createdById: session.user.id,
      ...parsed.data,
      montantPrevu: parsed.data.montantPrevu,
    },
  });

  revalidatePath("/finances");
  return { success: true };
}

export async function deleteBudget(id: string) {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");

  const siteFilter = siteFilterForModel("budget", session.user);
  const budget = await prisma.budget.findFirst({
    where: { id, tenantId: session.user.tenantId, ...siteFilter },
  });
  if (!budget) throw new Error("Budget introuvable");

  await prisma.budget.delete({ where: { id } });
  revalidatePath("/finances");
  return { success: true };
}

// ============================================================
// REMISE DE CAISSE
// ============================================================

const RemiseCaisseSchema = z.object({
  montantDeclare: z.number().min(0.01, "Le montant doit être positif"),
  destinataireId: z.string().min(1, "Le destinataire est requis"),
  siteId: z.string().optional().nullable(),
  paiementIds: z.array(z.string()).default([]),
});

export async function createRemiseCaisse(data: z.infer<typeof RemiseCaisseSchema>) {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");

  const parsed = RemiseCaisseSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => i.message).join(", "));
  }

  const remise = await prisma.remiseCaisse.create({
    data: {
      tenantId: session.user.tenantId,
      caissierId: session.user.id,
      montantDeclare: parsed.data.montantDeclare,
      destinataireId: parsed.data.destinataireId,
      siteId: parsed.data.siteId ?? null,
      paiementIds: parsed.data.paiementIds,
    },
  });

  revalidatePath("/finances");
  return { success: true, id: remise.id };
}

export async function confirmerRemiseCaisse(
  id: string,
  montantRecu: number
) {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");

  const remise = await prisma.remiseCaisse.findFirst({
    where: { id, tenantId: session.user.tenantId },
  });
  if (!remise) throw new Error("Remise introuvable");
  if (remise.statut !== "EN_ATTENTE") throw new Error("Cette remise a déjà été traitée");
  if (remise.destinataireId !== session.user.id) {
    throw new Error("Vous n'êtes pas le destinataire de cette remise");
  }

  await prisma.remiseCaisse.update({
    where: { id },
    data: {
      montantRecu,
      dateReception: new Date(),
      recuParId: session.user.id,
      statut: "CONFIRME",
    },
  });

  revalidatePath("/finances");
  return { success: true };
}

export async function rejeterRemiseCaisse(id: string, raison?: string) {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");

  const remise = await prisma.remiseCaisse.findFirst({
    where: { id, tenantId: session.user.tenantId },
  });
  if (!remise) throw new Error("Remise introuvable");
  if (remise.statut !== "EN_ATTENTE") throw new Error("Cette remise a déjà été traitée");
  if (remise.destinataireId !== session.user.id && remise.caissierId !== session.user.id) {
    throw new Error("Non autorisé à rejeter cette remise");
  }

  await prisma.remiseCaisse.update({
    where: { id },
    data: { statut: "REJETE" },
  });

  revalidatePath("/finances");
  return { success: true };
}

export async function getRemisesCaisse(siteId: string | null) {
  const session = await auth();
  if (!session?.user?.tenantId) return [];

  const siteFilter = siteId
    ? { siteId }
    : siteFilterForModel("remiseCaisse", session.user);

  return prisma.remiseCaisse.findMany({
    where: { tenantId: session.user.tenantId, ...siteFilter },
    include: {
      caissier: { select: { id: true, name: true } },
      destinataire: { select: { id: true, name: true } },
      recuPar: { select: { id: true, name: true } },
      site: { select: { nom: true } },
    },
    orderBy: { dateDeclaration: "desc" },
    take: 50,
  });
}
