/**
 * École Miriam — Rate Limiting Global (middleware edge-compatible)
 * ============================================================
 * Applique un rate limit sur toutes les routes API depuis le middleware.
 * Utilise un Map en mémoire (suffisant pour un seul serveur VPS).
 *
 * Limites par IP :
 *  - Routes d'authentification : plus strict (géré par les routes elles-mêmes)
 *  - Routes API authentifiées : 120 req/min
 *  - Routes API publiques : 30 req/min
 */

import type { NextRequest } from "next/server";

interface Bucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();

/** Routes API publiques (sans authentification requise) — limit plus strict. */
const PUBLIC_API_PREFIXES = ["/api/auth", "/api/health", "/api/webhooks", "/api/cron"];

/** Routes sensibles nécessitant un limit plus strict. */
const SENSITIVE_API_PREFIXES = ["/api/auth/mobile", "/api/stripe/checkout"];

const WINDOW_MS = 60_000; // 1 minute

function getLimit(pathname: string): number {
  if (SENSITIVE_API_PREFIXES.some((p) => pathname.startsWith(p))) return 10;
  if (PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p))) return 30;
  return 120; // routes authentifiées standard
}

/**
 * Récupère l'IP réelle du client. En production derrière Cloudflare,
 * on utilise CF-Connecting-IP (non spoofable par le client car Cloudflare
 * l'écrase). X-Forwarded-For est ignoré car spoofable.
 */
export function getRealIP(req: NextRequest): string {
  // Cloudflare Tunnel : CF-Connecting-IP est la source de vérité
  const cfIP = req.headers.get("cf-connecting-ip");
  if (cfIP) return cfIP.trim();

  // Fallback pour dev local (pas derrière Cloudflare)
  if (process.env.NODE_ENV !== "production") {
    const forwarded = req.headers.get("x-forwarded-for");
    if (forwarded) return forwarded.split(",")[0].trim();
    const real = req.headers.get("x-real-ip");
    if (real) return real.trim();
  }

  return req.headers.get("x-real-ip") ?? "unknown";
}

export interface GlobalRateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetInSec: number;
}

/**
 * Vérifie le rate limit global pour une requête API.
 * À appeler depuis le middleware sur toutes les routes /api/.
 */
export function globalRateLimit(req: NextRequest): GlobalRateLimitResult {
  const pathname = req.nextUrl.pathname;
  const ip = getRealIP(req);
  const limit = getLimit(pathname);
  const key = `global:${ip}:${pathname.split("/").slice(0, 3).join("/")}`;
  const now = Date.now();

  let bucket = buckets.get(key);

  if (!bucket || now - bucket.windowStart > WINDOW_MS) {
    bucket = { count: 0, windowStart: now };
    buckets.set(key, bucket);
  }

  bucket.count++;

  const resetInSec = Math.ceil((WINDOW_MS - (now - bucket.windowStart)) / 1000);

  if (bucket.count > limit) {
    return {
      allowed: false,
      limit,
      remaining: 0,
      resetInSec: Math.max(1, resetInSec),
    };
  }

  // Nettoyage périodique des buckets expirés (évite fuite mémoire)
  if (buckets.size > 10_000) {
    for (const [k, b] of buckets.entries()) {
      if (now - b.windowStart > WINDOW_MS * 2) {
        buckets.delete(k);
      }
    }
  }

  return {
    allowed: true,
    limit,
    remaining: Math.max(0, limit - bucket.count),
    resetInSec,
  };
}
