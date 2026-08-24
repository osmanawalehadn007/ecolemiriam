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
