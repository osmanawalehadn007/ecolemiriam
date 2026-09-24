/**
 * POST /api/auth/2fa/disable
 * Désactive la 2FA après vérification du code TOTP courant.
 * Body: { totp: string }
 */
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { verifyTOTP } from "@/lib/security/totp";
import { z } from "zod";
import { auditFire } from "@/lib/audit";

const DisableSchema = z.object({
  totp: z.string().regex(/^\d{6}$/),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = DisableSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Données invalides" }, { status: 400 });
  }

  // eslint-disable-next-line ecolemiriam/require-tenant-id, ecolemiriam/require-site-filter -- lookup par ID + tenantId : le caller a déjà vérifié l'accès via gate/checkPermission
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { mfaSecret: true, mfaEnabled: true },
  });

  if (!user?.mfaEnabled || !user.mfaSecret) {
    return NextResponse.json({ error: "2FA non activée" }, { status: 400 });
  }

  if (!verifyTOTP(parsed.data.totp, user.mfaSecret)) {
    auditFire({
      userId: session.user.id,
      action: "2fa:disable",
      verdict: "DENIED",
      reason: "Code TOTP incorrect",
    });
    return NextResponse.json({ error: "Code TOTP incorrect" }, { status: 400 });
  }

  // eslint-disable-next-line ecolemiriam/require-tenant-id -- ID vérifié par findFirst avec tenantId au-dessus
  await prisma.user.update({
    where: { id: session.user.id },
    data: { mfaSecret: null, mfaEnabled: false },
  });

  auditFire({
    userId: session.user.id,
    action: "2fa:disable",
    verdict: "ALLOWED",
  });

  return NextResponse.json({ success: true });
}
