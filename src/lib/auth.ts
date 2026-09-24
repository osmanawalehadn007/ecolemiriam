import { cache } from "react";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import prismaBase, { assertDirectRoleBypassesRls } from "@/lib/prisma-base";
import type { Role } from "@prisma/client";
import { authConfig, type AvailableTenantSlim } from "@/auth.config";
import { deriveClaims, deriveClaimsFromUser, CLAIMS_VERSION } from "@/lib/tenant-claims";
import { auditFire } from "@/lib/audit";
import { verifyTOTP } from "@/lib/security/totp";
import { registerAuthFetcher } from "@/lib/prisma-rls";
import { checkLoginLockout, recordLoginFailure, recordLoginSuccess } from "@/lib/security/login-attempts";
import { verifyTurnstileToken } from "@/lib/security/turnstile";
import { securityLog } from "@/lib/security/security-log";

/**
 * Extrait l'IP du client depuis la requête NextAuth.
 *
 * En production derrière Cloudflare Tunnel, `cf-connecting-ip` est la source
 * de vérité (non spoofable). En dev, on se rabat sur `x-forwarded-for`.
 * Le paramètre `request` passé à `authorize` est l'objet `Request` entrant.
 */
function getAuthorizeIP(request: unknown): string {
  try {
    const headers = (request as { headers?: Headers } | undefined)?.headers;
    if (headers && typeof headers.get === "function") {
      const cfIP = headers.get("cf-connecting-ip");
      if (cfIP && process.env.NODE_ENV === "production") return cfIP.trim();

      const forwarded = headers.get("x-forwarded-for");
      if (forwarded) {
        const ip = forwarded.split(",")[0].trim();
        if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip) || /^[a-f0-9:]+$/i.test(ip)) {
          return ip;
        }
      }
      const real = headers.get("x-real-ip");
      if (real) return real.trim();
    }
  } catch {
    // ignore — fallback ci-dessous
  }
  return "unknown";
}

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  totp: z.string().optional(), // code 2FA (6 chiffres) si activé
  turnstileToken: z.string().optional(), // token Cloudflare Turnstile (anti-bot)
});

