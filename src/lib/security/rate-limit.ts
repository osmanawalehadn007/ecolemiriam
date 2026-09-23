/**
 * EcolPro — Rate limiting
 * ========================
 * Supporte Redis/Upstash en production et un store in-memory en développement.
 * Les limites sont exprimées en "requests par fenêtre".
 */

import { NextRequest, NextResponse } from "next/server";

export interface RateLimitConfig {
  /** Nombre maximum de requêtes par fenêtre */
  limit: number;
  /** Durée de la fenêtre en secondes */
  windowSeconds: number;
  /** Nom de la route utilisé comme préfixe de clé */
  keyPrefix: string;
  /** Si true, ignore le rate limiting en développement (sauf erreur explicite) */
  skipInDev?: boolean;
}

interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number;
}

/** Store in-memory pour le développement ou fallback. */
const memoryStore = new Map<string, { count: number; resetAt: number }>();

function getKey(prefix: string, identifier: string): string {
  return `rate_limit:${prefix}:${identifier}`;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

async function slidingWindowCheck(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const now = nowSeconds();
  const windowStart = now - windowSeconds;

  // Mode in-memory simple : on stocke count + resetAt par fenêtre fixe.
  // Pour une fenêtre glissante plus fine, utiliser Redis/Upstash.
  const record = memoryStore.get(key);
  if (!record || record.resetAt <= now) {
    memoryStore.set(key, { count: 1, resetAt: now + windowSeconds });
    return { success: true, limit, remaining: limit - 1, reset: now + windowSeconds };
  }

  if (record.count >= limit) {
    return {
      success: false,
      limit,
      remaining: 0,
      reset: record.resetAt,
    };
  }

  record.count += 1;
  return { success: true, limit, remaining: limit - record.count, reset: record.resetAt };
}

async function upstashCheck(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    return slidingWindowCheck(key, limit, windowSeconds);
  }

  const now = nowSeconds();
  const windowKey = `${key}:${Math.floor(now / windowSeconds)}`;
  const pipeline = [
    ["INCR", windowKey],
    ["EXPIRE", windowKey, windowSeconds],
  ];

  try {
    const res = await fetch(`${url}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(pipeline),
    });

    if (!res.ok) {
      // Fallback in-memory en cas d'indisponibilité Upstash.
      return slidingWindowCheck(key, limit, windowSeconds);
    }

    const data = (await res.json()) as [number, number];
    const count = data[0];
    const reset = (Math.floor(now / windowSeconds) + 1) * windowSeconds;
    return {
      success: count <= limit,
      limit,
      remaining: Math.max(0, limit - count),
      reset,
    };
  } catch {
    return slidingWindowCheck(key, limit, windowSeconds);
  }
}

function getClientIdentifier(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() ?? "anonymous";
  return ip;
}

/**
 * Vérifie le rate limit pour une requête entrante.
 * Retourne null si la requête est autorisée, ou une réponse NextResponse 429 sinon.
 */
export async function rateLimit(
  req: NextRequest,
  config: RateLimitConfig,
  identifier?: string
): Promise<NextResponse | null> {
  if (process.env.NODE_ENV === "development" && config.skipInDev !== false) {
    return null;
  }

  const id = identifier ?? getClientIdentifier(req);
  const key = getKey(config.keyPrefix, id);
  const result = await upstashCheck(key, config.limit, config.windowSeconds);

  if (result.success) {
    return null;
  }

  const response = NextResponse.json(
    { error: "Trop de requêtes. Veuillez réessayer plus tard." },
    { status: 429 }
  );
  response.headers.set("X-RateLimit-Limit", String(result.limit));
  response.headers.set("X-RateLimit-Remaining", String(result.remaining));
  response.headers.set("X-RateLimit-Reset", String(result.reset));
  return response;
}

/**
 * Vérifie le rate limit en combinant IP + userId si disponible.
 * Utilisé pour les endpoints authentifiés où on veut limiter par utilisateur
 * tout en gardant une protection IP de secours.
 */
export async function rateLimitByUser(
  req: NextRequest,
  userId: string,
  config: RateLimitConfig
): Promise<NextResponse | null> {
  if (process.env.NODE_ENV === "development" && config.skipInDev !== false) {
    return null;
  }

  const ip = getClientIdentifier(req);
  // On applique deux limites : par user et par IP (defense in depth).
  const ipResult = await upstashCheck(getKey(config.keyPrefix, ip), config.limit, config.windowSeconds);
  if (!ipResult.success) {
    return NextResponse.json({ error: "Trop de requêtes (IP)." }, { status: 429 });
  }

  const userResult = await upstashCheck(
    getKey(`${config.keyPrefix}:user`, userId),
    config.limit,
    config.windowSeconds
  );
  if (!userResult.success) {
    return NextResponse.json({ error: "Trop de requêtes (utilisateur)." }, { status: 429 });
  }

  return null;
}
