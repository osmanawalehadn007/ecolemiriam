/**
 * École Miriam — Client Prisma par défaut (AVEC RLS)
 * ====================================================
 *
 * Tous les fichiers qui importent `prisma` depuis @/lib/prisma
 * obtiennent automatiquement le client RLS. Chaque opération Prisma
 * est interceptée par l'extension qui :
 *   1. Récupère le contexte tenant/site depuis la session NextAuth
 *   2. Enroule la requête dans une transaction avec SET LOCAL
 *   3. Les policies RLS de PostgreSQL filtrent automatiquement
 *
 * Pour les opérations cross-tenant (auth, deriveClaims, audit),
 * utiliser @/lib/prisma-base (client sans RLS).
 */

export { prismaWithRls as default } from "./prisma-rls";
export { prismaWithRls as prisma } from "./prisma-rls";
export { runWithTenant, runWithRlsBatch, getCurrentRlsContext, registerAuthFetcher } from "./prisma-rls";
const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createPrismaClient> | undefined;
};

// ---------------------------------------------------------------------------
// Émission d'événements LEARNOS sur les modèles pédagogiques (zero-change)
// ---------------------------------------------------------------------------
// Prisma 6 a supprimé `$use` : on utilise `$extends({ query })`, qui intercepte
// toute création/modification/suppression d'une note, absence, évaluation,
// examen ou bulletin et émet un événement dans le bus LEARNOS.

const TRACKED_MODELS = new Set(["note", "absence", "evaluation", "examen", "bulletin"]);

function extractIds(result: unknown): {
  id?: string;
  tenantId?: string;
  siteId?: string | null;
} {
  if (!result || typeof result !== "object") return {};
  const r = result as Record<string, unknown>;
  return {
    id: typeof r.id === "string" ? r.id : undefined,
    tenantId: typeof r.tenantId === "string" ? r.tenantId : undefined,
    siteId: typeof r.siteId === "string" || r.siteId === null ? (r.siteId as string | null) : undefined,
  };
}

async function emitAfterWrite(model: string, action: string, result: unknown): Promise<void> {
  if (!TRACKED_MODELS.has(model)) return;
  const { id, tenantId, siteId } = extractIds(result);
  if (!id || !tenantId) return;

  const eventType =
    action === "create"
      ? `${model}.created`
      : action === "delete"
        ? `${model}.deleted`
        : model === "bulletin"
          ? "bulletin.published"
          : `${model}.updated`;

  try {
    const { emitFromPrismaChange } = await import("@/lib/learnos/events");
    await emitFromPrismaChange(model, id, tenantId, siteId, eventType as never, {
      action,
    });
  } catch (error) {
    console.error(`[LEARNOS/EventBus] emit failed for ${model}.${action}`, error);
  }
}

function createPrismaClient() {
  const base = new PrismaClient({
    log: ["error"],
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
      },
    },
  });

  return base.$extends({
    query: {
      $allModels: {
        async create({ model, args, query }) {
          const result = await query(args);
          await emitAfterWrite(model, "create", result);
          return result;
        },
        async update({ model, args, query }) {
          const result = await query(args);
          await emitAfterWrite(model, "update", result);
          return result;
        },
        async delete({ model, args, query }) {
          // Pour un delete, le résultat contient la ligne supprimée : on
          // émet avant de retourner pour conserver les identifiants.
          const result = await query(args);
          await emitAfterWrite(model, "delete", result);
          return result;
        },
      },
    },
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export default prisma;
