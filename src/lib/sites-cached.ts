/**
 * École Miriam — Sites accessibles à un utilisateur (mis en cache)
 * ================================================================
 *
 * Source unique et cachée pour la liste des sites d'un utilisateur.
 * Le layout du dashboard, les pages (dashboard, eleves, etc.) et les
 * server actions partagent tous le même cache → une seule requête DB
 * pour toute la durée de vie du cache (60s), quel que soit le nombre
 * de composants qui ont besoin des sites.
 *
 * Note: unstable_cache détache le contexte requête → auth() échoue →
 * l'extension RLS ne positionne pas SET LOCAL. runWithTenant injecte
 * le contexte via AsyncLocalStorage.
 */

import prisma from "@/lib/prisma";
import { runWithTenant } from "@/lib/prisma";
import { unstable_cache } from "next/cache";
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
export const getSitesForUserCached = unstable_cache(
  async (
    tenantId: string,
    userId: string,
    isSiteAdmin: boolean
  ): Promise<SiteSummary[]> => {
    return runWithTenant(tenantId, null, async () => {
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
    });
  },
  ["sites-for-user"],
  { revalidate: 60, tags: ["sites-for-user"] }
);
