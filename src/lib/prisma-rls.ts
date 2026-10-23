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

/**
 * Convertit un nom de modèle Prisma vers la propriété du client.
 *
 * `$allOperations` reçoit le nom tel qu'écrit dans le schéma — en PascalCase
 * (`Eleve`, `SessionExamen`) — alors que le délégué du client est en camelCase
 * (`prisma.eleve`, `prisma.sessionExamen`). Sans cette conversion,
 * `client["Eleve"]` vaut `undefined` et l'on retombe systématiquement sur le
 * chemin de repli.
 */
function uncapitalize(name: string): string {
  return name.charAt(0).toLowerCase() + name.slice(1);
}

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
// Résolution du contexte (ALS d'abord, puis fetchers de session)
// ------------------------------------------------------------

async function resolveRlsContext(): Promise<RlsContext | null> {
  const stored = rlsStorage.getStore();
  if (stored) return stored;
  for (const fetcher of authFetchers) {
    try {
      const session = await fetcher();
      if (session?.user?.tenantId) {
        return {
          tenantId: session.user.tenantId ?? null,
          siteId: session.user.siteId ?? null,
          role: session.user.role ?? null,
        };
      }
    } catch {
      // Ce fetcher a échoué, essayer le suivant
    }
  }
  return null;
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

        const ctx = await resolveRlsContext();

        // Pas de contexte → fail-closed explicite (N-5)
        // Avant : on exécutait sans SET LOCAL et la DB renvoyait 0 ligne
        // silencieusement → bugs invisibles (listes vides sans erreur).
        // Maintenant : on throw pour rendre le bug visible et empêcher
        // l'application de présenter un état incohérent.
        if (!ctx || !ctx.tenantId) {
          // Logger l'absence de contexte RLS — c'est un bug potentiel
          // (fuite de données ou données vides silencieuses).
          console.warn(
            `[SECURITY] rls_no_context model=${model} op=${operation}`
          );
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

        // Fragment SQL posant le contexte tenant, construit sur le client NON
        // étendu : le repasser par `prismaWithRls` relancerait l'extension.
        const setContext = isSuperAdmin
          ? prismaApp.$executeRaw`SELECT set_config('app.is_super_admin', 'true', true)`
          : prismaApp.$executeRaw`SELECT set_config('app.tenant_id', ${ctxRef.tenantId!}, true), set_config('app.site_id', ${ctxRef.siteId ?? ''}, true)`;

        // ---- Chemin rapide : transaction « batch » --------------------------
        // La forme interactive `$transaction(async tx => …)` impose à Node de
        // piloter la transaction pas à pas : BEGIN, puis set_config, puis la
        // requête, puis COMMIT — quatre allers-retours, chacun repassant par
        // l'event loop. Mesuré en production : 8,4 ms par aller-retour, soit
        // ~34 ms de protocole pour ~16 ms de travail utile. Les deux tiers du
        // temps passé en base ne servaient à rien.
        //
        // La forme tableau confie la séquence entière au moteur de requêtes en
        // un seul appel : Node n'attend plus qu'une fois. La sémantique est
        // identique — même transaction, donc `set_config(..., true)` reste
        // bien local à celle-ci et ne peut pas fuir vers une autre requête via
        // PgBouncer.
        const baseDelegates = prismaApp as unknown as Record<
          string,
          Record<string, (a: unknown) => Promise<unknown>> | undefined
        >;
        const delegate = baseDelegates[uncapitalize(model)];

        if (delegate && typeof delegate[operation] === "function") {
          const [, result] = await prismaApp.$transaction([
            setContext,
            delegate[operation](args) as never,
          ]);
          return result;
        }

        // ---- Repli : transaction interactive -------------------------------
        // Opération sans délégué correspondant (cas rares : `$runCommandRaw`,
        // nouveautés du client). On garde l'ancien chemin plutôt que d'exécuter
        // sans contexte tenant, ce qui renverrait 0 ligne en silence.
        return inRlsTx.run(true, () =>
          (client as PrismaClient).$transaction(
            async (tx) => {
              if (isSuperAdmin) {
                await tx.$executeRaw`SELECT set_config('app.is_super_admin', 'true', true)`;
              } else {
                await tx.$executeRaw`SELECT set_config('app.tenant_id', ${ctxRef.tenantId!}, true), set_config('app.site_id', ${ctxRef.siteId ?? ''}, true)`;
              }
              const txAny = tx as unknown as Record<string, Record<string, (a: unknown) => Promise<unknown>>>;
              const modelDelegate = txAny[uncapitalize(model!)];
              if (!modelDelegate || typeof modelDelegate[operation] !== "function") {
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
  fn: () => Promise<T>,
  role?: string | null
): Promise<T> {
  // Le rôle était figé à `null`. Conséquence : à l'intérieur d'un
  // `runWithTenant`, `isSuperAdmin` valait toujours faux et `app.is_super_admin`
  // n'était jamais posé — un SUPER_ADMIN se voyait donc filtré par les
  // policies RLS comme un utilisateur ordinaire, et récupérait des listes
  // vides. On conserve d'abord un rôle déjà présent dans le contexte
  // englobant, sinon celui passé explicitement.
  const inherited = rlsStorage.getStore()?.role ?? null;
  // Le `await` doit avoir lieu À L'INTÉRIEUR du scope ALS. Une PrismaPromise
  // est paresseuse : elle ne déclenche la requête qu'au `.then()`. Avec
  // `rlsStorage.run(ctx, fn)`, une lambda concise — `() => prisma.eleve.findMany()`
  // — crée la promesse dans le scope mais la laisse exécuter en dehors : le
  // contexte tenant est alors introuvable et l'extension lève « contexte tenant
  // manquant ». L'enveloppe async force la résolution dans le scope.
  // Les fonctions `async` passées par le reste du code étaient déjà correctes
  // (elles démarrent immédiatement) ; cette enveloppe couvre les deux formes.
  return rlsStorage.run({ tenantId, siteId, role: role ?? inherited }, async () => await fn());
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

/**
 * Exécute plusieurs requêtes Prisma indépendantes en UN SEUL aller-retour
 * Node → moteur, dans une seule transaction RLS, sur une seule connexion.
 *
 * `Promise.all([prisma.a…, prisma.b…])` ouvre une transaction par requête
 * (N connexions prélevées sur le pool, N `set_config`). Ici, le contexte
 * tenant est posé une fois puis toutes les requêtes s'enchaînent :
 *
 *   const [eleves, classes] = await rlsBatch((db) => [
 *     db.eleve.count({ where }),
 *     db.classe.findMany({ where }),
 *   ]);
 *
 * Le callback reçoit le client NON étendu : le contexte est déjà posé par la
 * transaction, l'extension ne doit pas le reposer. Il doit retourner des
 * requêtes non attendues (pas de `await`) ; toute valeur à résoudre avant
 * (année courante, scope) se calcule en amont.
 */
export async function rlsBatch<T extends Prisma.PrismaPromise<unknown>[]>(
  build: (db: PrismaClient) => [...T]
): Promise<{ [K in keyof T]: Awaited<T[K]> }> {
  const ctx = await resolveRlsContext();
  if (!ctx || !ctx.tenantId) {
    throw new Error("rlsBatch: contexte tenant manquant — appelez runWithTenant() ou auth().");
  }
  await assertRlsEnforceable();

  const setContext =
    ctx.role === "SUPER_ADMIN"
      ? prismaApp.$executeRaw`SELECT set_config('app.is_super_admin', 'true', true)`
      : prismaApp.$executeRaw`SELECT set_config('app.tenant_id', ${ctx.tenantId}, true), set_config('app.site_id', ${ctx.siteId ?? ""}, true)`;

  const results = await prismaApp.$transaction([setContext, ...build(prismaApp as PrismaClient)]);
  return results.slice(1) as { [K in keyof T]: Awaited<T[K]> };
}
