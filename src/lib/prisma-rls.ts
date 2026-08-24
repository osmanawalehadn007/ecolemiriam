/**
 * École Miriam — Extension Prisma pour RLS (Row Level Security)
 * ============================================================
 *
 * Injecte le contexte tenant/site dans chaque transaction Prisma
 * via SET LOCAL, de sorte que les policies RLS de PostgreSQL
 * s'appliquent automatiquement et de façon infaillible.
 *
 * Architecture :
 * - AsyncLocalStorage transporte le contexte (tenantId, siteId, role)
 *   à travers la chaîne d'appels asynchrones d'une requête HTTP.
 * - L'extension Prisma intercepte chaque opération et l'enroule
 *   dans une $transaction qui positionne SET LOCAL avant d'exécuter
 *   la requête. SET LOCAL est scopé à la transaction : avec
 *   PgBouncer en mode transaction, le contexte ne fuit pas d'une
 *   requête à l'autre.
 * - Un flag (inRlsTx) empêche la récursion infinie : une fois
 *   dans la transaction, l'opération s'exécute directement.
 * - Si aucun contexte ALS n'est défini, l'extension tente de
 *   récupérer la session NextAuth automatiquement (lazy fetch).
 *   Si pas de session → l'opération s'exécute sans contexte RLS
 *   et la base renvoie 0 ligne (fail-closed au niveau DB).
 *
 * Sécurité :
 * - SUPER_ADMIN : positionne app.is_super_admin='true' au lieu
 *   d'un tenant_id → les policies RLS laissent tout passer.
 * - Si aucun contexte tenant n'est défini et pas de session,
 *   les tables RLS-protégées renvoient 0 ligne (fail-closed DB).
 * - Les modèles d'auth (Account, Session, VerificationToken) et
 *   les tables de gestion (User, Tenant, UserTenant, UserSite,
 *   AuditLog, DeviceToken) sont exemptés (pas de RLS côté DB).
 */

import { Prisma, PrismaClient } from "@prisma/client";
import { AsyncLocalStorage } from "node:async_hooks";

// ------------------------------------------------------------
// Contexte transporté par AsyncLocalStorage
// ------------------------------------------------------------

interface RlsContext {
  tenantId: string | null;
  siteId: string | null;
  role: string | null;
}

const rlsStorage = new AsyncLocalStorage<RlsContext>();
const inRlsTx = new AsyncLocalStorage<boolean>();

// ------------------------------------------------------------
// Modèles exemptés de RLS (tables sans RLS côté DB)
// ------------------------------------------------------------

// Cette liste DOIT correspondre exactement aux tables sans RLS en base
// (section 3c de prisma/migration_rls_secure.sql). Un modèle exempté ici
// mais protégé en base renverrait 0 ligne : aucun contexte n'étant posé,
// les policies fail-closed rejettent tout.
//
// Exempter un modèle, c'est renoncer à l'isolation garantie par la base et
// la reporter sur les clauses `where` du code applicatif. Réservé aux
// tables lues avant qu'un contexte tenant existe.
export const EXEMPT_MODELS = new Set([
  // Auth NextAuth : lues par l'adaptateur, hors de toute requête tenant.
  "Account",
  "Session",
  "VerificationToken",
  // Identité cross-tenant : résolution d'appartenance au login et bascule
  // de tenant/site interrogent délibérément d'autres tenants que le courant.
  "Tenant",
  "UserTenant",
  "UserSite",
  // User : RLS est active sur users avec une policy tenant-only (pas de
  // filtrage par site). Le siteId de users n'est qu'une préférence, pas un
  // périmètre de sécurité — les rattachements réels sont dans user_sites et
  // enseignant_sites. Une policy avec filtre par site cassait les jointures
  // enseignant → user (Prisma crash "Field user is required, got null").
  // "User" n'est PAS exempté : l'extension RLS pose le contexte tenant pour
  // chaque requête, et la policy tenant_isolation filtre correctement.
]);

// Opérations qui ne portent pas sur des données métier
const META_OPERATIONS = new Set([
  "$executeRaw",
  "$queryRaw",
  "$transaction",
]);

