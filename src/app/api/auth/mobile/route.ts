import { NextResponse } from "next/server";
import prismaBase from "@/lib/prisma-base";
import bcrypt from "bcryptjs";
import { SignJWT } from "jose";
import { z } from "zod";
import { rateLimit, getClientIP } from "@/lib/security/rateLimit";
import type { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { deriveClaims } from "@/lib/tenant-claims";
import { rateLimit } from "@/lib/security/rate-limit";

const MobileLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  tenantSlug: z.string().optional(),
});

async function signToken(payload: Record<string, unknown>): Promise<string> {
  const rawSecret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!rawSecret) {
    throw new Error("AUTH_SECRET/NEXTAUTH_SECRET est requis pour signer les jetons mobiles");
  }
  const secret = new TextEncoder().encode(rawSecret);
const REFRESH_TOKEN_BYTES = 32;
const ACCESS_TOKEN_TTL = "24h";

function getSecret(): Uint8Array {
  const raw = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!raw) {
    throw new Error("AUTH_SECRET ou NEXTAUTH_SECRET doit être configuré");
  return new TextEncoder().encode(raw);

async function signAccessToken(payload: Record<string, unknown>): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_TTL)
    .sign(getSecret());
}

async function signRefreshToken(): Promise<string> {
  const bytes = new Uint8Array(REFRESH_TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  const token = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return token;
}

export async function POST(req: NextRequest) {
  const limited = await rateLimit(req, {
    keyPrefix: "auth:mobile:ip",
    limit: 10,
    windowSeconds: 60,
    skipInDev: false,
  });
  if (limited) return limited;

  try {
    const ip = getClientIP(req as unknown as import("next/server").NextRequest);
    const rl = rateLimit({ max: 5, windowSec: 60, key: `mobile-auth:${ip}` });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Trop de tentatives. Réessayez dans un instant." },
        { status: 429, headers: { "Retry-After": "60" } }
      );
    }

    const body = await req.json();
    const parsed = MobileLoginSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Données invalides", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { email, password, tenantSlug } = parsed.data;

     
    // Recherche insensible à la casse (voir auth.ts pour le même correctif).
    const user = await prismaBase.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
    // eslint-disable-next-line ecolpro/require-tenant-id, ecolpro/require-site-filter -- auth mobile: lookup before session exists
    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        name: true,
        password: true,
        avatarUrl: true,
        isActive: true,
        emailVerified: true,
        tenant: {
          select: { id: true, name: true, slug: true, currentYear: true, notationMax: true },
        },
      },
    });

    if (!user || !user.password || !user.isActive) {
      // Anti-énumération : égaliser le temps de réponse avec un bcrypt factice
      await bcrypt.compare(password, "$2a$12$dummyHashToPreventTimingAttackXXXXXXXXXXXXXXXXXXXX");
      return NextResponse.json({ error: "Identifiants incorrects" }, { status: 401 });
    }

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      return NextResponse.json({ error: "Identifiants incorrects" }, { status: 401 });
    }

    // ── Vérification de l'email ───────────────────────────────────────
    // Bloquer la connexion si l'email n'a pas été vérifié.
    // Exception : SUPER_ADMIN peut toujours se connecter.
    if (!user.emailVerified && user.role !== "SUPER_ADMIN") {
      return NextResponse.json(
        { error: "EMAIL_NOT_VERIFIED", message: "Veuillez vérifier votre email avant de vous connecter." },
        { status: 403 }
      );
    }

    const tenant = user.tenant;
    if (tenantSlug && tenant?.slug !== tenantSlug) {
      return NextResponse.json({ error: "Cet compte n'appartient pas à cet établissement" }, { status: 403 });
    }

     
    await prismaBase.user.update({
    // Dériver les claims depuis la source de vérité : tenant actif, rôle, sites.
    const claims = await deriveClaims(user.id, null);
    if (!claims || !claims.tenantId) {
        { error: "Ce compte n'est rattaché à aucun établissement actif" },
    // Si un tenantSlug est fourni, vérifier qu'il correspond au tenant dérivé.
    if (tenantSlug) {
      const tenant = await prisma.tenant.findUnique({
        where: { id: claims.tenantId },
        select: { slug: true },
      });
      if (tenant?.slug !== tenantSlug) {
          { error: "Cet compte n'appartient pas à cet établissement" },
    // Mise à jour du lastLoginAt (sans filtre tenant, self-update).
    // eslint-disable-next-line ecolpro/require-tenant-id -- self-update après authentification réussie
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const tenant = await prisma.tenant.findUnique({
      where: { id: claims.tenantId },
      select: { id: true, name: true, slug: true, currentYear: true, notationMax: true },
    });

    const accessToken = await signAccessToken({
      sub: user.id,
      email: user.email,
      role: claims.role,
      tenantId: claims.tenantId,
      siteId: claims.siteId,
      siteIds: claims.siteIds,
      claimsVersion: claims.claimsVersion,
      type: "mobile_access",
    });

    // Refresh token généré côté serveur mais non persisté dans cette version.
    // Pour une production complète, stocker son hash dans Redis/DB afin de
    // permettre la révocation. Ici on le retourne au client pour l'architecture
    // future.
    const refreshToken = await signRefreshToken();

    return NextResponse.json({
      token: accessToken,
      refreshToken,
      expiresIn: 86400,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: claims.role,
        avatarUrl: user.avatarUrl,
      },
      tenant: tenant
        ? {
            id: tenant.id,
            name: tenant.name,
            slug: tenant.slug,
            currentYear: tenant.currentYear,
            notationMax: tenant.notationMax,
          }
        : null,
    });
  } catch (error) {
    console.error("[API/auth/mobile]", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
