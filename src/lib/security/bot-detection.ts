/**
 * Détection de patterns bot : bloque les IPs qui font trop de requêtes
 * sur les routes publiques en peu de temps.
 *
 * Compte les requêtes par IP sur les routes publiques sensibles :
 * /login, /register, /forgot-password, /reset-password, /api/auth/*
 *
 * Seuil : 30 requêtes/min sur ces routes → blocage 15 min
 * Seuil : 60 requêtes/min → blocage 1h
 */

interface BotTracker {
  count: number;
  windowStart: number;
  blockedUntil: number;
  blockCount: number;
}

const trackers = new Map<string, BotTracker>();
const WINDOW_MS = 60_000; // 1 minute
const PUBLIC_SENSITIVE_PATTERNS = ["/login", "/register", "/forgot-password", "/reset-password", "/api/auth/"];

export function checkBotBlock(ip: string): { blocked: boolean; remainingMs: number } {
  const tracker = trackers.get(ip);
  if (!tracker || tracker.blockedUntil < Date.now()) {
    return { blocked: false, remainingMs: 0 };
  }
  return { blocked: true, remainingMs: tracker.blockedUntil - Date.now() };
}

export function recordPublicRequest(ip: string, pathname: string): { blocked: boolean; remainingMs: number } {
  // Vérifier si la route est sensible
  if (!PUBLIC_SENSITIVE_PATTERNS.some((p) => pathname.startsWith(p))) {
    return { blocked: false, remainingMs: 0 };
  }

  const now = Date.now();
  let tracker = trackers.get(ip);
  if (!tracker) {
    tracker = { count: 0, windowStart: now, blockedUntil: 0, blockCount: 0 };
    trackers.set(ip, tracker);
  }

  // Reset la fenêtre si expirée
  if (now - tracker.windowStart > WINDOW_MS) {
    tracker.count = 0;
    tracker.windowStart = now;
  }

  tracker.count++;

  // Seuils de blocage
  const BLOCK_THRESHOLD_15MIN = 30;
  const BLOCK_THRESHOLD_1H = 60;

  if (tracker.count >= BLOCK_THRESHOLD_1H) {
    tracker.blockedUntil = now + 3_600_000;
    tracker.blockCount++;
  } else if (tracker.count >= BLOCK_THRESHOLD_15MIN) {
    tracker.blockedUntil = now + 900_000;
    tracker.blockCount++;
  }

  // Nettoyage périodique
  if (trackers.size > 5_000) {
    for (const [k, t] of trackers.entries()) {
      if (t.blockedUntil < now && now - t.windowStart > WINDOW_MS * 5) {
        trackers.delete(k);
      }
    }
  }

  if (tracker.blockedUntil > now) {
    return { blocked: true, remainingMs: tracker.blockedUntil - now };
  }
  return { blocked: false, remainingMs: 0 };
}

export function getBotStats(): { totalTracked: number; currentlyBlocked: number } {
  const now = Date.now();
  let blocked = 0;
  for (const tracker of trackers.values()) {
    if (tracker.blockedUntil > now) blocked++;
  }
  return { totalTracked: trackers.size, currentlyBlocked: blocked };
}
