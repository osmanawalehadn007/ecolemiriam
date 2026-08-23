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

export default prismaBase;
