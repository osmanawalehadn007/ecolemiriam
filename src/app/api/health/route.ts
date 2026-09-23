import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { rateLimit } from "@/lib/security/rate-limit";

export async function GET(req: NextRequest) {
  const limited = await rateLimit(req, {
    keyPrefix: "health:ip",
    limit: 60,
    windowSeconds: 60,
    skipInDev: false,
  });
  if (limited) return limited;

  try {
    // eslint-disable-next-line ecolpro/require-site-filter -- health check système sans session utilisateur
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true, timestamp: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
