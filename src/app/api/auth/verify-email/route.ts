/**
 * POST /api/auth/verify-email
 * Valide un token de vérification email et marque l'email comme vérifié.
 *
 * Body: { token: string }
 * Returns:
 *   200 { success: true, email } — email vérifié avec succès
 *   400 { error } — token invalide, expiré ou déjà utilisé
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyEmailToken } from "@/lib/security/email-verification";
import { rateLimit, getClientIP } from "@/lib/security/rateLimit";
import { auditFire } from "@/lib/audit";

const VerifySchema = z.object({
  token: z.string().min(1, "Token requis"),
});

export async function POST(req: Request) {
  try {
    const ip = getClientIP(req as unknown as import("next/server").NextRequest);
    const rl = rateLimit({ max: 10, windowSec: 60, key: `verify-email:${ip}` });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Trop de tentatives. Réessayez dans un instant." },
        { status: 429, headers: { "Retry-After": "60" } }
      );
    }

    const body = await req.json();
    const parsed = VerifySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Token invalide" },
        { status: 400 }
      );
    }

    const result = await verifyEmailToken(parsed.data.token);

    if (!result.success) {
      auditFire({
        action: "auth:verify-email",
        verdict: "DENIED",
        resource: "user",
        reason: result.error ?? "Token invalide",
        metadata: { tokenPrefix: parsed.data.token.slice(0, 8) },
      });
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    auditFire({
      action: "auth:verify-email",
      verdict: "ALLOWED",
      resource: "user",
      reason: "Email vérifié avec succès",
      metadata: { email: result.email },
    });

    return NextResponse.json({ success: true, email: result.email });
  } catch (error) {
    console.error("[API/auth/verify-email]", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
