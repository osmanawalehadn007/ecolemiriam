-- ============================================================
-- École Miriam — FIX RLS : policies combinées (tenant AND site)
-- ============================================================
-- Le problème : PostgreSQL OR les policies permissives.
-- La policy site_isolation laissait tout passer car is_site_admin()
-- retourne TRUE sans contexte site → court-circuitait la policy tenant.
--
-- Solution : une SEULE policy par table qui combine tenant AND site
-- avec le bypass SUPER_ADMIN.
--
-- Idempotent.
-- ============================================================

DO $$
DECLARE
  tbl text;
  has_site boolean;
BEGIN
  FOR tbl, has_site IN
    SELECT t.tablename,
           EXISTS (
             SELECT 1 FROM information_schema.columns c
             WHERE c.table_schema = 'public'
               AND c.table_name = t.tablename
               AND c.column_name = 'siteId'
           )
    FROM pg_tables t
    WHERE t.schemaname = 'public'
      AND EXISTS (
        SELECT 1 FROM information_schema.columns c
        WHERE c.table_schema = 'public'
          AND c.table_name = t.tablename
          AND c.column_name = 'tenantId'
      )
      AND t.tablename NOT IN (
        'accounts', 'sessions', 'verification_tokens',
        'tenants', 'audit_logs'
      )
    ORDER BY t.tablename
  LOOP
    -- Supprimer les anciennes policies séparées
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_tenant_isolation', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_site_isolation', tbl);

    -- Créer une policy unique combinée
    IF has_site THEN
      -- Table avec tenantId + siteId
      EXECUTE format('
        CREATE POLICY %I ON public.%I
        USING (
          is_super_admin()
          OR (
            "tenantId" = current_tenant_id()
            AND (is_site_admin() OR site_matches("siteId"))
          )
        )
        WITH CHECK (
          is_super_admin()
          OR (
            "tenantId" = current_tenant_id()
            AND (is_site_admin() OR site_matches("siteId"))
          )
        )
      ', tbl || '_rls_combined', tbl);
    ELSE
      -- Table avec tenantId seulement
      EXECUTE format('
        CREATE POLICY %I ON public.%I
        USING (is_super_admin() OR "tenantId" = current_tenant_id())
        WITH CHECK (is_super_admin() OR "tenantId" = current_tenant_id())
      ', tbl || '_rls_combined', tbl);
    END IF;

  END LOOP;
END $$;

-- ============================================================
-- VÉRIFICATION
-- ============================================================
SELECT count(*) AS total_policies FROM pg_policies WHERE schemaname = 'public';

\echo '=== Fix RLS policies terminé ==='
