-- ============================================================
-- Fix : les structures ne sont JAMAIS partagées entre sites.
--       Chaque site possède ses propres structures.
--       L'unicité est par (tenantId, siteId, type) :
--       impossible d'avoir 2 structures PRIMAIRE sur le même site,
--       mais possible d'en avoir une sur chaque site.
--
-- Avant : @@unique([tenantId, type]) → une seule structure
--         PRIMAIRE pour tout le tenant, peu importe le site.
-- Après : un seul index unique partiel sur (tenantId, siteId, type)
--         avec siteId IS NOT NULL. Les structures partagées
--         (siteId IS NULL) ne sont plus autorisées.
-- ============================================================

-- 1. Supprimer l'ancien index unique (Prisma crée un index, pas une contrainte)
DROP INDEX IF EXISTS "structures_tenantId_type_key";

-- 2. Supprimer l'index "shared" s'il existe (nettoyage migration précédente)
DROP INDEX IF EXISTS "structures_tenant_type_shared";

-- 3. Index unique par site : une seule structure d'un type donné par site
CREATE UNIQUE INDEX IF NOT EXISTS structures_tenant_site_type
  ON structures ("tenantId", "siteId", type)
  WHERE "siteId" IS NOT NULL;
