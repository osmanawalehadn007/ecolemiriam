/**
 * École Miriam — Sites accessibles à un utilisateur (mis en cache Redis)
 * ================================================================
 *
 * Source unique et cachée pour la liste des sites d'un utilisateur.
 * Le layout du dashboard, les pages (dashboard, eleves, etc.) et les
 * server actions partagent tous le même cache → une seule requête DB
 * pour toute la durée de vie du cache (60s), quel que soit le nombre
 * de composants qui ont besoin des sites.
 *
 * CACHE: Redis (60s, partagé entre instances blue/green).
 */

import prisma from "@/lib/prisma";
import { runWithTenant } from "@/lib/prisma";
import { cached, cacheDel, cacheKey } from "@/lib/redis";
import type { Prisma } from "@prisma/client";

export interface SiteSummary {
  id: string;
  nom: string;
  code: string | null;
}

/**
 * Retourne les sites accessibles à un utilisateur dans un tenant.
 *
 * @param tenantId  Le tenant actif
 * @param userId    L'utilisateur
 * @param isSiteAdmin  true si TENANT_ADMIN ou SUPER_ADMIN (voit tous les sites)
 */
export async function getSitesForUserCached(
  tenantId: string,
  userId: string,
  isSiteAdmin: boolean
): Promise<SiteSummary[]> {
  return cached(
    cacheKey(tenantId, "sites-for-user", userId, isSiteAdmin ? "admin" : "user"),
    () => runWithTenant(tenantId, null, async () => {
      const where: Prisma.SiteWhereInput = isSiteAdmin
        ? { tenantId, actif: true, deletedAt: null }
        : {
            tenantId,
            actif: true,
            deletedAt: null,
            OR: [
              { userSites: { some: { userId } } },
              { enseignantSites: { some: { enseignant: { userId, tenantId } } } },
            ],
          };

      const sites = await prisma.site.findMany({
        where,
        select: { id: true, nom: true, code: true },
        orderBy: { nom: "asc" },
      });

      return sites;
    }),
    60 // 1 minute
  );
}

/**
 * Invalide le cache des sites pour un utilisateur dans un tenant.
 */
export async function invalidateSitesForUser(
  tenantId: string,
  userId: string
): Promise<void> {
  await cacheDel(cacheKey(tenantId, "sites-for-user", userId, "admin"));
  await cacheDel(cacheKey(tenantId, "sites-for-user", userId, "user"));
}
