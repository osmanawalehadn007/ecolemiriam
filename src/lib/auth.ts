import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import prismaBase from "@/lib/prisma-base";
import type { Role } from "@prisma/client";
import { authConfig, type AvailableTenant } from "@/auth.config";
import { deriveClaims, CLAIMS_VERSION } from "@/lib/tenant-claims";
import { auditFire } from "@/lib/audit";
import { verifyTOTP } from "@/lib/security/totp";
import { registerAuthFetcher } from "@/lib/prisma-rls";

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  totp: z.string().optional(), // code 2FA (6 chiffres) si activé
});

export const { handlers, auth, signIn, signOut, unstable_update } = NextAuth({
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
      },
      async authorize(credentials) {
        const parsed = LoginSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const { email, password, totp } = parsed.data;

        // eslint-disable-next-line ecolemiriam/require-site-filter -- login: no session exists yet, user must be looked up across all sites
        // Recherche insensible à la casse : l'email est stocké avec une
        // casse arbitraire (ex. "Mohamed…") mais l'utilisateur peut taper
        // "mohamed…" — PostgreSQL + Prisma findUnique est sensible à la casse.
        const user = await prismaBase.user.findFirst({
          where: { email: { equals: email, mode: "insensitive" } },
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
          },
        });

        if (!user || !user.password || !user.isActive) {
          // Anti-énumération : on effectue quand même un bcrypt.compare
          // pour égaliser le temps de réponse entre "utilisateur inexistant"
          // et "mot de passe incorrect". Sans cela, la différence de temps
          // permet à un attaquant de distinguer les emails valides.
          await bcrypt.compare(password, "$2a$12$dummyHashToPreventTimingAttackXXXXXXXXXXXXXXXXXXXX");
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

        // Mettre à jour lastLoginAt
        await prismaBase.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });

        // Le périmètre (tenant, sites, rôle) est dérivé par la même fonction
        // qu'au changement de tenant/site : une seule logique, donc pas de
        // divergence possible entre la connexion et les bascules ultérieures.
        // L'ancienne version calculait `siteIds` à partir des seules lignes
        // `UserSite`, sans les affectations d'enseignants et sans borner au
        // tenant actif : un enseignant se connectait avec `siteIds` vide et
        // échappait donc au filtrage par site.
        const claims = await deriveClaims(user.id);
        if (!claims) {
          auditFire({
            userId: user.id,
            action: "auth:login",
            verdict: "DENIED",
            reason: "deriveClaims a retourné null lors de la connexion",
          });
          return null;
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
        };
      },
    }),
  ],
});

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
      availableTenants?: AvailableTenant[];
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
