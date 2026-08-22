-- ============================================================
-- École Miriam — Activation RLS complète sur VPS
-- ============================================================
-- Crée les fonctions de contexte, active RLS + FORCE RLS,
-- et crée les policies sur toutes les tables métier.
--
-- Tables EXEMPTÉES (pas de RLS) :
--   accounts, sessions, verification_tokens  (auth NextAuth)
--   tenants                                  (table racine)
--   audit_logs                               (cross-tenant, nullable tenantId)
--
-- Tables avec tenantId + siteId  → policy tenant + policy site
-- Tables avec tenantId seulement → policy tenant uniquement
--
-- SUPER_ADMIN bypass : si app.is_super_admin = 'true', toutes les
-- policies laissent passer (équivalent BYPASSRLS applicatif).
--
-- Idempotent : peut être ré-exécuté sans erreur.
-- ============================================================

-- ============================================================
-- 1. FONCTIONS DE CONTEXTE RLS
-- ============================================================

CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  RETURN current_setting('app.tenant_id', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.current_site_id()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  RETURN current_setting('app.site_id', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  RETURN current_setting('app.is_super_admin', true) = 'true';
END;
$function$;

CREATE OR REPLACE FUNCTION public.is_site_admin()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  -- SUPER_ADMIN ou TENANT_ADMIN (pas de site sélectionné) → tous les sites
  RETURN is_super_admin() OR current_site_id() IS NULL OR current_site_id() = '';
END;
$function$;

CREATE OR REPLACE FUNCTION public.site_matches(p_site_id text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  -- Admin (pas de site sélectionné) : pas de filtre
  IF is_site_admin() THEN
    RETURN true;
  END IF;
  -- Données sans site (null) : visibles par tous les sites du tenant
  IF p_site_id IS NULL THEN
    RETURN true;
  END IF;
  -- Sinon : le siteId doit correspondre au site sélectionné
  RETURN p_site_id = current_site_id();
END;
$function$;

-- ============================================================
-- 2. MACRO : activer RLS + créer policies sur une table
-- ============================================================
-- Tables avec tenantId + siteId

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
      -- Tables exemptées de RLS
      AND t.tablename NOT IN (
        'accounts', 'sessions', 'verification_tokens',
        'tenants', 'audit_logs'
      )
    ORDER BY t.tablename
  LOOP
    -- Activer RLS + FORCE RLS
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', tbl);

    -- Policy tenant : SUPER_ADMIN bypass OU tenantId correspond
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_tenant_isolation', tbl);
    EXECUTE format('
      CREATE POLICY %I ON public.%I
      USING (is_super_admin() OR "tenantId" = current_tenant_id())
      WITH CHECK (is_super_admin() OR "tenantId" = current_tenant_id())
    ', tbl || '_tenant_isolation', tbl);

    -- Policy site (si la table a siteId)
    IF has_site THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_site_isolation', tbl);
      EXECUTE format('
        CREATE POLICY %I ON public.%I
        USING (is_site_admin() OR site_matches("siteId"))
        WITH CHECK (is_site_admin() OR site_matches("siteId"))
      ', tbl || '_site_isolation', tbl);
    END IF;

  END LOOP;
END $$;

-- ============================================================
-- 3. VÉRIFICATION
-- ============================================================
SELECT '=== RLS activée sur : ===' AS info;

SELECT tablename, relrowsecurity AS rls, relforcerowsecurity AS force_rls
FROM pg_class
WHERE relnamespace = 'public'::regnamespace
  AND relkind = 'r'
  AND relrowsecurity = true
ORDER BY tablename;

-- Compter les policies
SELECT count(*) AS total_policies FROM pg_policies WHERE schemaname = 'public';

-- ============================================================
-- 4. GRANT EXECUTE sur les fonctions
-- ============================================================
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ecolemiriam_app;

\echo '=== Migration RLS terminée ==='
