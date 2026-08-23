/**
 * POST /api/auth/reset-password
 * Valide un token de reset et définit le nouveau mot de passe.
 *
 * Body: { token: string, password: string }
 * Returns:
 *   200 { success: true, email } — mot de passe mis à jour
 *   400 { error } — token invalide, expiré, ou mot de passe faible
 *   429 — trop de tentatives
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { resetPasswordWithToken } from "@/lib/security/password-reset";
import { rateLimit, getClientIP } from "@/lib/security/rateLimit";
import { auditFire } from "@/lib/audit";

const ResetSchema = z.object({
  token: z.string().min(1, "Token requis"),
  password: z.string().min(8, "Le mot de passe doit faire au moins 8 caractères"),
});

export async function POST(req: Request) {
  try {
    const ip = getClientIP(req as unknown as import("next/server").NextRequest);
    const rl = rateLimit({ max: 10, windowSec: 60, key: `reset-password:${ip}` });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Trop de tentatives. Réessayez dans un instant." },
        { status: 429, headers: { "Retry-After": "60" } }
      );
    }

    const body = await req.json();
    const parsed = ResetSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Données invalides" },
        { status: 400 }
      );
    }

    const result = await resetPasswordWithToken(
      parsed.data.token,
      parsed.data.password
    );

    if (!result.success) {
      auditFire({
        action: "auth:reset-password",
        verdict: "DENIED",
        resource: "user",
        reason: result.error ?? "Token invalide",
        metadata: { tokenPrefix: parsed.data.token.slice(0, 8) },
      });
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    auditFire({
      action: "auth:reset-password",
      verdict: "ALLOWED",
      resource: "user",
      reason: "Mot de passe réinitialisé avec succès",
      metadata: { email: result.email },
    });

    return NextResponse.json({ success: true, email: result.email });
  } catch (error) {
    console.error("[API/auth/reset-password]", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
