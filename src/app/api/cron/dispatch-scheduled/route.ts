import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { dispatchNotification } from "@/lib/notifications/dispatch";
import { refuserSiNonAutorise, pourChaqueTenant } from "@/lib/cron";

/**
 * Cron — Envoi des notifications planifiées arrivées à échéance.
 * ============================================================
 * Protégé par CRON_SECRET : `Authorization: Bearer <CRON_SECRET>`.
 * Planifié toutes les 5 min par Ofelia (docker/ofelia). Chaque
 * établissement est traité dans son propre contexte RLS : sans session,
 * une requête Prisma hors contexte est refusée.
 */
async function handler(req: NextRequest) {
  const refus = refuserSiNonAutorise(req);
  if (refus) return refus;

  const parTenant = await pourChaqueTenant((tenant) => dispatchTenant(tenant.id));
  const results = parTenant.flatMap((r) => (r.ok ? r.resultat : []));
  const erreurs = parTenant.filter((r) => !r.ok);

  return NextResponse.json(
    { processed: results.length, results, ...(erreurs.length > 0 && { erreurs }) },
    { status: erreurs.length > 0 ? 500 : 200 },
  );
}

async function dispatchTenant(tenantId: string) {
  const now = new Date();

  // Verrou léger : on passe les notifications dues en EN_ENVOI d'abord,
  // pour éviter qu'un second tick ne les reprenne en parallèle.
  // eslint-disable-next-line ecolemiriam/require-site-filter -- cron (CRON_SECRET) : notifications dues du tenant, tous sites, pas de session utilisateur
  const due = await prisma.notification.findMany({
    where: { tenantId, statut: "PLANIFIEE", planifieeAt: { lte: now } },
    select: { id: true, tenantId: true },
    take: 100,
  });

  if (due.length === 0) return [];

  await prisma.notification.updateMany({
    where: { tenantId, id: { in: due.map((d) => d.id) } },
    data: { statut: "EN_ENVOI" },
  });

  const results = [];
  for (const n of due) {
    try {
      const r = await dispatchNotification(n.id, n.tenantId);
      results.push({ id: n.id, ...r });
    } catch (e) {
      console.error(`[Cron] Échec dispatch ${n.id}:`, e);
      // eslint-disable-next-line ecolemiriam/require-tenant-id -- id provient de la requête ci-dessus, bornée au tenant
      await prisma.notification.update({
        where: { id: n.id },
        data: { statut: "ECHEC" },
      });
      results.push({ id: n.id, success: false });
    }
  }
  return results;
}

export const GET = handler;
export const POST = handler;
