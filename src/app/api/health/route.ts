import { NextResponse } from "next/server";

/**
 * GET /api/health — Liveness probe (Caddy health check).
 *
 * Réponse statique 200 : confirme uniquement que le process Node est vivant
 * et capable de servir du trafic. NE dépend PAS du pool DB.
 *
 * Raison : si ce endpoint partage le pool applicatif Prisma, une latence
 * sur l'event loop (bcrypt JS, transactions RLS multi-allers-retours) fait
 * dépasser le health_timeout 5s de Caddy → retrait de l'unique upstream →
 * 503 global pendant ~30s pour 100% des utilisateurs. Voir diagnostic P0-3.
 *
 * Pour un check DB profond (monitoring Uptime Kuma), utiliser /api/health/db.
 */
export async function GET() {
  return NextResponse.json({ ok: true }, { status: 200 });
}
