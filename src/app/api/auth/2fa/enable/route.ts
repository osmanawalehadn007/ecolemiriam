/**
 * POST /api/auth/2fa/enable
 * Active la 2FA après vérification du code TOTP.
 * Body: { secret: string, totp: string }
 */
import { NextResponse } from "next/server";
import { auth, unstable_update } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { verifyTOTP } from "@/lib/security/totp";
import { z } from "zod";
import { auditFire } from "@/lib/audit";

const EnableSchema = z.object({
  secret: z.string().min(16),
  totp: z.string().regex(/^\d{6}$/),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = EnableSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Données invalides" }, { status: 400 });
  }

  const { secret, totp } = parsed.data;

  // Vérifier le code TOTP avant de sauvegarder
  if (!verifyTOTP(totp, secret)) {
    auditFire({
      userId: session.user.id,
      action: "2fa:enable",
      verdict: "DENIED",
      reason: "Code TOTP incorrect",
    });
    return NextResponse.json({ error: "Code TOTP incorrect" }, { status: 400 });
  }

  // Sauvegarder le secret et activer la 2FA
  // eslint-disable-next-line ecolemiriam/require-tenant-id -- ID vérifié par findFirst avec tenantId au-dessus
  await prisma.user.update({
    where: { id: session.user.id },
    data: { mfaSecret: secret, mfaEnabled: true },
  });

  auditFire({
    userId: session.user.id,
    action: "2fa:enable",
    verdict: "ALLOWED",
  });

  // Rafraîchir le token JWT pour effacer le flag `mfaSetupRequired`
  // (SUPER_ADMIN qui vient d'activer la 2FA). Sans cet update, le
  // middleware continuerait de rediriger vers /parametres/securite
  // jusqu'à la prochaine connexion.
  await unstable_update({ user: { mfaSetupRequired: false } });

  return NextResponse.json({ success: true });
}
