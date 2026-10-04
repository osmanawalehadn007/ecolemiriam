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
import { verifyTurnstileToken } from "@/lib/security/turnstile";
import { auditFire } from "@/lib/audit";

const ForgotSchema = z.object({
  email: z.string().trim().email("Email invalide"),
  turnstileToken: z.string().nullable().optional(),
});

export async function POST(req: Request) {
  try {
    const ip = getClientIP(req as unknown as import("next/server").NextRequest);
    const tropDeDemandes = () =>
      NextResponse.json(
        { error: "Trop de demandes. Réessayez dans 5 minutes." },
        { status: 429, headers: { "Retry-After": "300" } }
      );

    // Une école entière partage une seule IP publique (NAT), et sans
    // CF-Connecting-IP toutes les requêtes tombent sur la clé « unknown ».
    // L'ancien plafond de 3 demandes / 5 min PAR IP bloquait donc tout
    // l'établissement dès la quatrième personne. Le plafond strict porte
    // désormais sur l'adresse email visée ; celui par IP ne sert plus qu'à
    // contenir un envoi en masse.
    if (!rateLimit({ max: 30, windowSec: 300, key: `forgot-password:${ip}` }).allowed) {
      return tropDeDemandes();
    }

    const body = await req.json();
    const parsed = ForgotSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Email invalide" }, { status: 400 });
    }

    const { email, turnstileToken } = parsed.data;

    if (!rateLimit({ max: 3, windowSec: 300, key: `forgot-password:email:${email.toLowerCase()}` }).allowed) {
      return tropDeDemandes();
    }

    // ── Vérification Turnstile (anti-bot) ──────────────────────────────
    const turnstileResult = await verifyTurnstileToken(turnstileToken, req);
    if (!turnstileResult.success) {
      auditFire({
        action: "auth:forgot-password",
        verdict: "DENIED",
        reason: "Vérification Turnstile échouée",
        metadata: { email, errorCodes: turnstileResult.errorCodes },
      });
      return NextResponse.json(
        { error: "Vérification anti-bot échouée. Veuillez réessayer." },
        { status: 403 }
      );
    }

    // Anti-énumération : on ne révèle pas si l'email existe.
     
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
      // La réponse reste un succès factice (anti-énumération) : ce log est
      // donc la seule trace visible d'un email qui n'est jamais parti.
      console.error("[API/auth/forgot-password] email de reset NON envoyé:", result.error);
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
