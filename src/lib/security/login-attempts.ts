/**
 * Suivi des tentatives de login échouées par IP.
 * Lockout progressif : 5 échecs → 1min, 10 → 5min, 15 → 15min, 20+ → 1h
 *
 * Stratégie : Redis (compteur partagé + verrou TTL) en premier, repli sur
 * Map en mémoire si Redis est indisponible. Le compteur Redis est partagé
 * entre instances blue/green et persiste au redémarrage.
 */

import { redisIncr, redisSetTTL, redisTTL, redisDel, redisGet, RL_PREFIX } from "@/lib/security/redis-rate-limit";

interface LoginAttempt {
  failures: number;
  lastFailure: number;
  lockedUntil: number;
}

const attempts = new Map<string, LoginAttempt>();

const LOCKOUT_STEPS = [
  { threshold: 5, duration: 60_000 },      // 1 minute
  { threshold: 10, duration: 300_000 },     // 5 minutes
  { threshold: 15, duration: 900_000 },     // 15 minutes
  { threshold: 20, duration: 3_600_000 },   // 1 heure
];

const FAILURE_WINDOW_SEC = 3600; // 1h — fenêtre de comptage des échecs

function lockoutKey(ip: string): string {
  return `${RL_PREFIX}:login:locked:${ip}`;
}

function failureKey(ip: string): string {
  return `${RL_PREFIX}:login:failures:${ip}`;
}

/**
 * Vérifie si une IP est actuellement verrouillée.
 * Tente Redis d'abord, repli sur la Map en mémoire.
 */
export async function checkLoginLockout(ip: string): Promise<{ locked: boolean; remainingMs: number; failures: number }> {
  // ── Tentative Redis ──────────────────────────────────────────────────
  const redisRemaining = await redisTTL(lockoutKey(ip));
  if (redisRemaining !== null) {
    const failures = (await redisGet(failureKey(ip))) ?? 0;
    if (redisRemaining > 0) {
      return { locked: true, remainingMs: redisRemaining * 1000, failures };
    }
    return { locked: false, remainingMs: 0, failures };
  }

  // ── Repli en mémoire ──────────────────────────────────────────────────
  const attempt = attempts.get(ip);
  if (!attempt || attempt.lockedUntil < Date.now()) {
    return { locked: false, remainingMs: 0, failures: attempt?.failures ?? 0 };
  }
  return { locked: true, remainingMs: attempt.lockedUntil - Date.now(), failures: attempt.failures };
}

/**
 * Enregistre un échec de login et déclenche le lockout si un seuil est atteint.
 * Tente Redis d'abord (INCR + verrou TTL), repli sur la Map en mémoire.
 */
export async function recordLoginFailure(ip: string): Promise<{ locked: boolean; remainingMs: number }> {
  const now = Date.now();

  // ── Tentative Redis ──────────────────────────────────────────────────
  const redisCount = await redisIncr(failureKey(ip), FAILURE_WINDOW_SEC);
  if (redisCount !== null) {
    // Vérifier si on atteint un seuil de lockout
    for (let i = LOCKOUT_STEPS.length - 1; i >= 0; i--) {
      if (redisCount >= LOCKOUT_STEPS[i].threshold) {
        const lockoutSec = Math.ceil(LOCKOUT_STEPS[i].duration / 1000);
        await redisSetTTL(lockoutKey(ip), lockoutSec);
        return { locked: true, remainingMs: LOCKOUT_STEPS[i].duration };
      }
    }
    return { locked: false, remainingMs: 0 };
  }

  // ── Repli en mémoire ──────────────────────────────────────────────────
  let attempt = attempts.get(ip);
  if (!attempt) {
    attempt = { failures: 0, lastFailure: now, lockedUntil: 0 };
    attempts.set(ip, attempt);
  }
  // Reset si pas d'échec depuis 1h
  if (now - attempt.lastFailure > 3_600_000) {
    attempt.failures = 0;
  }
  attempt.failures++;
  attempt.lastFailure = now;

  // Vérifier si on atteint un seuil de lockout
  for (let i = LOCKOUT_STEPS.length - 1; i >= 0; i--) {
    if (attempt.failures >= LOCKOUT_STEPS[i].threshold) {
      attempt.lockedUntil = now + LOCKOUT_STEPS[i].duration;
      // Nettoyage périodique
      if (attempts.size > 10_000) {
        for (const [k, a] of attempts.entries()) {
          if (a.lockedUntil < now && now - a.lastFailure > 3_600_000) {
            attempts.delete(k);
          }
        }
      }
      return { locked: true, remainingMs: LOCKOUT_STEPS[i].duration };
    }
  }
  return { locked: false, remainingMs: 0 };
}

/**
 * Réinitialise le compteur d'échecs après une connexion réussie.
 * Supprime les clés Redis et l'entrée en mémoire.
 */
export async function recordLoginSuccess(ip: string): Promise<void> {
  // Redis : supprimer les clés
  await redisDel(failureKey(ip));
  await redisDel(lockoutKey(ip));

  // Mémoire : supprimer l'entrée
  attempts.delete(ip);
}

/** Vide tous les compteurs (tests, maintenance). */
export function clearLoginAttempts(): void {
  attempts.clear();
}