export const {
  handlers,
  auth: uncachedAuth,
  signIn,
  signOut,
  unstable_update,
} = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    /**
     * Surcharge le callback `jwt` de `auth.config.ts` pour y ajouter un accès
     * base de données. Le callback de base ne peut pas utiliser Prisma car il
     * est aussi exécuté par le middleware (edge runtime).
     *
     * Le `trigger === "update"` est déclenché par `unstable_update()` après un
     * changement d'établissement : on relit alors le tenant actif depuis la base
     * (source de vérité) pour rafraîchir le JWT.
     */
    async jwt({ token, user, trigger, session }) {
      const baseJwt = authConfig.callbacks?.jwt;
      if (baseJwt) {
        const result = await baseJwt({ token, user, trigger, session } as never);
        if (result) token = result;
      }

      // Ré-hydratation depuis la base — la base est la seule source de vérité
      // pour le périmètre d'accès. Déclenchée :
      //  - par `unstable_update()` après un changement de tenant ou de site ;
      //  - dès qu'un JWT porte une version de revendications périmée, afin que
      //    les jetons émis avant ce durcissement soient corrigés sans exiger
      //    une reconnexion (et ne conservent pas un périmètre trop large).
      const isStale = token.claimsVersion !== CLAIMS_VERSION;

      if (token.id && (trigger === "update" || isStale)) {
        // Tenant demandé par `unstable_update({ user: { tenantId } })`. Ce n'est
        // qu'une *préférence* : `deriveClaims` ne la retient que si
        // l'utilisateur possède une adhésion active à ce tenant. Une valeur
        // arbitraire ne peut donc pas faire franchir la frontière tenant.
        const requestedTenantId =
          (session as { tenantId?: string | null } | undefined)?.tenantId ??
          (session as { user?: { tenantId?: string | null } } | undefined)?.user?.tenantId ??
          (token.tenantId as string | null) ??
          null;

        const claims = await deriveClaims(token.id as string, requestedTenantId);

        if (!claims) {
          // Compte désactivé ou supprimé : on vide le périmètre plutôt que de
          // laisser un jeton porter des droits obsolètes.
          token.tenantId = null;
          token.siteId = null;
          token.siteIds = [];
          token.tenantHasSites = true;
          token.availableTenants = [];
          token.claimsVersion = CLAIMS_VERSION;
          return token;
        }

        token.tenantId = claims.tenantId;
        token.role = claims.role;
        token.siteId = claims.siteId;
        token.siteIds = claims.siteIds;
        token.tenantHasSites = claims.tenantHasSites;
        token.availableTenants = claims.availableTenants;
        token.claimsVersion = claims.claimsVersion;

        // Mise à jour du flag mfaSetupRequired via unstable_update().
        // Quand un SUPER_ADMIN active la 2FA, la route /api/auth/2fa/enable
        // appelle unstable_update({ user: { mfaSetupRequired: false } }) pour
        // effacer le flag sans exiger une reconnexion.
        const mfaUpdate = (session as { mfaSetupRequired?: boolean } | undefined)?.mfaSetupRequired ??
          (session as { user?: { mfaSetupRequired?: boolean } } | undefined)?.user?.mfaSetupRequired;
        if (mfaUpdate !== undefined) {
          token.mfaSetupRequired = mfaUpdate;
        }
      }

      return token;
    },
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Mot de passe", type: "password" },
        totp: { label: "Code 2FA", type: "text" },
        turnstileToken: { label: "Turnstile Token", type: "text" },
      },
      async authorize(credentials, request) {
        const parsed = LoginSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const { email, password, totp, turnstileToken } = parsed.data;

        // ── Lockout progressif par IP ────────────────────────────────────
        // Bloque les tentatives de brute-force : après 5/10/15/20 échecs,
        // l'IP est verrouillée pour 1min/5min/15min/1h.
        const ip = getAuthorizeIP(request);
        const lockout = await checkLoginLockout(ip);
        if (lockout.locked) {
          securityLog({
            type: "login_lockout",
            ip,
            metadata: { email, remainingMs: lockout.remainingMs, failures: lockout.failures },
          });
          auditFire({
            action: "auth:login",
            verdict: "DENIED",
            resource: "user",
            reason: "IP verrouillée (lockout progressif)",
            metadata: { email, ip, remainingMs: lockout.remainingMs, failures: lockout.failures },
          });
          return null;
        }

        // ── Vérification Turnstile (anti-bot) ────────────────────────────
        // Si TURNSTILE_SECRET est configuré, un token PRÉSENT doit être valide.
        // Mode dégradé : sans secret, la vérification est ignorée.
        //
        // Un token ABSENT ne bloque plus la connexion. Raison : le widget est
        // rendu par un script tiers (challenges.cloudflare.com) qui peut être
        // indisponible pour des motifs totalement étrangers à l'utilisateur —
        // CSP trop stricte (c'était le cas ici), extension de navigateur,
        // réseau d'école filtrant, script simplement pas encore chargé au
        // moment de la soumission. Refuser dans ce cas rendait la connexion
        // impossible pour des comptes parfaitement légitimes, avec pour seul
        // retour « Email ou mot de passe incorrect ».
        //
        // La protection anti-force-brute ne repose donc PAS sur Turnstile :
        // elle est assurée par le lockout progressif par IP ci-dessus, le
        // rate limit Caddy et l'anti-énumération par email. Turnstile ajoute
        // une couche quand il fonctionne ; il ne peut plus fermer la porte
        // quand il est en panne.
        if (turnstileToken) {
          const turnstileResult = await verifyTurnstileToken(
            turnstileToken,
            request as unknown as Request
          );
          if (!turnstileResult.success) {
            void recordLoginFailure(ip);
            securityLog({
              type: "turnstile_fail",
              ip,
              metadata: { email, errorCodes: turnstileResult.errorCodes },
            });
            auditFire({
              action: "auth:login",
              verdict: "DENIED",
              resource: "user",
              reason: "Vérification Turnstile échouée",
              metadata: { email, ip, errorCodes: turnstileResult.errorCodes },
            });
            return null;
          }
        } else if (process.env.TURNSTILE_SECRET) {
          // Journalisé, jamais bloquant : permet de mesurer la proportion de
          // connexions sans token et de détecter une panne du widget.
          auditFire({
            action: "auth:login",
            verdict: "ALLOWED",
            resource: "user",
            reason: "Connexion sans token Turnstile (widget indisponible)",
            metadata: { email, ip },
          });
        }

        // Mémoïsé : une seule requête par processus. Rend visible une
        // DIRECT_URL pointant sur un rôle soumis à la RLS, configuration qui
        // fait échouer toutes les connexions sans le moindre message.
        // Non-bloquant : c'est un check diagnostic, pas une sécurité. Le
        // fire-and-forget évite qu'il ralentisse le login (11s sur la 1ère
        // connexion du processus à cause de l'établissement de connexion).
        assertDirectRoleBypassesRls().catch(() => {});

         
        // Recherche insensible à la casse : l'email est stocké avec une
        // casse arbitraire (ex. "Mohamed…") mais l'utilisateur peut taper
        // "mohamed…" — PostgreSQL + Prisma findUnique est sensible à la casse.
        // On profite de cette requête pour charger aussi les relations
        // nécessaires à deriveClaims (userTenants), évitant un second
        // aller-retour DB.
        const user = await prismaBase.user.findFirst({
          where: { email: { equals: email, mode: "insensitive" } },
        // eslint-disable-next-line ecolpro/require-site-filter, ecolpro/require-tenant-id -- login: aucune session n'existe encore, le compte doit être retrouvé au-delà des sites et des établissements (l'email est l'identifiant de connexion)
        const user = await prisma.user.findUnique({
          where: { email },
          select: {
            id: true,
            email: true,
            name: true,
            password: true,
            avatarUrl: true,
            isActive: true,
            mfaSecret: true,
            mfaEnabled: true,
            emailVerified: true,
            role: true,
            tenantId: true,
            siteId: true,
            userTenants: {
              where: { isActive: true },
              select: {
                tenantId: true,
                role: true,
                isDefault: true,
                tenant: { select: { id: true, name: true, slug: true } },
              },
            },
          },
        });

        if (!user || !user.password || !user.isActive) {
          // Anti-énumération : on effectue quand même un bcrypt.compare
          // pour égaliser le temps de réponse entre "utilisateur inexistant"
          // et "mot de passe incorrect". Sans cela, la différence de temps
          // permet à un attaquant de distinguer les emails valides.
          await bcrypt.compare(password, "$2a$12$dummyHashToPreventTimingAttackXXXXXXXXXXXXXXXXXXXX");
          void recordLoginFailure(ip);
          auditFire({
            action: "auth:login",
            verdict: "DENIED",
            resource: "user",
            resourceId: user?.id,
            reason: "Identifiants incorrects",
            metadata: { email },
          });
          return null;
        }

        const passwordMatch = await bcrypt.compare(password, user.password);
        if (!passwordMatch) {
          void recordLoginFailure(ip);
          auditFire({
            userId: user.id,
            action: "auth:login",
            verdict: "DENIED",
            resource: "user",
            resourceId: user.id,
            reason: "Identifiants incorrects",
            metadata: { email },
          });
          return null;
        }

        // ── Vérification de l'email (defense-in-depth) ────────────────
        // Le frontend vérifie déjà via /api/auth/2fa/check-required avant
        // d'appeler signIn(). Ce bloc est une sécurité de fond : si quelqu'un
        // contourne le frontend (appel direct à signIn), la connexion est
        // quand même bloquée. On return null (pas throw) car NextAuth v5
        // masque le message d'erreur de toute façon.
        if (!user.emailVerified && user.role !== "SUPER_ADMIN") {
          auditFire({
            userId: user.id,
            action: "auth:login",
            verdict: "DENIED",
            resource: "user",
            resourceId: user.id,
            reason: "Email non vérifié",
            metadata: { email },
          });
          return null;
        }

        // ── Vérification 2FA (TOTP) ──────────────────────────────────────
        if (user.mfaEnabled && user.mfaSecret) {
          if (!totp || !/^\d{6}$/.test(totp)) {
            // 2FA requise mais code non fourni — on renvoie un user "pending"
            // avec un flag spécial que le client détectera pour afficher
            // l'écran de saisie du code TOTP.
            auditFire({
              userId: user.id,
              action: "auth:login",
              verdict: "DENIED",
              reason: "2FA requise — code TOTP manquant",
              metadata: { email },
            });
            // On lance une erreur avec un code spécial que NextAuth propagera
            // comme `error=CredentialsSignin` — le client utilisera un flag
            // séparé pour distinguer "2FA requise" de "mot de passe incorrect".
            throw new Error("2FA_REQUIRED");
          }

          if (!verifyTOTP(totp, user.mfaSecret)) {
            void recordLoginFailure(ip);
            securityLog({
              type: "mfa_code_invalid",
              ip,
              userId: user.id,
              metadata: { email },
            });
            auditFire({
              userId: user.id,
              action: "auth:login",
              verdict: "DENIED",
              reason: "Code 2FA incorrect",
              metadata: { email },
            });
            return null;
          }
        }

        // Mettre à jour lastLoginAt — fire-and-forget : non critique pour
        // la connexion, ne doit pas bloquer l'utilisateur.
        prismaBase.user.update({
        // Mettre à jour lastLoginAt
        // eslint-disable-next-line ecolpro/require-site-filter, ecolpro/require-tenant-id -- login: le compte vient d'être authentifié (mot de passe vérifié ci-dessus) ; le périmètre n'est pas encore établi à ce stade du flux
        await prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        }).catch(() => {});

        // Le périmètre (tenant, sites, rôle) est dérivé par la même fonction
        // qu'au changement de tenant/site : une seule logique, donc pas de
        // divergence possible entre la connexion et les bascules ultérieures.
        // L'ancienne version calculait `siteIds` à partir des seules lignes
        // `UserSite`, sans les affectations d'enseignants et sans borner au
        // tenant actif : un enseignant se connectait avec `siteIds` vide et
        // échappait donc au filtrage par site.
        // On passe l'utilisateur déjà chargé ci-dessus pour éviter un second
        // aller-retour DB (deriveClaimsFromUser au lieu de deriveClaims).
        const claims = await deriveClaimsFromUser(user);
        if (!claims) {
          auditFire({
            userId: user.id,
            action: "auth:login",
            verdict: "DENIED",
            reason: "deriveClaims a retourné null lors de la connexion",
          });
          return null;
        }

        // ── Succès : réinitialiser le compteur d'échecs de l'IP ──────────
        void recordLoginSuccess(ip);

        // ── 2FA obligatoire pour SUPER_ADMIN ──────────────────────────────
        // Un SUPER_ADMIN sans 2FA activée peut se connecter (pour pouvoir
        // la configurer), mais un flag `mfaSetupRequired` est posé sur le
        // token. Le middleware redirige alors vers /parametres/securite
        // jusqu'à ce que la 2FA soit activée. Tant que le flag est présent,
        // l'accès à toute autre page est bloqué.
        const mfaSetupRequired =
          claims.role === "SUPER_ADMIN" && !user.mfaEnabled;

        if (mfaSetupRequired) {
          auditFire({
            userId: user.id,
            action: "auth:login",
            verdict: "ALLOWED",
            reason: "SUPER_ADMIN connecté sans 2FA — configuration requise",
            metadata: { email },
          });
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.avatarUrl,
          role: claims.role,
          tenantId: claims.tenantId,
          siteId: claims.siteId,
          siteIds: claims.siteIds,
          tenantHasSites: claims.tenantHasSites,
          availableTenants: claims.availableTenants,
          claimsVersion: claims.claimsVersion,
          mfaSetupRequired,
        };
      },
    }),
  ],
});

