/**
 * École Miriam — Client Prisma du chemin RLS (rôle applicatif)
 * =============================================================
 *
 * POURQUOI CE FICHIER EXISTE
 * --------------------------
 * L'extension RLS était branchée sur `prisma-base`, qui se connecte via
 * `DIRECT_URL` — donc avec le rôle `ecolemiriam_owner`, qui est superuser
 * et porte BYPASSRLS. Or PostgreSQL n'évalue AUCUNE policy pour un rôle
 * BYPASSRLS : les `SET LOCAL app.tenant_id` étaient bien émis, les
 * policies bien présentes, et pourtant l'isolation multi-tenant ne
 * s'appliquait jamais en production. Le `FORCE ROW LEVEL SECURITY` des
 * tables n'y change rien : il ne contraint que le propriétaire, pas un
 * rôle BYPASSRLS.
 *
 * Ce client se connecte avec `DATABASE_URL`, qui doit désigner le rôle
 * `ecolemiriam_app` (ni superuser, ni BYPASSRLS) à travers PgBouncer.
 *
 * Répartition des clients :
 *   - prisma-app  (ici)      → rôle app,   RLS APPLIQUÉE   → données métier
 *   - prisma-base            → rôle owner, RLS contournée  → auth & cross-tenant
 */

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prismaApp: PrismaClient | undefined;
};

export const prismaApp =
  globalForPrisma.prismaApp ??
  new PrismaClient({
    log: ["error"],
    datasources: { db: { url: process.env.DATABASE_URL } },
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prismaApp = prismaApp;

// ------------------------------------------------------------
// Garde-fou : le rôle de connexion doit être soumis aux policies
// ------------------------------------------------------------
/**
 * Vérifie une fois par processus que le rôle courant ne contourne pas RLS.
 *
 * C'est le contrôle qui aurait rendu la panne visible immédiatement : une
 * mauvaise `DATABASE_URL` (rôle owner) désactive silencieusement toute
 * l'isolation multi-tenant, sans la moindre erreur ni ligne de log.
 *
 * En production on refuse de servir : une isolation tenant silencieusement
 * inopérante est un incident plus grave qu'une indisponibilité.
 */
let roleCheck: Promise<void> | null = null;

export function assertRlsEnforceable(): Promise<void> {
  roleCheck ??= (async () => {
    const rows = await prismaApp.$queryRaw<
      { rolname: string; rolsuper: boolean; rolbypassrls: boolean }[]
    >`SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;

    const role = rows[0];
    if (!role) {
      throw new Error("prisma-app: rôle de connexion indéterminable.");
    }

    if (role.rolsuper || role.rolbypassrls) {
      const message =
        `prisma-app: le rôle « ${role.rolname} » contourne RLS ` +
        `(superuser=${role.rolsuper}, bypassrls=${role.rolbypassrls}). ` +
        `Les policies ne seront JAMAIS évaluées et l'isolation multi-tenant ` +
        `est inopérante. DATABASE_URL doit utiliser ecolemiriam_app.`;

      if (process.env.NODE_ENV === "production") throw new Error(message);
      console.warn(`[RLS] ${message}`);
    }
  })().catch((err) => {
    // Ne pas mémoriser un échec transitoire (DB indisponible au démarrage) :
    // sinon le processus resterait bloqué en erreur jusqu'au redémarrage.
    roleCheck = null;
    throw err;
  });

  return roleCheck;
}

export default prismaApp;
