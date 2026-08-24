import prisma from "@/lib/prisma";
import { runWithTenant } from "@/lib/prisma";
import { unstable_cache } from "next/cache";
import type { Role } from "@prisma/client";

const TEACHER_ROLES: Role[] = ["TEACHER", "CLASS_TEACHER"];

/**
 * Détermine si un rôle est un rôle d'enseignant restreint à ses classes.
 */
export function isTeacherRole(role: Role): boolean {
  return TEACHER_ROLES.includes(role);
}

/**
 * Récupère les IDs des classes attribuées à un enseignant
 * (via l'emploi du temps et/ou le rôle de prof principal).
 *
 * Retourne également les IDs des matières qu'il enseigne.
 *
 * OPTIMISATION: mise en cache 2 minutes — les affectations changent rarement
 * pendant une session de navigation. Invalidation via revalidateTag.
 *
 * Note: unstable_cache détache le contexte requête → auth() échoue →
 * l'extension RLS ne positionne pas SET LOCAL. runWithTenant injecte
 * le contexte via AsyncLocalStorage, contournant ce problème.
 */
export const getTeacherScope = unstable_cache(
  async (
    tenantId: string,
    userId: string,
    role: Role
  ): Promise<{
    classeIds: string[];
    matiereIds: string[];
    isRestricted: boolean;
  }> => {
    if (!isTeacherRole(role)) {
      return { classeIds: [], matiereIds: [], isRestricted: false };
    }

    return runWithTenant(tenantId, null, async () => {
      // eslint-disable-next-line ecolemiriam/require-site-filter -- teacher lookup by userId+tenantId, site scoping is caller's responsibility
      const enseignant = await prisma.enseignant.findFirst({
        where: { userId, tenantId },
        select: { id: true },
      });

      if (!enseignant) {
        return { classeIds: [], matiereIds: [], isRestricted: true };
      }

      /* eslint-disable ecolemiriam/require-site-filter -- teacher scope resolution, site scoping is caller's responsibility */
      const [emploiEntries, principalClasses, affectations, matieres] = await Promise.all([
        prisma.emploiTemps.findMany({
          where: { enseignantId: enseignant.id, tenantId },
          select: { classeId: true, matiereId: true },
          distinct: ["classeId", "matiereId"],
        }),
        prisma.classe.findMany({
          where: { profPrincipalId: enseignant.id, tenantId },
          select: { id: true },
        }),
        // Nouveau : affectations explicites via EnseignantAffectation
        prisma.enseignantAffectation.findMany({
          where: { enseignantId: enseignant.id, tenantId },
          select: { classeId: true, matiereId: true },
        }),
        // Nouveau : matières liées via EnseignantMatiere
        prisma.enseignantMatiere.findMany({
          where: { enseignantId: enseignant.id, tenantId },
          select: { matiereId: true },
        }),
      ]);
      /* eslint-enable ecolemiriam/require-site-filter */

      const classeIds = Array.from(
        new Set([
          ...emploiEntries.map((e) => e.classeId),
          ...principalClasses.map((c) => c.id),
          ...affectations.map((a) => a.classeId),
        ])
      );

      const matiereIds = Array.from(
        new Set([
          ...emploiEntries.map((e) => e.matiereId).filter(Boolean) as string[],
          ...affectations.map((a) => a.matiereId).filter(Boolean) as string[],
          ...matieres.map((m) => m.matiereId),
        ])
      );

      return { classeIds, matiereIds, isRestricted: true };
    });
  },
  ["teacher-scope"],
  { revalidate: 120, tags: ["teacher-scope"] }
);
