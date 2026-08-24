import prisma from "@/lib/prisma";
import { runWithTenant } from "@/lib/prisma";
import { cached, cacheDel, cacheKey } from "@/lib/redis";
import type { Session } from "next-auth";

export interface SituationFinanciere {
  totalFacture: number;
  totalPaye: number;
  totalRestant: number;
  nbFacturesEnRetard: number;
  nbRelances: number;
  estExclu: boolean;
  exclusionId: string | null;
  exclusionMotif: string | null;
  exclusionDateDebut: Date | null;
  factures: {
    id: string;
    numero: string;
    libelle: string;
    montant: number;
    paye: number;
    restant: number;
    statut: string;
    echeance: Date | null;
    nbRelances: number;
  }[];
}

/**
 * Récupère la situation financière complète d'un élève.
 * Calcule le solde, les retards, les relances et l'exclusion en cours.
 */
export async function getSituationFinanciere(eleveId: string, tenantId: string): Promise<SituationFinanciere> {
  // eslint-disable-next-line ecolemiriam/require-site-filter -- lookup par eleveId + tenantId : le caller a déjà vérifié l'accès
  const factures = await prisma.facture.findMany({
    where: { eleveId, tenantId, statut: { not: "ANNULEE" } },
    include: {
      paiements: true,
      relances: { select: { id: true, niveau: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const exclusion = await prisma.exclusionEleve.findFirst({
    where: { eleveId, tenantId, dateFin: null },
    select: { id: true, motif: true, dateDebut: true },
  });

  let totalFacture = 0;
  let totalPaye = 0;
  let nbFacturesEnRetard = 0;
  let nbRelances = 0;

  const facturesDetail = factures.map((f) => {
    const paye = f.paiements.reduce((s, p) => s + p.montant, 0);
    const restant = f.montant - paye;
    totalFacture += f.montant;
    totalPaye += paye;
    if (f.statut === "EN_RETARD" || (f.echeance && new Date() > f.echeance && restant > 0)) {
      nbFacturesEnRetard++;
    }
    nbRelances += f.relances.length;
    return {
      id: f.id,
      numero: f.numero,
      libelle: f.libelle,
      montant: f.montant,
      paye,
      restant,
      statut: f.statut,
      echeance: f.echeance,
      nbRelances: f.relances.length,
    };
  });

  return {
    totalFacture,
    totalPaye,
    totalRestant: totalFacture - totalPaye,
    nbFacturesEnRetard,
    nbRelances,
    estExclu: !!exclusion,
    exclusionId: exclusion?.id ?? null,
    exclusionMotif: exclusion?.motif ?? null,
    exclusionDateDebut: exclusion?.dateDebut ?? null,
    factures: facturesDetail,
  };
}

/**
 * Vérifie si un élève a accès à la plateforme (non exclu) ET que
 * l'utilisateur appelant a bien le droit d'accéder à CET élève (filiation).
 *
 * @param eleveId  L'élève consulté
 * @param tenantId Le tenant
 * @param user     Optionnel — { userId, role } du session.user. Si fourni
 *                 et que le rôle est PARENT ou STUDENT, la filiation est
 *                 vérifiée en plus de l'exclusion financière. Sans ce
 *                 paramètre, la fonction conserve son comportement
 *                 historique (exclusion seulement) pour les callers
 *                 legacy qui n'ont pas encore été migrés.
 */
export async function checkEleveAccess(
  eleveId: string,
  tenantId: string,
  user?: { userId: string; role: string }
): Promise<{
  allowed: boolean;
  reason?: string;
  exclusion?: { id: string; motif: string; dateDebut: Date };
}> {
  // 1. Vérification de filiation (PARENT / STUDENT uniquement)
  if (user && (user.role === "PARENT" || user.role === "STUDENT")) {
    if (user.role === "STUDENT") {
      // eslint-disable-next-line ecolemiriam/require-tenant-id, ecolemiriam/require-site-filter -- portée déjà close : id + tenantId + userId de l'appelant
      const own = await prisma.eleve.findFirst({
        where: { id: eleveId, tenantId, userId: user.userId },
        select: { id: true },
      });
      if (!own) return { allowed: false, reason: "FORBIDDEN" };
    } else {
      // PARENT : vérifier le lien parent → enfant
      // EleveParent est une table de jointure : clé primaire composite
      // [eleveId, parentId], donc ni `id` ni `tenantId` propres. La frontière
      // tenant passe par la relation `eleve` — le contrôle est conservé, pas
      // supprimé, mais les règles de lint ne savent pas le reconnaître à
      // travers une relation.
      // eslint-disable-next-line ecolemiriam/require-tenant-id, ecolemiriam/require-site-filter -- portée : eleveId + eleve.tenantId + parent.userId
      const link = await prisma.eleveParent.findFirst({
        where: { eleveId, eleve: { tenantId }, parent: { userId: user.userId } },
        select: { eleveId: true },
      });
      if (!link) return { allowed: false, reason: "FORBIDDEN" };
    }
  }

  // 2. Vérification d'exclusion financière
  // eslint-disable-next-line ecolemiriam/require-tenant-id -- eleveId + tenantId fournis par le caller
  const exclusion = await prisma.exclusionEleve.findFirst({
    where: { eleveId, tenantId, dateFin: null },
    select: { id: true, motif: true, dateDebut: true },
  });

  if (exclusion) {
    return {
      allowed: false,
      reason: "EXCLUDED",
      exclusion: { id: exclusion.id, motif: exclusion.motif, dateDebut: exclusion.dateDebut },
    };
  }

  return { allowed: true };
}

/**
 * Vérifie si un utilisateur (élève ou parent) doit être bloqué
 * pour non-paiement. À appeler lors du login ou sur les pages sensibles.
 *
 * Pour un parent :
 * - Si TOUS ses enfants sont exclus → blocage total (blocked: true)
 * - Si CERTAINS seulement sont exclus → blocage partiel (blocked: false, partialBlock: true, excludedEleveIds: [...])
 *   Le parent garde accès à la plateforme mais les données des enfants exclus sont masquées.
 */
export async function checkUserFinancialBlock(userId: string, tenantId: string): Promise<{
  blocked: boolean;
  reason?: string;
  eleveIds?: string[];
  messageKey?: string;
  messageParams?: Record<string, string | number>;
  partialBlock?: boolean;
  excludedEleveIds?: string[];
}> {
  // Cas 1: l'utilisateur est un élève
  // eslint-disable-next-line ecolemiriam/require-site-filter -- lookup par userId + tenantId : le caller a déjà vérifié l'accès
  const eleve = await prisma.eleve.findFirst({
    where: { userId, tenantId },
    select: { id: true, statut: true },
  });

  if (eleve) {
    if (eleve.statut === "EXCLU") {
      const exclusion = await prisma.exclusionEleve.findFirst({
        where: { eleveId: eleve.id, tenantId, dateFin: null },
        select: { motif: true, dateDebut: true },
      });
      return {
        blocked: true,
        reason: "EXCLUDED",
        eleveIds: [eleve.id],
        messageKey: exclusion
          ? "financialBlock.studentExcludedWithDate"
          : "financialBlock.studentExcluded",
        messageParams: exclusion
          ? { date: new Date(exclusion.dateDebut).toLocaleDateString("fr-FR"), motif: exclusion.motif }
          : undefined,
      };
    }
    return { blocked: false };
  }

  // Cas 2: l'utilisateur est un parent
  // eslint-disable-next-line ecolemiriam/require-site-filter -- lookup par userId + tenantId : le caller a déjà vérifié l'accès
  const enfants = await prisma.eleveParent.findMany({
    where: { parent: { userId, tenantId } },
    select: { eleveId: true },
  });

  if (enfants.length === 0) return { blocked: false };

  const eleveIds = enfants.map((e) => e.eleveId);
  const exclusions = await prisma.exclusionEleve.findMany({
    where: { eleveId: { in: eleveIds }, tenantId, dateFin: null },
    select: { eleveId: true, motif: true, dateDebut: true },
  });

  if (exclusions.length === 0) {
    return { blocked: false };
  }

  // Tous les enfants sont exclus → blocage total
  if (exclusions.length === eleveIds.length) {
    return {
      blocked: true,
      reason: "ALL_CHILDREN_EXCLUDED",
      eleveIds: exclusions.map((e) => e.eleveId),
      messageKey: "financialBlock.allChildrenExcluded",
    };
  }

  // Seulement certains enfants sont exclus → blocage partiel
  const excludedEleveIds = exclusions.map((e) => e.eleveId);
  return {
    blocked: false,
    partialBlock: true,
    excludedEleveIds,
    reason: "PARTIAL_EXCLUSION",
    messageKey: excludedEleveIds.length === 1
      ? "financialBlock.partialExclusionSingle"
      : "financialBlock.partialExclusionMultiple",
    messageParams: { count: excludedEleveIds.length },
  };
}

/**
 * Version cachée de checkUserFinancialBlock pour le layout du dashboard.
 *
 * Le blocage financier est vérifié à CHAQUE navigation (layout server
 * component). Sans cache, cela fait 2-4 requêtes DB par page pour les
 * PARENT/STUDENT. Avec un cache Redis de 30s, la première navigation paie le
 * coût et les suivantes sont gratuites — et le cache est partagé entre
 * instances blue/green.
 */
export async function checkUserFinancialBlockCached(
  userId: string,
  tenantId: string
): Promise<Awaited<ReturnType<typeof checkUserFinancialBlock>>> {
  return cached(
    cacheKey(tenantId, "financial-block", userId),
    () => runWithTenant(tenantId, null, () => checkUserFinancialBlock(userId, tenantId)),
    30 // 30 secondes
  );
}

/**
 * Invalide le cache du blocage financier pour un utilisateur.
 */
export async function invalidateFinancialBlock(
  tenantId: string,
  userId: string
): Promise<void> {
  await cacheDel(cacheKey(tenantId, "financial-block", userId));
}
