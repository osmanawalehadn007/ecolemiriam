/**
 * École Miriam — Client Prisma SANS RLS (pour auth & cross-tenant)
 * ================================================================
 *
 * Ce client NE passe PAS par l'extension RLS. Il est réservé aux
 * opérations qui doivent traverser les frontières tenant :
 *
 *   - auth.ts (login : lookup User par email, tous tenants confondus)
 *   - tenant-claims.ts (deriveClaims : lit UserTenant, User, Site)
 *   - audit.ts (écrit des logs cross-tenant, tenantId nullable)
 *   - mobile-auth (login mobile)
 *   - scripts de migration / seed
 *
 * TOUT autre fichier doit importer depuis @/lib/prisma (client RLS).
 *
 * Sécurité : ce client utilise DIRECT_URL (rôle ecolemiriam_owner,
 * BYPASSRLS) pour pouvoir lire les tables RLS-protégées (sites, etc.)
 * sans contexte tenant — indispensable pour deriveClaims au login,
 * avant qu'une session existe. En l'absence de DIRECT_URL (ex: CI sans
 * tunnel), on retombe sur DATABASE_URL.
 */

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prismaBase: PrismaClient | undefined;
};

// DIRECT_URL pointe vers Postgres direct (rôle owner, bypass RLS).
// DATABASE_URL pointe vers PgBouncer (rôle app, RLS actif).
// prismaBase doit bypasser le RLS pour lire sites/user_sites au login.
const baseURL = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

export const prismaBase =
  globalForPrisma.prismaBase ??
  new PrismaClient({
    log: ["error"],
    datasources: {
      db: {
        url: baseURL,
      },
    },
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prismaBase = prismaBase;

// ------------------------------------------------------------
// Garde-fou : le rôle de DIRECT_URL doit CONTOURNER la RLS
// ------------------------------------------------------------
/**
 * Vérifie une fois par processus que `prismaBase` se connecte bien avec un
 * rôle capable de contourner les policies RLS.
 *
 * C'est le contrôle symétrique de `assertRlsEnforceable()` dans prisma-app.ts,
 * qui vérifie l'inverse pour le client applicatif. Il manquait de ce côté-ci,
 * et son absence coûtait cher : si `DIRECT_URL` désigne `ecolemiriam_app`
 * (NOBYPASSRLS), les lectures d'authentification — recherche de l'utilisateur
 * par email, `deriveClaims` — s'exécutent sans `SET LOCAL app.tenant_id`. Les
 * policies fail-closed renvoient alors zéro ligne, `authorize()` conclut
 * « identifiants incorrects », et PLUS PERSONNE ne peut se connecter.
 *
 * La panne est totalement muette : pas d'exception, pas de log, juste un
 * `findFirst` qui retourne `null`. Ce contrôle la rend immédiatement lisible.
 *
 * On ne lève PAS d'exception : contrairement à une isolation tenant
 * silencieusement inopérante (où refuser de servir est le bon arbitrage), ici
 * le risque est l'indisponibilité, pas la fuite. On journalise donc une erreur
 * impossible à manquer et on laisse le processus vivre — si la configuration
 * est en réalité correcte, rien n'est cassé.
 */
let baseRoleCheck: Promise<void> | null = null;

export function assertDirectRoleBypassesRls(): Promise<void> {
  baseRoleCheck ??= (async () => {
    const rows = await prismaBase.$queryRaw<
      { rolname: string; rolsuper: boolean; rolbypassrls: boolean }[]
    >`SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;

    const role = rows[0];
    if (!role) return;

    if (!role.rolsuper && !role.rolbypassrls) {
      console.error(
        `[prisma-base] CONFIGURATION CRITIQUE — le rôle « ${role.rolname} » ` +
          `est soumis aux policies RLS (superuser=${role.rolsuper}, ` +
          `bypassrls=${role.rolbypassrls}). Les lectures d'authentification ` +
          `s'exécutent sans contexte tenant et renverront zéro ligne : AUCUNE ` +
          `CONNEXION NE POURRA ABOUTIR. DIRECT_URL doit utiliser ecolemiriam_owner.`
      );
    }
  })().catch((err) => {
    // Ne pas mémoriser un échec transitoire (base indisponible au démarrage).
    baseRoleCheck = null;
    console.error("[prisma-base] Vérification du rôle impossible:", err);
  });

  return baseRoleCheck;
}

export default prismaBase;
