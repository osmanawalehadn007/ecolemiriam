import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { refuserSiNonAutorise, pourChaqueTenant } from "@/lib/cron";

/**
 * Cron endpoint: PURGE definitively deleted sites after their grace period.
 *
 * Protect with CRON_SECRET env var. Call daily via Vercel/Netlify cron.
 *
 * GET /api/cron/purge-sites
 * Header: Authorization: Bearer <CRON_SECRET>
 */

export async function GET(req: NextRequest) {
  const refus = refuserSiNonAutorise(req);
  if (refus) return refus;

  const parTenant = await pourChaqueTenant((tenant) => purgerTenant(tenant.id));
  const bilans = parTenant.flatMap((r) => (r.ok ? [r.resultat] : []));
  const erreurs = [
    ...bilans.flatMap((b) => b.errors),
    ...parTenant.flatMap((r) => (r.ok ? [] : [`tenant ${r.tenantId}: ${r.erreur}`])),
  ];

  return NextResponse.json({
    purged: bilans.reduce((s, b) => s + b.purged, 0),
    total: bilans.reduce((s, b) => s + b.total, 0),
    errors: erreurs.length > 0 ? erreurs : undefined,
    timestamp: new Date().toISOString(),
  });
}

// Tâche système authentifiée par CRON_SECRET, sans session : chaque tenant
// est traité dans son contexte RLS pour purger ses sites arrivés à échéance.
async function purgerTenant(tenantId: string) {
  const now = new Date();

  const sitesToPurge = await prisma.site.findMany({
    where: {
      tenantId,
      deletedAt: { not: null },
      scheduledPurgeAt: { lte: now },
    },
    select: {
      id: true,
      nom: true,
      tenantId: true,
      deletedBy: true,
      deletedReason: true,
    },
  });

  let purged = 0;
  const errors: string[] = [];

  for (const site of sitesToPurge) {
    try {
      await prisma.$transaction([
        prisma.siteDeletionLog.create({
          data: {
            tenantId: site.tenantId,
            siteId: site.id,
            siteNom: site.nom,
            action: "PURGE",
            reason: site.deletedReason,
            performedBy: site.deletedBy ?? "system",
            performedByName: "System (automated purge)",
            metadata: { purgedAt: now.toISOString() },
          },
        }),
        // Le site vient de la requête ci-dessus, déjà bornée aux sites échus.
        // eslint-disable-next-line ecolemiriam/require-tenant-id
        prisma.site.delete({ where: { id: site.id } }),
      ]);
      purged++;
    } catch (err) {
      errors.push(`Site "${site.nom}" (${site.id}): ${err instanceof Error ? err.message : "unknown"}`);
    }
  }

  return { purged, total: sitesToPurge.length, errors };
}
