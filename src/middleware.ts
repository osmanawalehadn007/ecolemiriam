import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authConfig } from "@/auth.config";
import { checkCSRF } from "@/lib/security/csrf";
import { globalRateLimit } from "@/lib/security/global-rate-limit";
import { applySecurityHeaders } from "@/lib/security/headers";

const { auth } = NextAuth(authConfig);

const PUBLIC_ROUTES = ["/login", "/register", "/api/auth", "/", "/_next", "/select-tenant"];

const SELF_AUTH_API = ["/api/auth", "/api/cron", "/api/webhooks"];

export default auth(async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ── Headers de sécurité durcis sur TOUTES les réponses ──────────────────
  const response = NextResponse.next();
  applySecurityHeaders(response, pathname);

  if (PUBLIC_ROUTES.some((r) => pathname.startsWith(r))) {
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
