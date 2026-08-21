/**
 * École Miriam — Rate Limiting (in-memory token bucket)
 * ============================================================
 * Simple rate limiter pour les routes API sensibles (login, upload, etc.).
 * Utilise un Map en mémoire — suffisant pour un seul serveur.
 * Pour multi-instance, remplacer par Redis (Upstash).
 */

interface Bucket {
  tokens: number;
  lastRefill: number;
}

const buckets = new Map<string, Bucket>();

interface RateLimitOptions {
  /** Nombre maximum de requêtes dans la fenêtre. */
  max: number;
  /** Fenêtre en secondes. */
  windowSec: number;
  /** Clé unique (ex: IP + route). */
  key: string;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

/**
 * Vérifie si une requête est autorisée selon le rate limit.
 * Algorithme : token bucket simplifié.
 */
export function rateLimit(opts: RateLimitOptions): RateLimitResult {
  const { max, windowSec, key } = opts;
  const now = Date.now();
  const windowMs = windowSec * 1000;

  let bucket = buckets.get(key);

  if (!bucket) {
    bucket = { tokens: max, lastRefill: now };
    buckets.set(key, bucket);
  }

  // Replenish tokens based on elapsed time
  const elapsed = now - bucket.lastRefill;
  const refill = (elapsed / windowMs) * max;
  bucket.tokens = Math.min(max, bucket.tokens + refill);
  bucket.lastRefill = now;

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return {
      allowed: true,
      remaining: Math.floor(bucket.tokens),
      resetAt: now + windowMs,
    };
  }

  return {
    allowed: false,
    remaining: 0,
    resetAt: now + windowMs,
  };
}

/**
 * Récupère l'IP du client à partir de la requête.
 *
 * En production derrière Cloudflare Tunnel, CF-Connecting-IP est la source
 * de vérité (non spoofable — Cloudflare l'écrase). X-Forwarded-For n'est
 * utilisé qu'en dev car il est spoofable par le client.
 */
export function getClientIP(req: Request): string {
  // Cloudflare Tunnel : CF-Connecting-IP est positionné par Cloudflare
  // et non par le client — c'est la source de vérité en production.
  const cfIP = req.headers.get("cf-connecting-ip");
  if (cfIP && process.env.NODE_ENV === "production") return cfIP.trim();

  // En dev uniquement, X-Forwarded-For est acceptable
  if (process.env.NODE_ENV !== "production") {
    const forwarded = req.headers.get("x-forwarded-for");
    if (forwarded) {
      // Prendre la première IP et valider le format
      const ip = forwarded.split(",")[0].trim();
      if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip) || /^[a-f0-9:]+$/i.test(ip)) {
        return ip;
      }
    }
    const real = req.headers.get("x-real-ip");
    if (real) return real.trim();
  }

  // En production, si pas de CF-Connecting-IP, on ne fait pas confiance
  // à X-Forwarded-For — on retourne unknown pour éviter le bypass.
  return "unknown";
}

/**
 * Nettoie les buckets expirés (à appeler périodiquement).
 */
export function cleanupBuckets() {
  const now = Date.now();
  for (const [key, bucket] of buckets.entries()) {
    if (now - bucket.lastRefill > 300_000) {
      buckets.delete(key);
    }
  }
}
