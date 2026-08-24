/**
 * École Miriam — Client Redis partagé (cache + sessions + queues)
 * ================================================================
 *
 * Pourquoi Redis plutôt que unstable_cache (en mémoire Next.js) :
 *   - Partagé entre instances blue/green (pas de cache froid au bascule)
 *   - Survit aux redéploiements (pas de réchauffement après chaque deploy)
 *   - Permet l'invalidation ciblée par tag (revalidateTag fonctionne
 *     même si l'instance qui invalide n'est pas celle qui a mis en cache)
 *   - Permet les sessions invalidables (NextAuth) et les queues
 *     pour les tâches de fond (relances auto, exports, notifications)
 *
 * Connexion : REDIS_URL (redis://:password@redis:6379/0 en prod).
 * En dev sans REDIS_URL, le client est null et les fonctions de cache
 * retournent les données sans caching (graceful degradation).
 */

import Redis from "ioredis";

const globalForRedis = globalThis as unknown as {
  redisClient: Redis | null | undefined;
};

function createRedisClient(): Redis | null {
  const url = process.env.REDIS_URL;
  if (!url) {
    if (process.env.NODE_ENV === "production") {
      console.error("[Redis] REDIS_URL manquant en production — cache désactivé");
    }
    return null;
  }

  const client = new Redis(url, {
    // Connection pooling : un seul client partagé par processus (singleton)
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => Math.min(times * 200, 2000),
    enableReadyCheck: true,
    lazyConnect: false,
  });

  client.on("error", (err) => {
    console.error("[Redis] Erreur de connexion:", err.message);
  });

  client.on("connect", () => {
    if (process.env.NODE_ENV !== "production") {
      console.log("[Redis] Connecté");
    }
  });

  return client;
}

export const redis: Redis | null =
  globalForRedis.redisClient ?? createRedisClient();

if (process.env.NODE_ENV !== "production") {
  globalForRedis.redisClient = redis;
}

// ------------------------------------------------------------
// Helpers de cache (get/set/del avec TTL + JSON serialization)
// ------------------------------------------------------------

/**
 * Récupère une valeur du cache Redis, désérialisée depuis JSON.
 * Retourne null si la clé n'existe pas ou si Redis est indisponible.
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  if (!redis) return null;
  try {
    const raw = await redis.get(key);
    if (raw === null) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Stocke une valeur dans le cache Redis avec un TTL (en secondes).
 * Silencieux si Redis est indisponible (graceful degradation).
 */
export async function cacheSet<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  if (!redis) return;
  try {
    await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
  } catch {
    // Redis indisponible : on continue sans cache
  }
}

/**
 * Invalide une clé du cache.
 */
export async function cacheDel(key: string): Promise<void> {
  if (!redis) return;
  try {
    await redis.del(key);
  } catch {
    // Silencieux
  }
}

/**
 * Invalide toutes les clés correspondant à un pattern (ex: "tenant:abc:*").
 * Utilise SCAN (pas KEYS) pour ne pas bloquer Redis.
 */
export async function cacheDelPattern(pattern: string): Promise<void> {
  if (!redis) return;
  try {
    let cursor = "0";
    do {
      const [next, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
      cursor = next;
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } while (cursor !== "0");
  } catch {
    // Silencieux
  }
}

/**
 * Pattern de clé de cache standardisé : "ecolemiriam:{tenant}:{tag}:{args}"
 */
export function cacheKey(tenantId: string, tag: string, ...args: (string | number)[]): string {
  return `ecolemiriam:${tenantId}:${tag}:${args.join(":")}`;
}

/**
 * Wrapper de cache : si la clé existe dans Redis, retourne la valeur cachée.
 * Sinon, exécute la fonction, met en cache le résultat, et le retourne.
 *
 * @example
 * const annee = await cached(
 *   cacheKey(tenantId, "annee-courante"),
 *   () => prisma.anneesScolaires.findFirst({ where: { isCurrent: true } }),
 *   600 // 10 minutes
 * );
 */
export async function cached<T>(
  key: string,
  fn: () => Promise<T>,
  ttlSeconds: number
): Promise<T> {
  const hit = await cacheGet<T>(key);
  if (hit !== null) return hit;

  const value = await fn();
  await cacheSet(key, value, ttlSeconds);
  return value;
}

export default redis;
