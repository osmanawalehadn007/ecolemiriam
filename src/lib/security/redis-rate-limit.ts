/**
 * École Miriam — Rate limiting Redis (INCR + EXPIRE atomique)
 * ============================================================
 *
 * Les limiters en mémoire (Map) se réinitialisent au redémarrage et ne
 * sont pas partagés entre instances blue/green. Redis fournit un compteur
 * partagé, persistant, et atomique via INCR + EXPIRE.
 *
 * Dégradation : si Redis est indisponible (panne, REDIS_URL manquant),
 * tous les helpers retournent null → l'appelant replie sur le compteur
 * en mémoire. Le rate limiting reste effectif, juste local au processus.
 */

import { redis } from "@/lib/redis";

/**
 * Incrémente un compteur Redis et pose un TTL sur la première incrémentation.
 *
 * @param key Clé Redis du compteur
 * @param windowSec TTL en secondes (posé uniquement si la clé est nouvelle)
 * @returns Le compteur après incrément, ou null si Redis est indisponible
 */
export async function redisIncr(
  key: string,
  windowSec: number
): Promise<number | null> {
  if (!redis) return null;
  try {
    const count = await redis.incr(key);
    if (count === 1) {
      // Premier incrément : poser le TTL. Si le process meurt entre INCR
      // et EXPIRE, la clé persiste sans TTL — on pose donc le TTL en
      // fire-and-forget pour ne pas bloquer la réponse.
      void redis.expire(key, windowSec).catch(() => {});
    }
    return count;
  } catch {
    return null;
  }
}

/**
 * Récupère la valeur d'un compteur Redis, ou null si indisponible.
 */
export async function redisGet(key: string): Promise<number | null> {
  if (!redis) return null;
  try {
    const val = await redis.get(key);
    return val ? parseInt(val, 10) : 0;
  } catch {
    return null;
  }
}

/**
 * Pose une clé avec un TTL (verrou temporel).
 * Utilisé pour les lockouts : `SET key 1 EX duration`.
 */
export async function redisSetTTL(
  key: string,
  ttlSec: number
): Promise<boolean> {
  if (!redis) return false;
  try {
    await redis.set(key, "1", "EX", ttlSec);
    return true;
  } catch {
    return false;
  }
}

/**
 * Vérifie si une clé de verrou existe encore.
 * @returns Le TTL restant en secondes (0 si expiré ou absent), ou null si Redis indisponible.
 */
export async function redisTTL(key: string): Promise<number | null> {
  if (!redis) return null;
  try {
    return await redis.ttl(key);
  } catch {
    return null;
  }
}

/**
 * Supprime une clé (levée de verrou).
 */
export async function redisDel(key: string): Promise<void> {
  if (!redis) return;
  try {
    await redis.del(key);
  } catch {
    // Silencieux
  }
}

/**
 * Préfixe standardisé pour les clés de rate limiting.
 */
export const RL_PREFIX = "ecolemiriam:rl";
