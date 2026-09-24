import prisma from "@/lib/prisma";
import { runWithTenant } from "@/lib/prisma";
import { cached, cacheDel, cacheKey } from "@/lib/redis";

export interface SiteColor {
  base: string;
  light: string;
  border: string;
  text: string;
}

function generateSiteColor(index: number): SiteColor {
  // Angle d'or : repartition progressive et contrastee sur 360°.
  // L'index est fixe par site (creation), donc la couleur est stable.
  const hue = Math.round((index * 137.5) % 360);
  return {
    base: `hsl(${hue} 75% 35%)`,
    light: `hsl(${hue} 90% 96%)`,
    border: `hsl(${hue} 80% 80%)`,
    text: `hsl(${hue} 80% 28%)`,
  };
}

/**
 * CACHE: Redis (10 minutes, partagé entre instances blue/green).
 * Les sites changent rarement et la couleur est dérivée de l'ordre
 * de création (stable).
 */
export async function getSiteColorMap(tenantId: string): Promise<Record<string, SiteColor>> {
  return cached(
    cacheKey(tenantId, "site-colors"),
    () => runWithTenant(tenantId, null, async () => {
      const sites = await prisma.site.findMany({
        where: { tenantId, deletedAt: null },
        select: { id: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      });

      const colors: Record<string, SiteColor> = {};
      for (let i = 0; i < sites.length; i++) {
        colors[sites[i].id] = generateSiteColor(i);
      }
      return colors;
    }),
    600 // 10 minutes
  );
}

/**
 * Invalide le cache des couleurs de sites pour un tenant.
 */
export async function invalidateSiteColorMap(tenantId: string): Promise<void> {
  await cacheDel(cacheKey(tenantId, "site-colors"));
}
