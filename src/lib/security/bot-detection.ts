/**
 * Détection de patterns bot sur les formulaires publics.
 *
 * CE QUI A CHANGÉ ET POURQUOI
 * ---------------------------
 * La version précédente comptait TOUTE requête dont le chemin commençait par
 * `/login`, `/register`, `/forgot-password`, `/reset-password` — donc aussi
 * les simples affichages de page, les navigations RSC et les prefetch émis
 * par `<Link>`. Un affichage de `/login` produit à lui seul 2 à 4 requêtes.
 *
 * Or la clé est `CF-Connecting-IP` : une école entière derrière un NAT partage
 * UNE adresse publique. Avec un seuil de 30 requêtes/minute, quatre à six
 * personnes se connectant dans la même minute suffisaient à bloquer tout
 * l'établissement pendant 15 minutes, puis une heure.
 *
 * Trois corrections :
 *   1. Seules les requêtes MUTATIVES (POST/PUT/PATCH/DELETE) sont comptées :
 *      un affichage de page ne consomme plus de quota, seules les tentatives
 *      réelles le font.
 *   2. Les seuils sont dimensionnés pour un NAT scolaire (voir SEUILS).
 *   3. Le blocage est PORTÉ (`scope`) : il ne vaut que pour les formulaires
 *      publics, jamais pour le reste de l'application. Une IP bloquée peut
 *      toujours utiliser une session déjà ouverte.
 */

interface BotTracker {
  count: number;
  windowStart: number;
  blockedUntil: number;
  blockCount: number;
}

const trackers = new Map<string, BotTracker>();
const WINDOW_MS = 60_000; // 1 minute

/**
 * Chemins concernés. Le blocage ne s'applique QU'À ces chemins : c'est ce qui
 * empêche qu'une détection sur le formulaire de login rende toute
 * l'application inaccessible.
 */
const PUBLIC_SENSITIVE_PATTERNS = [
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/api/auth/",
];

/**
 * SEUILS — dimensionnés pour une école entière derrière une seule IP NAT.
 *
 * 150 tentatives POST par minute depuis une même IP n'a aucune justification
 * humaine (une rentrée scolaire, c'est ~1 connexion/seconde au pic), mais
 * laisse une marge très large avant de pénaliser des utilisateurs légitimes.
 */
const BLOCK_THRESHOLD_15MIN = 150;
const BLOCK_THRESHOLD_1H = 400;

/** Méthodes qui traduisent une tentative réelle (et non un affichage). */
const MUTATIVE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Un chemin est-il couvert par la protection anti-bot ?
 * Exporté pour que le middleware n'applique le blocage QUE sur ces chemins.
 */
export function isBotProtectedPath(pathname: string): boolean {
  return PUBLIC_SENSITIVE_PATTERNS.some((p) => pathname.startsWith(p));
}

export function checkBotBlock(ip: string): { blocked: boolean; remainingMs: number } {
  const tracker = trackers.get(ip);
  if (!tracker || tracker.blockedUntil < Date.now()) {
    return { blocked: false, remainingMs: 0 };
  }
  return { blocked: true, remainingMs: tracker.blockedUntil - Date.now() };
}

/**
 * Enregistre une tentative sur un formulaire public.
 *
 * @param method méthode HTTP — seules les méthodes mutatives sont comptées.
 *   Un GET (affichage de page, navigation RSC, prefetch) ne consomme rien.
 */
export function recordPublicRequest(
  ip: string,
  pathname: string,
  method: string
): { blocked: boolean; remainingMs: number } {
  if (!isBotProtectedPath(pathname)) {
    return { blocked: false, remainingMs: 0 };
  }

  // Un affichage de page n'est pas une tentative. C'est la correction
  // centrale : le quota ne se consomme plus en naviguant.
  if (!MUTATIVE_METHODS.has(method.toUpperCase())) {
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

/** Lève manuellement le blocage d'une IP (support / exploitation). */
export function clearBotBlock(ip: string): void {
  trackers.delete(ip);
}