/**
 * `auth()` mémoïsé pour la durée d'une requête.
 *
 * POURQUOI
 * --------
 * `auth()` était appelé un très grand nombre de fois par requête :
 *   - une fois dans le layout racine (app/layout.tsx) ;
 *   - une fois dans le layout du dashboard ;
 *   - une fois dans la page elle-même, plus une par garde d'autorisation ;
 *   - **et une fois par opération Prisma**, l'extension RLS l'utilisant comme
 *     source de contexte tenant quand aucun `runWithTenant` n'est posé.
 *
 * Chaque appel déchiffre le JWE de session (dérivation HKDF + AES-GCM) et,
 * si le jeton porte un `claimsVersion` périmé, déclenche `deriveClaims` —
 * soit quatre requêtes SQL supplémentaires. Une page affichant quinze
 * requêtes Prisma payait donc quinze déchiffrements et, potentiellement,
 * soixante requêtes SQL parasites.
 *
 * `cache()` de React déduplique par requête : le travail n'est fait qu'une
 * fois, et tous les appelants suivants reçoivent la même promesse. En dehors
 * d'un contexte de requête React (scripts, tâches de fond), `cache()` se
 * comporte comme un simple passe-plat.
 */
export const auth = cache(uncachedAuth);

// Types augmentés NextAuth
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      image?: string | null;
      role: Role;
      tenantId: string | null;
      /** Site sélectionné, garanti appartenir au tenant actif. */
      siteId?: string | null;
      /** Sites du tenant actif auxquels l'utilisateur est rattaché. */
      siteIds?: string[];
      /** Le tenant actif possède-t-il au moins un site ? */
      tenantHasSites?: boolean;
      availableTenants?: AvailableTenantSlim[];
      /** SUPER_ADMIN sans 2FA : doit configurer la 2FA avant tout autre accès. */
      mfaSetupRequired?: boolean;
    };
  }
}

// Enregistrer le fetcher de session pour l'extension RLS Prisma.
// Permet à prisma-rls.ts de récupérer automatiquement le contexte
// tenant/site depuis la session NextAuth sans import circulaire.
registerAuthFetcher(async () => {
  try {
    return await auth();
  } catch {
    return null;
  }
});
