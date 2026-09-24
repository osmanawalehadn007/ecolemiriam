/**
 * École Miriam — Rate Limiting Global (middleware edge-compatible)
 * ============================================================
 * Applique un rate limit sur toutes les routes API depuis le middleware.
 *
 * IMPORTANT : Ce fichier est importé par le middleware qui s'exécute dans
 * le EDGE RUNTIME. Il ne peut PAS importer `ioredis` (Node.js uniquement).
 * Le rate limiting du middleware reste donc en mémoire (par processus).
 *
 * Le rate limiting distribué (Redis) est appliqué au niveau server-side
 * dans `login-attempts.ts` (brute-force protection) qui est importé par
 * `auth.ts` (Node.js runtime).
 *
 * Limites par IP :
 *  - Routes d'authentification : géré par Caddy (60 req/min) + routes
 *    elles-mêmes (anti-énumération par email). Le middleware n'ajoute pas
 *    de limite supplémentaire sur /api/auth/* pour éviter de doubler celle
 *    de Caddy et de bloquer les écoles entières derrière un NAT.
 *  - Routes API authentifiées : 120 req/min
 *  - Routes API publiques (health, webhooks, cron) : 30 req/min
 */

import type { NextRequest } from "next/server";

interface Bucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();

/** Routes API publiques (sans authentification requise) — limit plus strict. */
const PUBLIC_API_PREFIXES = ["/api/health", "/api/webhooks", "/api/cron"];

/** Routes sensibles nécessitant un limit plus strict. */
const SENSITIVE_API_PREFIXES = ["/api/auth/mobile", "/api/stripe/checkout"];

const WINDOW_MS = 60_000; // 1 minute

function getLimit(pathname: string): number {
  if (SENSITIVE_API_PREFIXES.some((p) => pathname.startsWith(p))) return 10;
  if (PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p))) return 30;
  // /api/auth/* : pas de limite ici — Caddy gère déjà (60/min/IP) et les
  // routes elles-mêmes ont leur propre anti-énumération par email.
  if (pathname.startsWith("/api/auth")) return 600; // effectivement pas de limite
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
 *
 * Edge runtime : compteur en mémoire (par processus). Le rate limiting
 * distribué Redis est appliqué au niveau de `login-attempts.ts` pour
 * les tentatives de login (brute-force), qui est le chemin le plus
 * critique et s'exécute en Node.js runtime.
 */
export async function globalRateLimit(req: NextRequest): Promise<GlobalRateLimitResult> {
  const pathname = req.nextUrl.pathname;
  const ip = getRealIP(req);
  const limit = getLimit(pathname);
  const pathKey = pathname.split("/").slice(0, 3).join("/");
  const now = Date.now();

  const memKey = `global:${ip}:${pathKey}`;
  let bucket = buckets.get(memKey);

  if (!bucket || now - bucket.windowStart > WINDOW_MS) {
    bucket = { count: 0, windowStart: now };
    buckets.set(memKey, bucket);
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
