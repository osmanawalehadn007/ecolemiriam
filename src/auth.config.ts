import type { NextAuthConfig } from "next-auth";
import type { Role } from "@prisma/client";

export interface AvailableTenant {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  tenantLogo: string | null;
  role: Role;
  isDefault: boolean;
}

/**
 * URL publique de l'application, source de vérité unique.
 * En prod VPS : https://app.ecolemiriam.com (défini dans .env.production).
 */
export const APP_ORIGIN =
  process.env.AUTH_URL ??
  process.env.NEXTAUTH_URL ??
  process.env.NEXT_PUBLIC_APP_URL ??
  "http://localhost:3000";

/**
 * Les préfixes `__Secure-` / `__Host-` et l'attribut `secure` ne sont acceptés
 * par le navigateur QUE sur une connexion HTTPS. En les forçant en dur, le
 * cookie de session était silencieusement rejeté dès qu'on servait l'app en
 * HTTP (développement local, test direct sur l'IP du VPS, health-check) :
 * le login « réussissait » puis renvoyait aussitôt vers /login.
 * On les dérive donc de l'URL réelle.
 */
const useSecureCookies = APP_ORIGIN.startsWith("https://");
const securePrefix = useSecureCookies ? "__Secure-" : "";
const hostPrefix = useSecureCookies ? "__Host-" : "";

export const authConfig: NextAuthConfig = {
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 }, // 8 heures — expiration session
  /**
   * OBLIGATOIRE derrière Cloudflare Tunnel → Caddy → app.
   * L'app reçoit la requête en HTTP interne ; sans trustHost, Auth.js v5
   * refuse l'en-tête Host transmis par le proxy et lève `UntrustedHost`,
   * ce qui fait échouer /api/auth/* en 500.
   */
  trustHost: true,
  pages: {
    signIn: "/login",
    error: "/login",
  },
  cookies: {
    sessionToken: {
      name: `${securePrefix}authjs.session-token`,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: useSecureCookies,
        // Pas de domain explicite : le cookie est scoped au domaine exact
        // (app.ecolemiriam.com). Partager entre sous-domaines exigerait
        // domain: ".ecolemiriam.com" mais élargirait la surface d'attaque.
      },
    },
    callbackUrl: {
      name: `${securePrefix}authjs.callback-url`,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: useSecureCookies,
      },
    },
    csrfToken: {
      // `__Host-` impose secure + path=/ + pas de domain : ces trois
      // conditions sont réunies ci-dessous quand on est en HTTPS.
      name: `${hostPrefix}authjs.csrf-token`,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: useSecureCookies,
      },
    },
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role: Role }).role;
        token.tenantId = (user as { tenantId: string | null }).tenantId;
        token.siteId = (user as { siteId?: string | null }).siteId ?? null;
        token.siteIds = (user as { siteIds?: string[] }).siteIds ?? [];
        token.tenantHasSites = (user as { tenantHasSites?: boolean }).tenantHasSites ?? true;
        token.claimsVersion = (user as { claimsVersion?: number }).claimsVersion;
        // Stocker la liste des tenants accessibles pour le switcher
        const availableTenants = (user as { availableTenants?: AvailableTenant[] }).availableTenants;
        if (availableTenants) {
          token.availableTenants = availableTenants;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (token) {
        (session.user as { id?: string }).id = token.id as string;
        (session.user as { role?: Role }).role = token.role as Role;
        (session.user as { tenantId?: string | null }).tenantId = token.tenantId as string | null;
        (session.user as { siteId?: string | null }).siteId = token.siteId as string | null;
        (session.user as { siteIds?: string[] }).siteIds = (token.siteIds as string[] | undefined) ?? [];
        // Par défaut `true` : en l'absence d'information, on suppose que
        // l'isolation par site s'applique (fail-closed).
        (session.user as { tenantHasSites?: boolean }).tenantHasSites =
          (token.tenantHasSites as boolean | undefined) ?? true;
        (session.user as { availableTenants?: AvailableTenant[] }).availableTenants = token.availableTenants as AvailableTenant[] | undefined;
      }
      return session;
    },
  },
  providers: [],
};
