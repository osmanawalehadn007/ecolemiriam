/**
 * POST /api/auth/2fa/check-required
 * Vérifie si l'utilisateur a 2FA activée et/ou un email non vérifié,
 * SANS révéler si l'email existe.
 * Body: { email, password }
 * Returns: { requires2FA: boolean, emailVerified: boolean }
 *
 * Sécurité : ne révèle jamais si l'email existe ou si le mot de passe est
 * correct. Retourne toujours requires2FA=false et emailVerified=true en cas
 * d'erreur, pour ne pas révéler l'existence du compte.
 */
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
// Route pré-login : aucune session, donc aucun contexte tenant. Le modèle
// User étant désormais sous RLS stricte, le client RLS renverrait 0 ligne
// ici. Ce lookup par email est cross-tenant par nature → prismaBase.
import prismaBase from "@/lib/prisma-base";
import { z } from "zod";

const CheckSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// ── Anti-énumération : rate limit par email (5 tentatives / 15 min) ──────
// Caddy limite par IP (60/min), mais une école entière partage la même IP.
// Ce limiter par-email empêche un attaquant de valider des mots de passe en
// rafale sur un compte donné via cette route (oracle de mot de passe).
const LOGIN_ATTEMPTS = new Map<string, { count: number; windowStart: number }>();
const LOGIN_WINDOW_MS = 15 * 60_000;
const LOGIN_MAX_ATTEMPTS = 5;

function checkEmailRateLimit(email: string): boolean {
  const key = `2fa:${email.toLowerCase()}`;
  const now = Date.now();
  let bucket = LOGIN_ATTEMPTS.get(key);
  if (!bucket || now - bucket.windowStart > LOGIN_WINDOW_MS) {
    bucket = { count: 0, windowStart: now };
    LOGIN_ATTEMPTS.set(key, bucket);
  }
  bucket.count++;
  if (bucket.count > LOGIN_MAX_ATTEMPTS) return false;
  if (LOGIN_ATTEMPTS.size > 10_000) {
    for (const [k, b] of LOGIN_ATTEMPTS.entries()) {
      if (now - b.windowStart > LOGIN_WINDOW_MS * 2) LOGIN_ATTEMPTS.delete(k);
    }
  }
  return true;
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = CheckSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ requires2FA: false, emailVerified: true }, { status: 200 });
  }

  const { email, password } = parsed.data;

  // Anti-énumération : trop de tentatives sur cet email → réponse neutre 429
  if (!checkEmailRateLimit(email)) {
    return NextResponse.json(
      { requires2FA: false, emailVerified: true },
      { status: 429, headers: { "Retry-After": "900" } }
    );
  }

  // eslint-disable-next-line ecolemiriam/require-tenant-id, ecolemiriam/require-site-filter -- pré-login : lookup par email pour vérifier 2FA/statut email, pas de session disponible
  const user = await prismaBase.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { password: true, isActive: true, mfaEnabled: true, emailVerified: true, role: true },
  });

  // Si l'utilisateur n'existe pas, est inactif, ou mot de passe incorrect :
  // retourner requires2FA=false et emailVerified=true pour ne pas révéler
  // l'existence du compte.
  if (!user || !user.password || !user.isActive) {
    return NextResponse.json({ requires2FA: false, emailVerified: true }, { status: 200 });
  }

  const passwordMatch = await bcrypt.compare(password, user.password);
  if (!passwordMatch) {
    return NextResponse.json({ requires2FA: false, emailVerified: true }, { status: 200 });
  }

  // L'utilisateur est authentifié : on peut révéler le statut 2FA et email.
  // SUPER_ADMIN est toujours considéré comme vérifié (exemption).
  const isEmailVerified = !!user.emailVerified || user.role === "SUPER_ADMIN";

  return NextResponse.json(
    { requires2FA: user.mfaEnabled, emailVerified: isEmailVerified },
    { status: 200 }
  );
}
