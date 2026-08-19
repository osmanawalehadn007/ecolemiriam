-- ============================================================
-- EcolPro — Init SQL (exécuté au 1er démarrage Postgres)
-- ============================================================
-- Extensions, rôles least-privilege, fonctions RLS, default privileges.
-- Ce script ne s'exécute qu'une fois (docker-entrypoint-initdb.d).
-- ============================================================

-- 1. Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";
CREATE EXTENSION IF NOT EXISTS "pgaudit";

-- 2. Rôle applicatif (NOBYPASSRLS — la RLS s'applique obligatoirement)
DO $$ BEGIN
  CREATE ROLE ecolpro_app
    WITH LOGIN
    NOBYPASSRLS
    NOSUPERUSER
    NOCREATEDB
    NOCREATEROLE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. Rôle d'audit (pour pgaudit)
DO $$ BEGIN
  CREATE ROLE pgaudit_log NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 4. Privilèges
-- Owner : tout sur la base (pour Prisma migrations)
GRANT ALL PRIVILEGES ON DATABASE ecolpro TO ecolpro_owner;

-- App : CRUD sur les tables + exécution des fonctions + séquences
GRANT CONNECT ON DATABASE ecolpro TO ecolpro_app;
GRANT USAGE ON SCHEMA public TO ecolpro_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ecolpro_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ecolpro_app;

-- 5. Default privileges pour les futures tables (Prisma db push / migrate)
ALTER DEFAULT PRIVILEGES FOR ROLE ecolpro_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ecolpro_app;
ALTER DEFAULT PRIVILEGES FOR ROLE ecolpro_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO ecolpro_app;

-- 6. Exécution des fonctions de contexte RLS
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ecolpro_app;
ALTER DEFAULT PRIVILEGES FOR ROLE ecolpro_owner IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO ecolpro_app;

-- 7. Fonctions de contexte RLS (tenant + site)
-- Ces fonctions sont appelées par l'app via SET LOCAL au début de chaque transaction.
-- Elles permettent aux policies RLS de filtrer automatiquement par tenant/site.

CREATE OR REPLACE FUNCTION set_tenant_context(p_tenant_id TEXT)
RETURNS VOID AS $$
BEGIN
  -- Valider que le tenant existe (optionnel, évite les erreurs silencieuses)
  PERFORM set_config('app.tenant_id', p_tenant_id, true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION set_site_context(p_site_id TEXT)
RETURNS VOID AS $$
BEGIN
  -- '' ou null = pas de filtre (TENANT_ADMIN / SUPER_ADMIN = tous les sites)
  PERFORM set_config('app.site_id', COALESCE(NULLIF(p_site_id, ''), ''), true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION current_tenant_id()
RETURNS TEXT AS $$
BEGIN
  RETURN current_setting('app.tenant_id', true);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION current_site_id()
RETURNS TEXT AS $$
BEGIN
  RETURN current_setting('app.site_id', true);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- 8. Message de vérification
\echo '=== Initialisation Postgres terminée ==='
\echo 'Rôles créés : ecolpro_app (NOBYPASSRLS), pgaudit_log'
\echo 'Extensions : pgcrypto, uuid-ossp, pg_stat_statements, pgaudit'
\echo 'Fonctions RLS : set_tenant_context, set_site_context, current_tenant_id, current_site_id'
\echo 'Default privileges : configurés pour ecolpro_owner → ecolpro_app'
