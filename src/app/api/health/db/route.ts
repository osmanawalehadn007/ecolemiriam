import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

/**
 * GET /api/health/db — Deep health probe (DB connectivity).
 *
 * Réservé au monitoring (Uptime Kuma, diagnostics manuels). NE PAS utiliser
 * comme health check Caddy : ce endpoint consomme le pool applicatif et peut
 * être lent sous charge. Voir /api/health pour la sonde liveness de Caddy.
 *
 * Timeout applicatif court (2s) pour éviter de monopoliser une connexion.
 */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true, db: true }, { status: 200 });
  } catch {
    return NextResponse.json({ ok: false, db: false }, { status: 500 });
  }
}
