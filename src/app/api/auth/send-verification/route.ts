/**
 * POST /api/auth/send-verification
 * Renvoie un email de vérification à un utilisateur existant.
 *
 * Body: { email: string }
 * Returns:
 *   200 { success: true } — email envoyé (ou déjà vérifié)
 *   400 { error } — email invalide
 *
 * Sécurité : ne révèle jamais si l'email existe ou non (anti-énumération).
 * Retourne toujours success: true sauf si l'email est déjà vérifié.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import prismaBase from "@/lib/prisma-base";
import { sendVerificationEmail, isEmailVerified } from "@/lib/security/email-verification";
import { rateLimit, getClientIP } from "@/lib/security/rateLimit";
import { auditFire } from "@/lib/audit";

const SendSchema = z.object({
  email: z.string().email("Email invalide"),
});

export async function POST(req: Request) {
  try {
    const ip = getClientIP(req as unknown as import("next/server").NextRequest);
    const rl = rateLimit({ max: 3, windowSec: 300, key: `send-verification:${ip}` });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Trop de demandes. Réessayez dans 5 minutes." },
        { status: 429, headers: { "Retry-After": "300" } }
      );
    }

    const body = await req.json();
    const parsed = SendSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Email invalide" }, { status: 400 });
    }

    const { email } = parsed.data;

    // Anti-énumération : on ne révèle pas si l'email existe.
     
    const user = await prismaBase.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: {
        id: true,
        name: true,
        email: true,
        emailVerified: true,
        isActive: true,
        tenant: { select: { name: true } },
      },
    });

    if (!user || !user.isActive) {
      // Ne pas révéler que l'email n'existe pas — retourner un succès factice
      return NextResponse.json({ success: true });
    }

    // Si l'email est déjà vérifié, on l'indique
    if (user.emailVerified) {
      return NextResponse.json({
        success: true,
        alreadyVerified: true,
        message: "Cet email est déjà vérifié. Vous pouvez vous connecter.",
      });
    }

    const result = await sendVerificationEmail(
      user.email,
      user.name,
      user.tenant?.name,
      true // force : supprime les tokens précédents
    );

    if (!result.success) {
      auditFire({
        userId: user.id,
        action: "auth:send-verification",
        verdict: "DENIED",
        reason: result.error ?? "Échec d'envoi",
        metadata: { email },
      });
      return NextResponse.json(
        { error: "Impossible d'envoyer l'email de vérification. Réessayez plus tard." },
        { status: 500 }
      );
    }

    auditFire({
      userId: user.id,
      action: "auth:send-verification",
      verdict: "ALLOWED",
      reason: "Email de vérification renvoyé",
      metadata: { email },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[API/auth/send-verification]", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
