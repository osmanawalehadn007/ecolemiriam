import prisma from "@/lib/prisma";
import { runWithTenant } from "@/lib/prisma";
import { unstable_cache } from "next/cache";

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
 * OPTIMISATION: mise en cache 10 minutes — les sites changent rarement
 * et la couleur est dérivée de l'ordre de création (stable).
 *
 * Note: unstable_cache détache le contexte requête → auth() échoue →
 * l'extension RLS ne positionne pas SET LOCAL. runWithTenant injecte
 * le contexte via AsyncLocalStorage.
 */
export const getSiteColorMap = unstable_cache(
  async (tenantId: string): Promise<Record<string, SiteColor>> => {
    return runWithTenant(tenantId, null, async () => {
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
    });
  },
  ["site-colors"],
  { revalidate: 600, tags: ["site-colors"] }
);
