/**
 * POST /api/auth/forgot-password
 * Envoie un email de réinitialisation de mot de passe.
 *
 * Body: { email: string }
 * Returns:
 *   200 { success: true } — email envoyé (ou compte inexistant → succès factice)
 *   400 { error } — email invalide
 *   429 — trop de demandes
 *
 * Sécurité : ne révèle jamais si l'email existe ou non (anti-énumération).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import prismaBase from "@/lib/prisma-base";
import { sendPasswordResetEmail } from "@/lib/security/password-reset";
import { rateLimit, getClientIP } from "@/lib/security/rateLimit";
import { auditFire } from "@/lib/audit";

const ForgotSchema = z.object({
  email: z.string().email("Email invalide"),
});

export async function POST(req: Request) {
  try {
    const ip = getClientIP(req as unknown as import("next/server").NextRequest);
    const rl = rateLimit({ max: 3, windowSec: 300, key: `forgot-password:${ip}` });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Trop de demandes. Réessayez dans 5 minutes." },
        { status: 429, headers: { "Retry-After": "300" } }
      );
    }

    const body = await req.json();
    const parsed = ForgotSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Email invalide" }, { status: 400 });
    }

    const { email } = parsed.data;

    // Anti-énumération : on ne révèle pas si l'email existe.
    // eslint-disable-next-line ecolemiriam/require-tenant-id, ecolemiriam/require-site-filter -- pré-login : lookup par email
    const user = await prismaBase.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: {
        id: true,
        name: true,
        email: true,
        isActive: true,
        tenant: { select: { name: true } },
      },
    });

    if (!user || !user.isActive) {
      // Ne pas révéler que l'email n'existe pas — retourner un succès factice
      return NextResponse.json({ success: true });
    }

    const result = await sendPasswordResetEmail(
      user.email,
      user.name,
      user.tenant?.name
    );

    if (!result.success) {
      auditFire({
        userId: user.id,
        action: "auth:forgot-password",
        verdict: "DENIED",
        reason: result.error ?? "Échec d'envoi",
        metadata: { email },
      });
      // Ne pas révéler l'échec à l'utilisateur pour l'anti-énumération
      return NextResponse.json({ success: true });
    }

    auditFire({
      userId: user.id,
      action: "auth:forgot-password",
      verdict: "ALLOWED",
      reason: "Email de reset envoyé",
      metadata: { email },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[API/auth/forgot-password]", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
