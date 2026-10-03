import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import prisma, { runWithTenant } from "@/lib/prisma";

/**
 * Outils communs aux routes /api/cron/*, appelées par Ofelia depuis le
 * conteneur applicatif (voir docker/ofelia/config.ini sur le serveur).
 */

/** Renvoie une réponse 401 si l'en-tête `Authorization: Bearer <CRON_SECRET>` est absent ou faux. */
export function refuserSiNonAutorise(req: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  const fourni = req.headers.get("authorization") ?? "";
  const attendu = `Bearer ${secret}`;
  const ok =
    !!secret &&
    fourni.length === attendu.length &&
    timingSafeEqual(Buffer.from(fourni), Buffer.from(attendu));
  return ok ? null : NextResponse.json({ error: "Non autorisé" }, { status: 401 });
}

/**
 * Exécute `fn` pour chaque établissement non résilié, dans son contexte RLS.
 *
 * Sans session, le client Prisma RLS refuse toute requête (« contexte tenant
 * manquant ») : c'est pourquoi les crons qui interrogeaient directement
 * `prisma.facture` hors contexte ne pouvaient pas fonctionner. Le site est
 * laissé à null : la policy RLS ouvre alors tous les sites du tenant.
 * Une erreur sur un établissement n'interrompt pas les suivants.
 */
export async function pourChaqueTenant<T>(
  fn: (tenant: { id: string; name: string }) => Promise<T>,
): Promise<Array<{ tenantId: string; ok: true; resultat: T } | { tenantId: string; ok: false; erreur: string }>> {
  // Tenant est exempté de RLS : lisible sans contexte.
  const tenants = await prisma.tenant.findMany({
    where: { status: { not: "CANCELLED" } },
    select: { id: true, name: true },
  });
  const sorties = [];
  for (const tenant of tenants) {
    try {
      const resultat = await runWithTenant(tenant.id, null, () => fn(tenant));
      sorties.push({ tenantId: tenant.id, ok: true as const, resultat });
    } catch (err) {
      console.error(`[cron] échec pour le tenant ${tenant.id}:`, err);
      sorties.push({ tenantId: tenant.id, ok: false as const, erreur: err instanceof Error ? err.message : String(err) });
    }
  }
  return sorties;
}

/** Date du jour à Djibouti (UTC+3), indépendamment du fuseau du serveur. */
export function dateDjibouti(maintenant: Date = new Date()): { annee: number; mois: number; jour: number } {
  const parties = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Djibouti",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(maintenant);
  const val = (type: string) => parseInt(parties.find((p) => p.type === type)!.value, 10);
  return { annee: val("year"), mois: val("month"), jour: val("day") };
}
