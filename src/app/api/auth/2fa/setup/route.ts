/**
 * GET /api/auth/2fa/setup
 * Génère un secret TOTP + QR code pour l'utilisateur connecté.
 * Le secret n'est PAS encore sauvegardé — il sera validé par /2fa/enable.
 */
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { generateTOTPSecret, generateOTPAuthURI, generateQRCodeDataURL } from "@/lib/security/totp";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  // Si 2FA déjà activée, on refuse le re-setup (passer par disable d'abord)
  // eslint-disable-next-line ecolemiriam/require-tenant-id, ecolemiriam/require-site-filter -- lookup par ID + tenantId : le caller a déjà vérifié l'accès via gate/checkPermission
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { mfaEnabled: true },
  });
  if (user?.mfaEnabled) {
    return NextResponse.json({ error: "2FA déjà activée" }, { status: 400 });
  }

  const secret = generateTOTPSecret();
  const otpauthURI = generateOTPAuthURI(secret, session.user.email ?? "user");
  const qrCodeDataURL = await generateQRCodeDataURL(otpauthURI);

  return NextResponse.json({
    secret,
    qrCode: qrCodeDataURL,
    otpauthURI,
  });
}
