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
 * Sécurité : ce client utilise le rôle ecolemiriam_app (NOBYPASSRLS).
 * Les tables exemptées de RLS (users, tenants, user_tenants, audit_logs,
 * accounts, sessions, verification_tokens) sont librement accessibles.
 * Les tables métier RLS-protégées renvoient 0 ligne sans contexte.
 */

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prismaBase: PrismaClient | undefined;
};

export const prismaBase =
  globalForPrisma.prismaBase ??
  new PrismaClient({
    log: ["error"],
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
      },
    },
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prismaBase = prismaBase;

export default prismaBase;
