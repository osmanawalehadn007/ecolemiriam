/**
 * EcolPro — Extension Prisma pour RLS (Row Level Security)
 * ============================================================
 *
 * Injecte le contexte tenant/site dans chaque transaction Prisma
 * via SET LOCAL, de sorte que les policies RLS de PostgreSQL
 * s'appliquent automatiquement et de façon infaillible.
 *
 * Architecture :
 * - AsyncLocalStorage transporte le contexte (tenantId, siteId)
 *   à travers la chaîne d'appels asynchrones d'une requête HTTP.
 * - L'extension Prisma intercepte chaque opération et l'enroule
 *   dans une $transaction qui positionne SET LOCAL avant d'exécuter
 *   la requête. SET LOCAL est scopé à la transaction : avec
 *   PgBouncer en mode transaction, le contexte ne fuit pas d'une
 *   requête à l'autre.
 * - Un flag (inRlsTx) empêche la récursion infinie : une fois
 *   dans la transaction, l'opération s'exécute directement.
 *
 * Usage :
 *   // Middleware / layout — au début de chaque requête :
 *   import { runWithTenant } from "@/lib/prisma-rls";
 *   const response = runWithTenant(session.user.tenantId, session.user.siteId, () => {
 *     return handler(req);
 *   });
 *
 *   // Ou avec la factory de client :
 *   import { getTenantPrisma } from "@/lib/prisma-rls";
 *   const tx = getTenantPrisma(session.user);
 *   const eleves = await tx.eleve.findMany();
 *
 * Sécurité :
 * - Si aucun contexte tenant n'est défini, les opérations sur les
 *   modèles métier échouent (fail-closed). Les modèles d'auth
 *   (Account, Session, VerificationToken) sont exemptés.
 * - Le siteId null/undefined = vue tous les sites (TENANT_ADMIN).
 */

import { Prisma, PrismaClient } from "@prisma/client";
import { AsyncLocalStorage } from "node:async_hooks";

// ------------------------------------------------------------
// Contexte transporté par AsyncLocalStorage
// ------------------------------------------------------------

interface RlsContext {
  tenantId: string;
  siteId: string | null;
}

const rlsStorage = new AsyncLocalStorage<RlsContext>();
const inRlsTx = new AsyncLocalStorage<boolean>();

// ------------------------------------------------------------
// Modèles exemptés de RLS (auth, pas de contexte tenant)
// ------------------------------------------------------------

const AUTH_MODELS = new Set([
  "Account",
  "Session",
  "VerificationToken",
]);

// Opérations qui ne portent pas sur des données métier
const META_OPERATIONS = new Set([
  "$executeRaw",
  "$queryRaw",
  "$transaction",
]);

// ------------------------------------------------------------
// Extension Prisma
// ------------------------------------------------------------

/**
 * L'extension intercepte toutes les opérations Prisma. Si un
 * contexte tenant est disponible (via AsyncLocalStorage) et que
 * l'opération cible un modèle métier, elle est enroulée dans une
 * transaction qui positionne SET LOCAL app.tenant_id et
 * app.site_id avant l'exécution.
 */
const rlsExtension = Prisma.defineExtension((client) => {
  return client.$extends({
    query: {
      $allOperations: async ({ model, operation, args, query }) => {
        // Pas de modèle (raw, transaction) → pas de RLS
        if (!model || META_OPERATIONS.has(operation)) {
          return query(args);
        }

        // Modèle d'auth → pas de RLS
        if (AUTH_MODELS.has(model)) {
          return query(args);
        }

        // Déjà dans une transaction RLS → exécuter directement
        if (inRlsTx.getStore()) {
          return query(args);
        }

        // Récupérer le contexte tenant
 const ctx = rlsStorage.getStore();
        if (!ctx) {
          // Fail-closed : refuser l'opération si aucun contexte
          throw new Error(
            `[RLS] Opération sur ${model}.${operation} sans contexte tenant. ` +
            `Utilisez runWithTenant() ou getTenantPrisma() pour établir le contexte.`
          );
        }

        // Enrouler dans une transaction avec SET LOCAL
        return inRlsTx.run(true, () =>
          (client as PrismaClient).$transaction(async (tx) => {
            await tx.$executeRaw`SELECT set_config('app.tenant_id', ${ctx.tenantId}, true)`;
            await tx.$executeRaw`SELECT set_config('app.site_id', ${ctx.siteId ?? ''}, true)`;
            return query(args);
          })
        );
      },
    },
  });
});

// ------------------------------------------------------------
// Client Prisma avec RLS
// ------------------------------------------------------------

import prisma from "./prisma";

/** Client Prisma étendu avec l'RLS. */
export const prismaWithRls = prisma.$extends(rlsExtension);

// ------------------------------------------------------------
// API publique
// ------------------------------------------------------------

/**
 * Exécute une fonction dans un contexte tenant/site donné.
 * Toutes les opérations Prisma effectuées dans la fonction
 * (sur le client étendu) voient automatiquement le contexte.
 *
 * @example
 *   const result = await runWithTenant(
 *     session.user.tenantId,
 *     session.user.siteId,
 *     () => prismaWithRls.eleve.findMany()
 *   );
 */
export async function runWithTenant<T>(
  tenantId: string,
  siteId: string | null,
  fn: () => Promise<T>
): Promise<T> {
  return rlsStorage.run({ tenantId, siteId }, fn);
}

/**
 * Retourne le contexte RLS courant (tenantId, siteId) ou null
 * si aucun contexte n'est défini.
 */
export function getCurrentRlsContext(): RlsContext | null {
  return rlsStorage.getStore() ?? null;
}

/**
 * Vérifie qu'un contexte tenant est bien défini. À appeler en
 * début de route API pour fail-fast avant toute opération Prisma.
 *
 * @throws si aucun contexte n'est défini.
 */
export function assertTenantContext(): RlsContext {
  const ctx = rlsStorage.getStore();
  if (!ctx) {
    throw new Error(
      "[RLS] Aucun contexte tenant défini. " +
      "Assurez-vous que la route est wrappée par runWithTenant()."
    );
  }
  return ctx;
}
