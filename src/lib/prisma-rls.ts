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

const EXEMPT_MODELS = new Set([
  // Auth NextAuth
  "Account",
  "Session",
  "VerificationToken",
  // Gestion cross-tenant (pas de RLS sur ces tables)
  "User",
  "Tenant",
  "UserTenant",
  "UserSite",
  "AuditLog",
  "DeviceToken",
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

        // Pas de contexte → exécuter sans SET LOCAL
        // La DB RLS renverra 0 ligne pour les tables protégées (fail-closed)
        if (!ctx || !ctx.tenantId) {
          return query(args);
        }

        // Enrouler dans une transaction avec SET LOCAL
        // IMPORTANT: on doit utiliser le client étendu (pas `query`)
        // pour que la requête s'exécute DANS la transaction.
        const isSuperAdmin = ctx.role === "SUPER_ADMIN";
        const ctxRef = ctx;
        return inRlsTx.run(true, () =>
          (client as PrismaClient).$transaction(
            async (tx) => {
              if (isSuperAdmin) {
                await tx.$executeRaw`SELECT set_config('app.is_super_admin', 'true', true)`;
              } else {
                await tx.$executeRaw`SELECT set_config('app.tenant_id', ${ctxRef.tenantId!}, true)`;
                await tx.$executeRaw`SELECT set_config('app.site_id', ${ctxRef.siteId ?? ''}, true)`;
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

import prismaBase from "./prisma-base";

/** Client Prisma étendu avec l'RLS. */
export const prismaWithRls = prismaBase.$extends(rlsExtension);

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