// ------------------------------------------------------------
// Lazy session fetch (évite la dépendance circulaire avec auth.ts)
// ------------------------------------------------------------

type SessionFetcher = () => Promise<{ user?: { tenantId?: string | null; siteId?: string | null; role?: string | null } } | null>;

// Liste de fetchers : web (NextAuth cookies) + mobile (Bearer token).
// L'extension essaie chaque fetcher jusqu'à obtenir un contexte tenant.
const authFetchers: SessionFetcher[] = [];

/**
 * Permet à auth.ts d'enregistrer sa fonction auth() sans créer
 * de dépendance circulaire (prisma-rls → auth → prisma → prisma-rls).
 */
export function registerAuthFetcher(fn: SessionFetcher): void {
  authFetchers.push(fn);
}

// ------------------------------------------------------------
// Extension Prisma
// ------------------------------------------------------------

const rlsExtension = Prisma.defineExtension((client) => {
  return client.$extends({
    query: {
      $allOperations: async ({ model, operation, args, query }) => {
        // Pas de modèle (raw, transaction) → pas de RLS
        if (!model || META_OPERATIONS.has(operation)) {
          return query(args);
        }

        // Modèle exempté → pas de RLS
        if (EXEMPT_MODELS.has(model)) {
          return query(args);
        }

        // Déjà dans une transaction RLS → exécuter directement
        if (inRlsTx.getStore()) {
          return query(args);
        }

        // Récupérer le contexte tenant (ALS d'abord, puis fetchers)
        let ctx = rlsStorage.getStore();
        if (!ctx && authFetchers.length > 0) {
          for (const fetcher of authFetchers) {
            try {
              const session = await fetcher();
              if (session?.user?.tenantId) {
                ctx = {
                  tenantId: session.user.tenantId ?? null,
                  siteId: session.user.siteId ?? null,
                  role: session.user.role ?? null,
                };
                break;
              }
            } catch {
              // Ce fetcher a échoué, essayer le suivant
            }
          }
        }

        // Pas de contexte → fail-closed explicite (N-5)
        // Avant : on exécutait sans SET LOCAL et la DB renvoyait 0 ligne
        // silencieusement → bugs invisibles (listes vides sans erreur).
        // Maintenant : on throw pour rendre le bug visible et empêcher
        // l'application de présenter un état incohérent.
        if (!ctx || !ctx.tenantId) {
          throw new Error(
            "prisma-rls: contexte tenant manquant — " +
            "appelez runWithTenant() ou auth() dans le contexte requête. " +
            `Modèle: ${model}, opération: ${operation}`
          );
        }

        // Enrouler dans une transaction avec SET LOCAL
        // IMPORTANT: on doit utiliser le client étendu (pas `query`)
        // pour que la requête s'exécute DANS la transaction.
        //
        // OPTIMISATION: les deux set_config sont fusionnés en un seul
        // $executeRaw afin de réduire de 3 à 2 le nombre d'allers-retours
        // DB par requête (soit -33% de latence sur chaque opération Prisma).
        // Refuse de servir si le rôle de connexion contourne RLS : sans
        // ce contrôle, une DATABASE_URL pointant sur le rôle owner désactive
        // toute l'isolation en silence (aucune erreur, aucun log).
        await assertRlsEnforceable();

        const isSuperAdmin = ctx.role === "SUPER_ADMIN";
        const ctxRef = ctx;
        return inRlsTx.run(true, () =>
          (client as PrismaClient).$transaction(
            async (tx) => {
              if (isSuperAdmin) {
                await tx.$executeRaw`SELECT set_config('app.is_super_admin', 'true', true)`;
              } else {
                // Fusion des deux SET LOCAL en une seule requête SQL
                // — économise un round trip complet par opération Prisma.
                await tx.$executeRaw`SELECT set_config('app.tenant_id', ${ctxRef.tenantId!}, true), set_config('app.site_id', ${ctxRef.siteId ?? ''}, true)`;
              }
              // Exécuter l'opération sur le tx (pas sur le client outer)
              // On accède au modèle via le tx qui est le client Prisma dans la transaction
              const txAny = tx as unknown as Record<string, Record<string, (a: unknown) => Promise<unknown>>>;
              const modelDelegate = txAny[model!];
              if (!modelDelegate || typeof modelDelegate[operation] !== "function") {
                // Fallback: utiliser query (le contexte SET LOCAL est actif)
                return query(args);
              }
              return modelDelegate[operation](args);
            },
            { timeout: 30000, maxWait: 10000 }
          )
        );
      },
    },
  });
});

