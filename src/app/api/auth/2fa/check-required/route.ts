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
import prisma from "@/lib/prisma";
import { z } from "zod";

const CheckSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = CheckSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ requires2FA: false, emailVerified: true }, { status: 200 });
  }

  const { email, password } = parsed.data;

  // eslint-disable-next-line ecolemiriam/require-tenant-id, ecolemiriam/require-site-filter -- pré-login : lookup par email pour vérifier 2FA/statut email, pas de session disponible
  const user = await prisma.user.findFirst({
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
