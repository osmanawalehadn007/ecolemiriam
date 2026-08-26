/**
 * Suivi des tentatives de login échouées par IP.
 * Lockout progressif : 5 échecs → 1min, 10 → 5min, 15 → 15min, 20+ → 1h
 */

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

export function checkLoginLockout(ip: string): { locked: boolean; remainingMs: number; failures: number } {
  const attempt = attempts.get(ip);
  if (!attempt || attempt.lockedUntil < Date.now()) {
    return { locked: false, remainingMs: 0, failures: attempt?.failures ?? 0 };
  }
  return { locked: true, remainingMs: attempt.lockedUntil - Date.now(), failures: attempt.failures };
}

export function recordLoginFailure(ip: string): { locked: boolean; remainingMs: number } {
  const now = Date.now();
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

export function recordLoginSuccess(ip: string): void {
  attempts.delete(ip);
}

export function clearLoginAttempts(): void {
  attempts.clear();
}