// ------------------------------------------------------------
// Client Prisma avec RLS
// ------------------------------------------------------------

import { prismaApp, assertRlsEnforceable } from "./prisma-app";

/**
 * Client Prisma étendu avec l'RLS.
 *
 * Bâti sur `prismaApp` (DATABASE_URL → rôle ecolemiriam_app) et NON sur
 * `prismaBase` (DIRECT_URL → rôle owner, BYPASSRLS) : un rôle BYPASSRLS
 * n'évalue aucune policy, ce qui rendait l'isolation tenant totalement
 * inopérante alors même que les SET LOCAL étaient correctement émis.
 */
export const prismaWithRls = prismaApp.$extends(rlsExtension);

// ------------------------------------------------------------
// API publique
// ------------------------------------------------------------

/**
 * Exécute une fonction dans un contexte tenant/site donné.
 * Toutes les opérations Prisma effectuées dans la fonction
 * (sur le client étendu) voient automatiquement le contexte.
 */
export async function runWithTenant<T>(
  tenantId: string | null,
  siteId: string | null,
  fn: () => Promise<T>
): Promise<T> {
  return rlsStorage.run({ tenantId, siteId, role: null }, fn);
}

/**
 * Retourne le contexte RLS courant (tenantId, siteId, role) ou null.
 */
export function getCurrentRlsContext(): RlsContext | null {
  return rlsStorage.getStore() ?? null;
}

/**
 * Exécute plusieurs opérations Prisma dans UNE SEULE transaction RLS.
 *
 * Normalement, chaque appel Prisma (findMany, count, groupBy...) est
 * enroulé individuellement dans une $transaction avec SET LOCAL — soit
 * 2 round trips DB par opération. Avec N opérations en parallèle
 * (Promise.all), cela fait 2N round trips.
 *
 * Cette fonction pose UN SEUL SET LOCAL puis exécute toutes les
 * opérations dans la même transaction → 1 + N round trips au lieu de 2N.
 * Pour N=5 opérations via un tunnel SSH à ~100ms/round trip, on passe
 * de 1000ms à 600ms (-40%).
 *
 * @example
 * const [eleves, stats, classes] = await runWithRlsBatch(tenantId, siteId, async (tx) => [
 *   await tx.eleve.findMany({ where }),
 *   await tx.eleve.groupBy({ by: ["statut"], where, _count: true }),
 *   await tx.classe.findMany({ where }),
 * ]);
 */
export async function runWithRlsBatch<T>(
  tenantId: string | null,
  siteId: string | null,
  fn: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  // Si pas de tenant, on ne peut pas faire de RLS
  if (!tenantId) {
    throw new Error("runWithRlsBatch: tenantId requis");
  }

  const ctx: RlsContext = { tenantId, siteId, role: null };

  // Récupérer le rôle depuis le contexte ALS si disponible
  const existingCtx = rlsStorage.getStore();
  if (existingCtx?.role) {
    ctx.role = existingCtx.role;
  }

  const isSuperAdmin = ctx.role === "SUPER_ADMIN";

  await assertRlsEnforceable();

  return rlsStorage.run(ctx, () =>
    inRlsTx.run(true, () =>
      (prismaApp as PrismaClient).$transaction(
        async (tx) => {
          if (isSuperAdmin) {
            await tx.$executeRaw`SELECT set_config('app.is_super_admin', 'true', true)`;
          } else {
            await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true), set_config('app.site_id', ${siteId ?? ''}, true)`;
          }
          return fn(tx);
        },
        { timeout: 30000, maxWait: 10000 }
      )
    )
  );
}
