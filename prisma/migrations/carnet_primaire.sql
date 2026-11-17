-- ============================================================
-- Migration : Carnet de l'enseignement fondamental (1ère à 5ème)
-- ============================================================
-- Ajoute la table carnets_primaires : une ligne par élève et par année,
-- avec les saisies par module en JSON (voir src/lib/carnet-primaire).
-- Isolation par tenant : RLS + FORCE, comme les autres tables (voir le bloc final).
-- ============================================================

CREATE TABLE IF NOT EXISTS "carnets_primaires" (
  "id"            TEXT PRIMARY KEY,
  "tenantId"      TEXT NOT NULL,
  "eleveId"       TEXT NOT NULL,
  "annee"         TEXT NOT NULL,
  "niveau"        TEXT NOT NULL,
  "saisie"        JSONB NOT NULL DEFAULT '{}'::jsonb,
  "appreciations" TEXT,
  "decision"      TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL
);

DO $fk$ BEGIN
  ALTER TABLE "carnets_primaires"
    ADD CONSTRAINT "carnets_primaires_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;

DO $fk$ BEGIN
  ALTER TABLE "carnets_primaires"
    ADD CONSTRAINT "carnets_primaires_eleveId_fkey"
    FOREIGN KEY ("eleveId") REFERENCES "eleves"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;

CREATE UNIQUE INDEX IF NOT EXISTS "carnets_primaires_eleveId_annee_key" ON "carnets_primaires"("eleveId", "annee");
CREATE INDEX IF NOT EXISTS "carnets_primaires_tenantId_idx" ON "carnets_primaires"("tenantId");

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
    RAISE NOTICE 'Fonctions RLS absentes : policies de carnets_primaires posées par apply-rls.sh';
    RETURN;
  END IF;
  ALTER TABLE public."carnets_primaires" ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public."carnets_primaires" FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS rls_access ON public."carnets_primaires";
  DROP POLICY IF EXISTS rls_tenant_guard ON public."carnets_primaires";
  EXECUTE format('CREATE POLICY rls_access ON public."carnets_primaires" AS PERMISSIVE FOR ALL TO public USING %s WITH CHECK %s', expr, expr);
  EXECUTE format('CREATE POLICY rls_tenant_guard ON public."carnets_primaires" AS RESTRICTIVE FOR ALL TO public USING %s WITH CHECK %s', expr, expr);
END
$rls$;
