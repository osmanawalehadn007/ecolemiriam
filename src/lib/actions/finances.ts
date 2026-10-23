"use server";

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { siteFilterForModel, type SessionSiteClaims } from "@/lib/site-scope";
import { checkPermission } from "@/lib/rbac";
import {
  MESSAGE_AUTORISATEUR_REFUSE,
  MESSAGE_PAYEUR_REFUSE,
  peutAutoriserDepense,
  peutPayerDepense,
} from "@/lib/depense-habilitations";

const DepenseSchema = z.object({
  categorie: z.string().min(1, "La catégorie est requise"),
  description: z.string().optional(),
  fournisseur: z.string().optional(),
  montant: z.number().min(0.01, "Le montant doit être positif"),
  devise: z.string().default("DJF"),
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

  const denied = checkPermission(session.user.role, "finance:read");
  if (denied) return [];

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

  const denied = checkPermission(session.user.role, "finance:read");
  if (denied) return [];

  const siteFilter = siteFilterForModel("budget", { ...session.user, siteId });
  return prisma.budget.findMany({
    where: { tenantId: session.user.tenantId, ...siteFilter },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}

/**
 * Vérifie qu'une personne désignée sur une dépense (autorisation ou paiement)
 * est bien habilitée ET bien dans le périmètre du demandeur.
 *
 * Le contrôle est refait ici, et pas seulement dans les menus déroulants : un
 * appel direct à la server action (client modifié, script, future API) ne doit
 * pas pouvoir désigner n'importe qui comme auteur d'une autorisation ou d'un
 * paiement.
 */
async function verifierHabilitationDepense(options: {
  userId: string;
  tenantId: string;
  claims: SessionSiteClaims;
  /** « Autorisateur » ou « Payeur » — sert au message d'erreur. */
  libelle: string;
  estHabilitee: (role: string | null | undefined) => boolean;
  messageRefus: string;
}): Promise<void> {
  const personne = await prisma.user.findFirst({
    // Même périmètre que les listes déroulantes (`getUsersForTenant`) : une
    // personne hors du périmètre du demandeur ne peut pas être désignée, et ne
    // lui est de toute façon pas proposée.
    where: {
      id: options.userId,
      tenantId: options.tenantId,
      ...siteFilterForModel("user", options.claims),
    },
    select: { name: true, role: true },
  });

  if (!personne) {
    throw new Error(`${options.libelle} introuvable dans cet établissement`);
  }
  if (!options.estHabilitee(personne.role)) {
    throw new Error(`${options.messageRefus} (${personne.name} — ${personne.role})`);
  }
}

export async function createDepense(data: z.infer<typeof DepenseSchema>) {
  const session = await auth();
  if (!session?.user?.tenantId) throw new Error("Non autorisé");

  const denied = checkPermission(session.user.role, "finance:write");
  if (denied) throw new Error("Accès refusé");

  const parsed = DepenseSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => i.message).join(", "));
  }

  // Habilitations : autorisateur = responsable d'établissement (TENANT_ADMIN)
  // ou chef d'établissement (PRINCIPAL) ; payeur = comptable/caissier
  // (ACCOUNTANT). Référentiel partagé avec les menus déroulants
  // (src/lib/depense-habilitations.ts) et avec les triggers PostgreSQL.
  if (parsed.data.autoriseParId) {
    await verifierHabilitationDepense({
      userId: parsed.data.autoriseParId,
      tenantId: session.user.tenantId,
      claims: session.user,
      libelle: "Autorisateur",
      estHabilitee: peutAutoriserDepense,
      messageRefus: MESSAGE_AUTORISATEUR_REFUSE,
    });
  }
  if (parsed.data.payeParId) {
    await verifierHabilitationDepense({
      userId: parsed.data.payeParId,
      tenantId: session.user.tenantId,
      claims: session.user,
      libelle: "Payeur",
      estHabilitee: peutPayerDepense,
      messageRefus: MESSAGE_PAYEUR_REFUSE,
    });
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
      date: new Date(),
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

  const denied = checkPermission(session.user.role, "finance:write");
  if (denied) throw new Error("Accès refusé");

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

  const denied = checkPermission(session.user.role, "finance:write");
  if (denied) throw new Error("Accès refusé");

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

  const denied = checkPermission(session.user.role, "finance:write");
  if (denied) throw new Error("Accès refusé");

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

  const denied = checkPermission(session.user.role, "finance:write");
  if (denied) throw new Error("Accès refusé");

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

  const denied = checkPermission(session.user.role, "finance:write");
  if (denied) throw new Error("Accès refusé");

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

  const denied = checkPermission(session.user.role, "finance:write");
  if (denied) throw new Error("Accès refusé");

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

  const denied = checkPermission(session.user.role, "finance:read");
  if (denied) return [];

  const siteFilter = siteId
    ? { siteId }
    : siteFilterForModel("remiseCaisse", session.user);

  const isAdmin = ["SUPER_ADMIN", "TENANT_ADMIN"].includes(session.user.role);
  const where: Record<string, unknown> = { tenantId: session.user.tenantId, ...siteFilter };
  if (!isAdmin) {
    where.OR = [{ caissierId: session.user.id }, { destinataireId: session.user.id }];
  }

  return prisma.remiseCaisse.findMany({
    where,
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
