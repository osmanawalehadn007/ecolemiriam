/**
 * École Miriam — Protection CSRF (Cross-Site Request Forgery)
 * ============================================================
 * Stratégie : vérification de l'en-tête Origin/Referer sur toutes les
 * requêtes mutatives (POST, PUT, PATCH, DELETE). C'est l'approche
 * recommandée par l'OWASP pour les API basées sur cookies.
 *
 * Principe : un attaquant sur evil.com ne peut pas envoyer une requête
 * avec Origin: ecolemiriam.com — le navigateur enforce l'Origin réel.
 * Les requêtes same-origin portent automatiquement le bon Origin.
 *
 * Les API tokens (Bearer JWT mobile) sont exemptées car elles ne sont
 * pas envoyées automatiquement par le navigateur (pas de cookie).
 */

/** Méthodes HTTP qui modifient l'état et nécessitent une protection CSRF. */
const MUTATIVE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Routes exemptées de CSRF : auth callback (gère son propre CSRF), webhooks (signature HMAC), cron (Bearer token). */
const EXEMPT_PREFIXES = [
  "/api/auth/", // NextAuth gère son propre CSRF token
  "/api/webhooks/", // Webhooks vérifiés par signature HMAC
  "/api/cron/", // Cron protégé par Bearer CRON_SECRET
  "/api/stripe/webhook", // Webhook Stripe vérifié par signature
];

/** Domaines autorisés pour Origin/Referer. */
function getAllowedOrigins(): string[] {
  const appUrl = process.env.NEXTAUTH_URL ?? process.env.AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  const domains: string[] = [];
  if (appUrl) {
    try {
      const url = new URL(appUrl);
      domains.push(url.origin);
    } catch {
      // URL invalide, on ignore
    }
  }
  // Domaines explicites connus
  domains.push("https://ecolemiriam.com");
  domains.push("https://app.ecolemiriam.com");
  // En dev, autoriser localhost
  if (process.env.NODE_ENV !== "production") {
    domains.push("http://localhost:3000");
    domains.push("http://127.0.0.1:3000");
  }
  return [...new Set(domains)];
}

/**
 * Vérifie si une requête est protégée contre CSRF.
 * Retourne null si la requête est autorisée, ou un message d'erreur.
 */
export function checkCSRF(req: Request): string | null {
  const method = req.method.toUpperCase();

  // Les méthodes non-mutatives (GET, HEAD, OPTIONS) sont exemptées
  if (!MUTATIVE_METHODS.has(method)) return null;

  const pathname = new URL(req.url).pathname;

  // Routes exemptées
  if (EXEMPT_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return null;

  // Les requêtes avec Authorization Bearer (API mobile) sont exemptées :
  // le token JWT n'est pas envoyé automatiquement par le navigateur,
  // donc CSRF n'est pas applicable.
  const authHeader = req.headers.get("authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) return null;

  // Récupérer Origin ou Referer
  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");

  // Au moins un des deux doit être présent
  if (!origin && !referer) {
    return "En-tête Origin/Referer manquant";
  }

  const allowedOrigins = getAllowedOrigins();

  // Vérifier Origin (priorité) ou Referer
  if (origin) {
    if (allowedOrigins.includes(origin)) return null;
    return `Origin non autorisée: ${origin}`;
  }

  // Fallback sur Referer : extraire l'origin
  if (referer) {
    try {
      const refererUrl = new URL(referer);
      const refererOrigin = refererUrl.origin;
      if (allowedOrigins.includes(refererOrigin)) return null;
      return `Referer non autorisé: ${refererOrigin}`;
    } catch {
      return "Referer invalide";
    }
  }

  return "Vérification CSRF échouée";
}
