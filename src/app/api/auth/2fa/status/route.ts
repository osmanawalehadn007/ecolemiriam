/**
 * GET /api/auth/2fa/status
 * Retourne le statut 2FA de l'utilisateur connecté.
 */
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { mfaEnabled: true },
  });

  return NextResponse.json({ enabled: user?.mfaEnabled ?? false });
}
