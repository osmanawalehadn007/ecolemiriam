/**
 * École Miriam — Headers de sécurité durcis
 * ============================================================
 * Applique une politique de sécurité stricte sur toutes les réponses.
 * Complète les headers déjà positionnés par Caddy/Cloudflare.
 *
 * Référence : OWASP Secure Headers Project, Mozilla Observatory.
 */

import type { NextResponse } from "next/server";

const isProd = process.env.NODE_ENV === "production";

/**
 * Construit la directive Content-Security-Policy avec un nonce par requête.
 *
 * Le nonce remplace `'unsafe-inline'` dans `script-src` : chaque script
 * inline (hydration Next.js, widgets tiers) doit porter l'attribut
 * `nonce="<valeur>"` correspondant. Next.js 15 lit le header `x-nonce`
 * posé par le middleware et l'injecte automatiquement dans ses propres
 * scripts.
 *
 * `'strict-dynamic'` permet aux scripts de confiance (porteurs du nonce)
 * de charger d'autres scripts sans les allowlister individuellement —
 * indispensable pour les chunks dynamiques de Next.js.
 *
 * `style-src` conserve `'unsafe-inline'` : Next.js injecte des styles
 * inline critiques pour le rendu initial, et la migration vers des nonces
 * de style est plus complexe et moins risquée que pour les scripts.
 */
function buildCSP(nonce: string, pathname: string): string {
  const directives: string[] = [
    "default-src 'self'",
    // script-src : nonce + strict-dynamic remplacent 'unsafe-inline'.
    // 'self' reste pour les navigateurs sans support strict-dynamic.
    isProd
      ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://challenges.cloudflare.com`
      : `script-src 'self' 'nonce-${nonce}' 'unsafe-inline' 'unsafe-eval' 'strict-dynamic' https://challenges.cloudflare.com`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https: blob:",
    "font-src 'self' data:",
    `connect-src 'self' https://challenges.cloudflare.com https://ecolemiriam.com https://*.ecolemiriam.com https://api.africastalking.com https://api.sandbox.africastalking.com https://api.resend.com https://graph.facebook.com https://api.telegram.org https://api.stripe.com`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "frame-src 'self' https://challenges.cloudflare.com",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ];

  if (isProd) {
    directives.push("upgrade-insecure-requests", "block-all-mixed-content");
  }

  return directives.join("; ");
}

/**
 * Applique les headers de sécurité sur une réponse.
 * @param response La réponse à durcir
 * @param pathname Le pathname de la requête (pour ajuster CSP par route)
 * @param nonce Nonce CSP généré par requête (supprime 'unsafe-inline' dans script-src)
 */
export function applySecurityHeaders(
  response: NextResponse,
  pathname: string,
  nonce?: string
): void {
  const headers = response.headers;

  // ── Content-Security-Policy avec nonce par requête ─────────────────────
  // Si un nonce est fourni (middleware), on génère une CSP dynamique qui
  // remplace 'unsafe-inline' dans script-src. Sans nonce (fallback), on
  // garde 'unsafe-inline' pour ne pas casser l'app.
  if (nonce) {
    headers.set("Content-Security-Policy", buildCSP(nonce, pathname));
  } else if (!headers.has("Content-Security-Policy")) {
    // Fallback sans nonce (chemins exclusés du middleware, assets statiques)
    const fallbackCsp = buildCSP("", pathname).replace("'nonce-'", "'unsafe-inline'");
    headers.set("Content-Security-Policy", fallbackCsp);
  }

  // ── Cross-Origin Opener Policy : isole le contexte de navigation ───────
  // Empêche les attaques cross-origin d'accéder au window.opener.
  headers.set("Cross-Origin-Opener-Policy", "same-origin");

  // ── Cross-Origin Resource Policy : restreint qui peut embarquer la ressource
  headers.set("Cross-Origin-Resource-Policy", "same-origin");

  // ── Cross-Origin Embedder Policy ────────────────────────────────────────
  // RETIRÉ : `credentialless` bloquait le chargement des chunks JavaScript
  // de Next.js chez certains utilisateurs en production (caches Cloudflare,
  // redirects apex → sous-domaine, navigateurs plus anciens). Le symptôme
  // était "rien ne se passe quand on clique sur login" — le JS ne s'exécutait
  // pas car les chunks étaient bloqués par COEP.
  // COEP n'est nécessaire que pour SharedArrayBuffer et APIs avancées que
  // l'app n'utilise pas. Le risqué > le bénéfice.
  // headers.set("Cross-Origin-Embedder-Policy", "credentialless");

  // ── X-DNS-Prefetch-Control : désactive le pré-fetch DNS (fuite d'info)
  headers.set("X-DNS-Prefetch-Control", "off");

  // ── X-Download-Options : empêche l'ouverture directe des fichiers téléchargés
  headers.set("X-Download-Options", "noopen");

  // ── X-Permitted-Cross-Domain-Policies : restreint Adobe Flash/PDF cross-domain
  headers.set("X-Permitted-Cross-Domain-Policies", "none");

  // ── Cache-Control pour les routes API : jamais de cache ────────────────
  if (pathname.startsWith("/api/")) {
    headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    headers.set("Pragma", "no-cache");
    headers.set("Expires", "0");
    // Empêche la mise en cache des réponses API par le navigateur ou les proxies
    headers.set("Surrogate-Control", "no-store");
  }

  // ── Clear-Site-Data sur logout : nettoie tout côté client ──────────────
  // (appliqué par la route de logout, pas ici)

  // ── X-Frame-Options : déjà DENY via Caddy, mais on double-check ────────
  if (!headers.has("X-Frame-Options")) {
    headers.set("X-Frame-Options", "DENY");
  }

  // ── X-Content-Type-Options : déjà nosniff via Caddy, mais on double-check
  if (!headers.has("X-Content-Type-Options")) {
    headers.set("X-Content-Type-Options", "nosniff");
  }

  // ── Referrer-Policy : déjà strict-origin-when-cross-origin via Caddy ───
  if (!headers.has("Referrer-Policy")) {
    headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  }

  // ── Permissions-Policy : déjà restrictif via Caddy, mais on double-check
  if (!headers.has("Permissions-Policy")) {
    headers.set(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=(), interest-cohort=()"
    );
  }
}
