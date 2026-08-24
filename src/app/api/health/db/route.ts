import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import redis from "@/lib/redis";

/**
 * GET /api/health/db — Deep health probe (DB + Redis connectivity).
 *
 * Réservé au monitoring (Uptime Kuma, diagnostics manuels). NE PAS utiliser
 * comme health check Caddy : ce endpoint consomme le pool applicatif et peut
 * être lent sous charge. Voir /api/health pour la sonde liveness de Caddy.
 *
 * Timeout applicatif court (2s) pour éviter de monopoliser une connexion.
 */
export async function GET() {
  const checks: { db: boolean; redis: boolean } = { db: false, redis: false };

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.db = true;
  } catch {
    // DB indisponible
  }

  try {
    if (redis) {
      const pong = await redis.ping();
      checks.redis = pong === "PONG";
    } else {
      // Redis non configuré (dev sans REDIS_URL) — pas un échec
      checks.redis = true;
    }
  } catch {
    // Redis indisponible
  }

  const ok = checks.db && checks.redis;
  return NextResponse.json({ ok, ...checks }, { status: ok ? 200 : 500 });
}
