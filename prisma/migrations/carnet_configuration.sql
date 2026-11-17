-- ============================================================
-- Migration : Configuration des carnets par niveau
-- ============================================================
-- Ajoute carnet_configurations : la direction ajuste les domaines,
-- compétences et barèmes de chaque niveau (1ère à 5ème). Sans ligne,
-- le modèle par défaut de src/lib/carnet-primaire s'applique.
-- À appliquer après carnet_primaire.sql.
-- ============================================================

CREATE TABLE IF NOT EXISTS "carnet_configurations" (
  "id"        TEXT PRIMARY KEY,
  "tenantId"  TEXT NOT NULL,
  "niveau"    TEXT NOT NULL,
  "domaines"  JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

DO $fk$ BEGIN
  ALTER TABLE "carnet_configurations"
    ADD CONSTRAINT "carnet_configurations_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;

CREATE UNIQUE INDEX IF NOT EXISTS "carnet_configurations_tenantId_niveau_key"
  ON "carnet_configurations"("tenantId", "niveau");

-- RLS : mêmes politiques que celles générées par prisma/migration_rls_secure.sql
-- (rls_access + rls_tenant_guard, fonctions app_*). Si ces fonctions n'existent pas
-- encore sur cette base, rien n'est posé ici : docker/scripts/apply-rls.sh les crée
-- et protège la table au prochain déploiement (elle est découverte par sa colonne tenantId).
DO $rls$
DECLARE
  expr text := '(public.app_is_super_admin() OR ("tenantId" = public.app_tenant_id()))';
BEGIN
  IF to_regprocedure('public.app_tenant_id()') IS NULL
     OR to_regprocedure('public.app_is_super_admin()') IS NULL THEN
    RAISE NOTICE 'Fonctions RLS absentes : policies de carnet_configurations posées par apply-rls.sh';
    RETURN;
  END IF;
  ALTER TABLE public."carnet_configurations" ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public."carnet_configurations" FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS rls_access ON public."carnet_configurations";
  DROP POLICY IF EXISTS rls_tenant_guard ON public."carnet_configurations";
  EXECUTE format('CREATE POLICY rls_access ON public."carnet_configurations" AS PERMISSIVE FOR ALL TO public USING %s WITH CHECK %s', expr, expr);
  EXECUTE format('CREATE POLICY rls_tenant_guard ON public."carnet_configurations" AS RESTRICTIVE FOR ALL TO public USING %s WITH CHECK %s', expr, expr);
END
$rls$;
