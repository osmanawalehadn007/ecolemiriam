import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authConfig } from "@/auth.config";
import { checkCSRF } from "@/lib/security/csrf";
import { globalRateLimit, getRealIP } from "@/lib/security/global-rate-limit";
import { applySecurityHeaders } from "@/lib/security/headers";
import { checkBotBlock, recordPublicRequest, isBotProtectedPath } from "@/lib/security/bot-detection";

const { auth } = NextAuth(authConfig);

/**
 * Routes publiques comparées par PRÉFIXE DE SEGMENT.
 *
 * `"/"` en est volontairement absent : avec `startsWith`, « / » est un préfixe
 * de TOUS les chemins, ce qui rendait publique la totalité de l'application —
 * le middleware retournait avant toute vérification de session. La racine est
 * traitée séparément, en égalité stricte.
 */
const PUBLIC_PREFIXES = [
  "/login",
  "/register",
  "/api/auth",
  "/api/health",
  "/_next",
  "/select-tenant",
  // Routes de vérification email et (re)définition de mot de passe :
  // accessibles sans session (l'utilisateur n'est pas encore connecté)
  "/verify-email",
  "/set-password",
  "/forgot-password",
  "/reset-password",
];

/** Chemins publics en correspondance exacte. */
const PUBLIC_EXACT = new Set(["/", "/offline"]);

/** Exige un segment complet : `/loginfoo` ne doit pas hériter de `/login`. */
function isPublic(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

const SELF_AUTH_API = ["/api/auth", "/api/cron", "/api/webhooks"];

export default auth(async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ── Headers de sécurité durcis sur TOUTES les réponses ──────────────────
  const response = NextResponse.next();
  applySecurityHeaders(response, pathname);

  // ── Détection de patterns bot sur les formulaires publics ───────────────
  //
  // Le blocage est volontairement PORTÉ aux seuls chemins protégés
  // (`isBotProtectedPath`). Auparavant il était vérifié avant `isPublic()` et
  // s'appliquait à TOUTE l'application : une IP détectée perdait l'accès au
  // dashboard, aux assets, à tout — d'où les « site indisponible ».
  //
  // On ne redirige PLUS vers /acces-bloque. Cette page n'est pas publique et
  // se retrouvait elle-même bloquée par ce contrôle : /acces-bloque →
  // redirect /acces-bloque → … → ERR_TOO_MANY_REDIRECTS. On répond
  // directement 429, ce qui rend toute boucle structurellement impossible.
  const ip = getRealIP(req);
  if (isBotProtectedPath(pathname)) {
    const botCheck = checkBotBlock(ip);
    if (botCheck.blocked) {
      const retryAfter = String(Math.ceil(botCheck.remainingMs / 1000));
      if (pathname.startsWith("/api/")) {
        return NextResponse.json(
          { error: "Accès temporairement bloqué pour activité suspecte." },
          { status: 429, headers: { "Retry-After": retryAfter } }
        );
      }
      return new NextResponse(
        `<!doctype html><html lang="fr"><head><meta charset="utf-8">` +
          `<meta name="viewport" content="width=device-width,initial-scale=1">` +
          `<title>Accès temporairement suspendu</title></head>` +
          `<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1.5rem;line-height:1.6">` +
          `<h1 style="font-size:1.25rem">Accès temporairement suspendu</h1>` +
          `<p>Trop de tentatives ont été envoyées depuis votre réseau. ` +
          `Réessayez dans ${Math.ceil(botCheck.remainingMs / 60000)} minute(s).</p>` +
          `<p style="color:#666;font-size:.875rem">Si vous êtes dans un établissement, ` +
          `plusieurs personnes partagent la même adresse Internet.</p></body></html>`,
        {
          status: 429,
          headers: { "Content-Type": "text/html; charset=utf-8", "Retry-After": retryAfter },
        }
      );
    }
    // Seules les tentatives réelles (POST/PUT/PATCH/DELETE) consomment le
    // quota — un affichage de page ou un prefetch RSC ne compte plus.
    recordPublicRequest(ip, pathname, req.method);
  }

  if (isPublic(pathname)) {
    return response;
  }

  // ── Rate limiting global sur les routes API ─────────────────────────────
  if (pathname.startsWith("/api/")) {
    const rl = globalRateLimit(req);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Trop de requêtes. Réessayez dans un instant." },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil(rl.resetInSec)),
            "X-RateLimit-Limit": String(rl.limit),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": String(Math.ceil(rl.resetInSec)),
          },
        }
      );
    }

    // ── CSRF sur les méthodes mutatives ──────────────────────────────────
    const csrfError = checkCSRF(req as unknown as Request);
    if (csrfError) {
      return NextResponse.json(
        { error: "Requête non autorisée (CSRF)" },
        { status: 403 }
      );
    }

    if (SELF_AUTH_API.some((r) => pathname.startsWith(r))) {
      return response;
    }
    const session = (req as unknown as { auth: { user?: { id: string } } }).auth;
    if (!session?.user) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }
    return response;
  }

  const session = (req as unknown as { auth: { user?: { id: string } } }).auth;
  if (!session?.user) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
});

export const config = {
  matcher: [
    // Exclure /api/auth/* pour éviter un double cookie CSRF :
    // le middleware auth() génère un __Host-authjs.csrf-token, puis le
    // route handler NextAuth en génère un second. Le navigateur stocke
    // les deux et envoie le mauvais au callback → MissingCSRF.
    "/((?!_next/static|_next/image|favicon.ico|api/auth|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff|woff2|ttf).*$).*)",
  ],
};
