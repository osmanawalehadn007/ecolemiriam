import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authConfig } from "@/auth.config";
import { checkCSRF } from "@/lib/security/csrf";
import { globalRateLimit, getRealIP } from "@/lib/security/global-rate-limit";
import { applySecurityHeaders } from "@/lib/security/headers";
import { checkBotBlock, recordPublicRequest } from "@/lib/security/bot-detection";

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

  // ── Détection de patterns bot sur les routes publiques sensibles ────────
  // Bloque les IPs qui font trop de requêtes sur /login, /register,
  // /forgot-password, /reset-password, /api/auth/* en peu de temps.
  // 30 req/min → blocage 15 min ; 60 req/min → blocage 1h.
  const ip = getRealIP(req);
  const botCheck = checkBotBlock(ip);
  if (botCheck.blocked) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Accès temporairement bloqué pour activité suspecte." },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(botCheck.remainingMs / 1000)) },
        }
      );
    }
    // Pour les pages, rediriger vers une page de blocage
    const blockedUrl = new URL("/acces-bloque", req.url);
    blockedUrl.searchParams.set("reason", "bot");
    blockedUrl.searchParams.set("retry", String(Math.ceil(botCheck.remainingMs / 1000)));
    return NextResponse.redirect(blockedUrl);
  }
  // Enregistrer la requête pour la détection de pattern
  recordPublicRequest(ip, pathname);

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
