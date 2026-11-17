-- ============================================================
-- Migration : table des compétences du carnet (1ère à 5ème année)
-- ============================================================
-- Une ligne = une compétence d'un domaine d'un niveau, éditée dans
-- Paramètres > Matières. Pour un (tenant, niveau, domaine) qui a des lignes ici,
-- elles remplacent les lignes de compétence du modèle / de carnet_configurations.
-- À appliquer après carnet_configuration.sql.
-- ============================================================

CREATE TABLE IF NOT EXISTS "competences" (
  "id"        TEXT PRIMARY KEY,
  "tenantId"  TEXT NOT NULL,
  "niveau"    TEXT NOT NULL,
  "domaine"   TEXT NOT NULL,
  "ordre"     INTEGER NOT NULL,
  "libelle"   TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

DO $fk$ BEGIN
  ALTER TABLE "competences"
    ADD CONSTRAINT "competences_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;

CREATE UNIQUE INDEX IF NOT EXISTS "competences_tenantId_niveau_domaine_ordre_key"
  ON "competences"("tenantId", "niveau", "domaine", "ordre");

DO $rls$
DECLARE
  expr text := '(public.app_is_super_admin() OR ("tenantId" = public.app_tenant_id()))';
BEGIN
  IF to_regprocedure('public.app_tenant_id()') IS NULL
     OR to_regprocedure('public.app_is_super_admin()') IS NULL THEN
    RAISE NOTICE 'Fonctions RLS absentes : policies de competences posées par apply-rls.sh';
    RETURN;
  END IF;
  ALTER TABLE public."competences" ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public."competences" FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS rls_access ON public."competences";
  DROP POLICY IF EXISTS rls_tenant_guard ON public."competences";
  EXECUTE format('CREATE POLICY rls_access ON public."competences" AS PERMISSIVE FOR ALL TO public USING %s WITH CHECK %s', expr, expr);
  EXECUTE format('CREATE POLICY rls_tenant_guard ON public."competences" AS RESTRICTIVE FOR ALL TO public USING %s WITH CHECK %s', expr, expr);
END
$rls$;
