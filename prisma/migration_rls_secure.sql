-- ============================================================
-- École Miriam — RLS SÉCURISÉ (source de vérité unique)
-- ============================================================
-- Remplace les migrations de prisma/obsolete/ (cf. README de ce dossier).
--
-- CE QUI ÉTAIT CASSÉ
-- ------------------
-- 1. `<table>_site_isolation` était une policy PERMISSIVE dont le qual
--    `is_site_admin() OR site_matches("siteId")` ne contient AUCUN
--    contrôle de tenant, et `is_site_admin()` renvoie TRUE dès que
--    `app.site_id` est vide. PostgreSQL combinant les policies
--    permissives en OR, cette seule policy rendait visibles toutes les
--    lignes de tous les tenants. Mesuré en prod : un contexte
--    `app.tenant_id = 'TENANT_INEXISTANT'` retournait 880 élèves.
-- 2. Jusqu'à 4 policies permissives empilées par table : la plus faible
--    l'emporte toujours.
-- 3. Les fonctions de contexte étaient fail-OPEN (absence de contexte
--    interprétée comme « accès administrateur »).
--
-- PRINCIPES
-- ---------
-- * Fail-closed : sans contexte tenant, zéro ligne. Toujours.
-- * Exactement UNE policy permissive par table (pas de OR à surprises).
-- * Une policy RESTRICTIVE par table : les restrictives sont combinées
--   en AND, donc la frontière tenant tient même si une policy permissive
--   bâclée est ajoutée plus tard.
-- * Les tables enfants sans `tenantId` héritent de l'isolation de leur
--   parent via EXISTS — le parent étant sous RLS FORCE, c'est transitif.
--
-- REJOUABLE À CHAQUE DÉPLOIEMENT
-- ------------------------------
-- Idempotent : purge puis recrée. Les tables sont découvertes par
-- introspection du catalogue, donc toute nouvelle table portant
-- `tenantId` est protégée automatiquement, sans toucher à ce fichier.
-- Une nouvelle table SANS `tenantId` doit être déclarée dans
-- `rls_child_map` (section 2) ou dans `rls_exemptions` (section 0) —
-- à défaut, `verify_rls.sql` fait échouer le déploiement.
-- ============================================================

\set ON_ERROR_STOP on

-- Toute la migration est une seule transaction : les policies ne sont
-- jamais absentes pour une requête concurrente (les DDL prennent un
-- ACCESS EXCLUSIVE, les lecteurs attendent le COMMIT).
--
-- lock_timeout : sans lui, une requête longue tenant un verrou ferait
-- attendre cette transaction — qui détient déjà les verrous exclusifs des
-- tables précédentes — et gèlerait progressivement toute la base. Avec
-- lock_timeout, la migration échoue proprement, la transaction est
-- annulée, les policies en place restent intactes et le déploiement
-- s'interrompt sans toucher à la production.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

-- ------------------------------------------------------------
-- 0. EXEMPTIONS — source de vérité unique
-- ------------------------------------------------------------
-- Ces tables restent hors RLS. Elles sont lues AVANT qu'un contexte
-- tenant existe (login, résolution d'appartenance, bascule de tenant) :
-- une policy tenant y serait soit contournée, soit bloquerait
-- l'authentification. Elles passent par `prismaBase` (rôle owner) et
-- sont filtrées applicativement.
--
-- Cette table est la référence pour la migration ET pour verify_rls.sql
-- (plus de liste dupliquée à trois endroits). Le script
-- `npm run rls:check` vérifie qu'elle correspond exactement à
-- EXEMPT_MODELS dans src/lib/prisma-rls.ts : un écart entre les deux
-- signifie une table protégée en base dont le code ne pose jamais le
-- contexte — donc 0 ligne renvoyée, silencieusement.
CREATE TABLE IF NOT EXISTS public.rls_exemptions (
  table_name text PRIMARY KEY,
  reason     text NOT NULL
);
COMMENT ON TABLE public.rls_exemptions IS
  'Tables volontairement hors RLS. Écrite par migration_rls_secure.sql, '
  'lue par verify_rls.sql et scripts/check-rls-exemptions.ts.';

DELETE FROM public.rls_exemptions;
INSERT INTO public.rls_exemptions (table_name, reason) VALUES
  ('accounts',            'NextAuth : lue par l''adaptateur, hors requête tenant'),
  ('sessions',            'NextAuth : lue par l''adaptateur, hors requête tenant'),
  ('verification_tokens', 'NextAuth : lue par l''adaptateur, hors requête tenant'),
  ('tenants',             'Registre des tenants : lu par slug avant toute session'),
  ('user_tenants',        'Résolution d''appartenance au login : cross-tenant par nature'),
  ('user_sites',          'Bascule de site : interroge d''autres périmètres que le courant'),
  ('rls_exemptions',      'Métadonnée RLS, sans donnée tenant'),
  ('_prisma_migrations',  'Journal Prisma, sans donnée tenant');

GRANT SELECT ON public.rls_exemptions TO ecolemiriam_app;

-- ------------------------------------------------------------
-- 1. FONCTIONS DE CONTEXTE — FAIL-CLOSED
-- ------------------------------------------------------------
-- `nullif(..., '')` : l'application pose `app.site_id = ''` quand aucun
-- site n'est sélectionné ; on normalise en NULL pour que la comparaison
-- soit explicite plutôt qu'accidentellement vraie.
--
-- Pas de SECURITY DEFINER : ces fonctions ne lisent que des GUC, l'être
-- signifiait « exécutées en tant que superuser » pour rien.
-- LANGUAGE sql + STABLE + PARALLEL SAFE + LEAKPROOF : inlinables par le
-- planner (plpgsql ne l'est pas → un appel de fonction par ligne).
-- `pg_catalog.current_setting` est qualifié : aucune dépendance au
-- search_path de l'appelant.

CREATE OR REPLACE FUNCTION public.app_tenant_id() RETURNS text
  LANGUAGE sql STABLE PARALLEL SAFE LEAKPROOF
AS $$ SELECT nullif(pg_catalog.current_setting('app.tenant_id', true), '') $$;

CREATE OR REPLACE FUNCTION public.app_site_id() RETURNS text
  LANGUAGE sql STABLE PARALLEL SAFE LEAKPROOF
AS $$ SELECT nullif(pg_catalog.current_setting('app.site_id', true), '') $$;

CREATE OR REPLACE FUNCTION public.app_is_super_admin() RETURNS boolean
  LANGUAGE sql STABLE PARALLEL SAFE LEAKPROOF
AS $$ SELECT pg_catalog.current_setting('app.is_super_admin', true) = 'true' $$;

COMMENT ON FUNCTION public.app_tenant_id() IS
  'Tenant du contexte RLS courant, NULL si absent (fail-closed).';
COMMENT ON FUNCTION public.app_site_id() IS
  'Site du contexte RLS courant, NULL si absent = tous les sites du tenant.';
COMMENT ON FUNCTION public.app_is_super_admin() IS
  'Bypass RLS applicatif. Posé uniquement par prisma-rls.ts pour SUPER_ADMIN.';

-- ------------------------------------------------------------
-- 2. TABLES ENFANTS (pas de colonne tenantId)
-- ------------------------------------------------------------
-- Toute nouvelle table métier sans `tenantId` doit être ajoutée ici,
-- sinon elle restera sans RLS et verify_rls.sql bloquera le déploiement.
CREATE TEMP TABLE rls_child_map(child text, parent text, fk text) ON COMMIT DROP;
INSERT INTO rls_child_map VALUES
  ('paiements',                 'factures',          'factureId'),
  ('bulletins_paie',            'fiches_rh',         'ficheRHId'),
  ('messages',                  'conversations',     'conversationId'),
  ('conversation_participants', 'conversations',     'conversationId'),
  ('eleve_parents',             'eleves',            'eleveId'),
  ('sanctions',                 'incidents',         'incidentId'),
  ('periodes',                  'annees_scolaires',  'anneeId'),
  ('contenus_cours',            'cours',             'coursId'),
  ('progressions_eleves',       'cours',             'coursId'),
  ('fourniture_items',          'fourniture_listes', 'listeId'),
  ('sessions_examen',           'examens',           'examId'),
  ('enseignant_sites',          'enseignants',       'enseignantId');
-- `user_sites` est volontairement absent : le modèle UserSite est exempté
-- côté application (bascule de site avant contexte), donc aucune requête
-- ne poserait de contexte et la table renverrait 0 ligne.

-- ------------------------------------------------------------
-- 3. RECONSTRUCTION DES POLICIES
-- ------------------------------------------------------------
DO $mig$
DECLARE
  r       record;
  pol     record;
  expr    text;
  guard   text;
  tbl     text;
  exempts text[];
BEGIN
  -- Matérialisé en tableau plutôt que relu par sous-requête : un curseur
  -- ouvert sur `rls_exemptions` interdirait d'ALTER cette même table en 3c
  -- (« cannot ALTER TABLE because it is being used by active queries »).
  SELECT coalesce(array_agg(table_name ORDER BY table_name), '{}')
    INTO exempts FROM public.rls_exemptions;

  -- 3a. Tables portant directement `tenantId` (découvertes par
  --     introspection : une nouvelle table est protégée sans édition)
  FOR r IN
    SELECT c.oid, c.relname AS tbl,
           EXISTS (SELECT 1 FROM pg_attribute a
                   WHERE a.attrelid = c.oid AND a.attname = 'siteId'
                     AND a.attnum > 0 AND NOT a.attisdropped) AS has_site
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND EXISTS (SELECT 1 FROM pg_attribute a
                  WHERE a.attrelid = c.oid AND a.attname = 'tenantId'
                    AND a.attnum > 0 AND NOT a.attisdropped)
      AND NOT (c.relname = ANY (exempts))
    ORDER BY c.relname
  LOOP
    FOR pol IN SELECT policyname FROM pg_policies
               WHERE schemaname = 'public' AND tablename = r.tbl
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', pol.policyname, r.tbl);
    END LOOP;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tbl);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', r.tbl);

    -- Site NULL côté contexte = utilisateur non restreint à un site
    --                           → tous les sites de SON tenant.
    -- Site NULL côté ligne    = donnée transversale au tenant.
    expr := format(
      '(public.app_is_super_admin() OR ("tenantId" = public.app_tenant_id()%s))',
      CASE WHEN r.has_site THEN
        ' AND (public.app_site_id() IS NULL'
        || ' OR "siteId" IS NULL'
        || ' OR "siteId" = public.app_site_id())'
      ELSE '' END);

    EXECUTE format(
      'CREATE POLICY rls_access ON public.%I AS PERMISSIVE FOR ALL TO public'
      ' USING %s WITH CHECK %s', r.tbl, expr, expr);

    -- Filet : combiné en AND avec toute policy permissive future.
    guard := '(public.app_is_super_admin() OR "tenantId" = public.app_tenant_id())';
    EXECUTE format(
      'CREATE POLICY rls_tenant_guard ON public.%I AS RESTRICTIVE FOR ALL TO public'
      ' USING %s WITH CHECK %s', r.tbl, guard, guard);
  END LOOP;

  -- 3b. Tables enfants : isolation héritée du parent (lui-même sous RLS)
  FOR r IN SELECT * FROM rls_child_map ORDER BY child LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                   WHERE n.nspname = 'public' AND c.relname = r.child AND c.relkind = 'r') THEN
      RAISE WARNING 'RLS: table enfant % absente, ignorée', r.child;
      CONTINUE;
    END IF;

    FOR pol IN SELECT policyname FROM pg_policies
               WHERE schemaname = 'public' AND tablename = r.child
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', pol.policyname, r.child);
    END LOOP;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.child);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', r.child);

    expr := format(
      '(public.app_is_super_admin() OR EXISTS (SELECT 1 FROM public.%I p WHERE p.id = %I.%I))',
      r.parent, r.child, r.fk);

    EXECUTE format(
      'CREATE POLICY rls_access ON public.%I AS PERMISSIVE FOR ALL TO public'
      ' USING %s WITH CHECK %s', r.child, expr, expr);
    EXECUTE format(
      'CREATE POLICY rls_tenant_guard ON public.%I AS RESTRICTIVE FOR ALL TO public'
      ' USING %s WITH CHECK %s', r.child, expr, expr);
  END LOOP;

  -- 3c. Tables exemptées : RLS explicitement désactivée
  --     `user_tenants` portait une policy tenant alors que le modèle est
  --     exempté côté application : aucune requête ne posait de contexte.
  --     Tant que RLS était fail-open personne ne l'a vu ; en fail-closed
  --     la table aurait renvoyé 0 ligne et cassé le login. On rend l'état
  --     explicite plutôt que de garder une protection qui ne protège rien.
  FOREACH tbl IN ARRAY exempts LOOP
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'public' AND c.relname = tbl AND c.relkind = 'r') THEN
      FOR pol IN SELECT policyname FROM pg_policies
                 WHERE schemaname = 'public' AND tablename = tbl
      LOOP
        EXECUTE format('DROP POLICY %I ON public.%I', pol.policyname, tbl);
      END LOOP;
      EXECUTE format('ALTER TABLE public.%I NO FORCE ROW LEVEL SECURITY', tbl);
      EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', tbl);
    END IF;
  END LOOP;

  -- 3d. USERS : isolation tenant SANS filtrage par site
  --     La boucle 3a a créé rls_access + rls_tenant_guard sur users avec un
  --     filtre par siteId (users porte la colonne siteId). Or le siteId de
  --     users n'est qu'une préférence de site par défaut, pas un périmètre de
  --     sécurité. Les vrais rattachements sont dans user_sites / enseignant_sites.
  --     Le filtrage par site cassait les jointures enseignant → user quand
  --     l'enseignant et son user n'étaient pas sur le même site (crash Prisma
  --     "Field user is required to return data, got null instead").
  --     On remplace donc les policies automatiques par deux policies tenant-only
  --     (1 permissive + 1 restrictive, conformes à verify_rls.sql),
  --     identiques à celles de enseignants mais sans filtre par site.
  FOR pol IN SELECT policyname FROM pg_policies
             WHERE schemaname = 'public' AND tablename = 'users'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.users', pol.policyname);
  END LOOP;
  EXECUTE 'ALTER TABLE public.users ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE public.users FORCE ROW LEVEL SECURITY';
  -- Policy permissive : USING + WITH CHECK tenant-only (sans filtre site)
  EXECUTE 'CREATE POLICY rls_access ON public.users AS PERMISSIVE FOR ALL TO public
             USING (public.app_is_super_admin() OR "tenantId" = public.app_tenant_id())
             WITH CHECK (public.app_is_super_admin() OR "tenantId" = public.app_tenant_id())';
  -- Policy restrictive : filet de sécurité combiné en AND avec toute policy
  -- permissive future. Garantit que seules les lignes du tenant courant sont
  -- visibles/modifiables, même si une policy permissive plus laxiste est ajoutée.
  EXECUTE 'CREATE POLICY rls_tenant_guard ON public.users AS RESTRICTIVE FOR ALL TO public
             USING (public.app_is_super_admin() OR "tenantId" = public.app_tenant_id())
             WITH CHECK (public.app_is_super_admin() OR "tenantId" = public.app_tenant_id())';
END
$mig$;

-- ------------------------------------------------------------
-- 4. SUPPRESSION DES PRIMITIVES FAIL-OPEN
-- ------------------------------------------------------------
-- `is_site_admin()` renvoyait TRUE sans contexte : c'est la fonction qui
-- a ouvert la brèche. Elle est supprimée pour qu'aucune migration ni
-- policy future ne puisse la réutiliser par inadvertance.
DROP FUNCTION IF EXISTS public.site_matches(text);
DROP FUNCTION IF EXISTS public.is_site_admin();

-- Conservées en alias fail-closed : d'anciens scripts peuvent les appeler.
CREATE OR REPLACE FUNCTION public.current_tenant_id() RETURNS text
  LANGUAGE sql STABLE PARALLEL SAFE LEAKPROOF
AS $$ SELECT public.app_tenant_id() $$;

CREATE OR REPLACE FUNCTION public.current_site_id() RETURNS text
  LANGUAGE sql STABLE PARALLEL SAFE LEAKPROOF
AS $$ SELECT public.app_site_id() $$;

CREATE OR REPLACE FUNCTION public.is_super_admin() RETURNS boolean
  LANGUAGE sql STABLE PARALLEL SAFE LEAKPROOF
AS $$ SELECT public.app_is_super_admin() $$;

-- ------------------------------------------------------------
-- 5. PRIVILÈGES DU RÔLE APPLICATIF
-- ------------------------------------------------------------
-- TRUNCATE **ne passe pas par RLS** : le privilège permettait à l'app de
-- vider n'importe quelle table sans le moindre filtrage tenant.
-- REFERENCES / TRIGGER ne servent pas à une application cliente.
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM ecolemiriam_app;

-- Les tables créées par les futures migrations Prisma (exécutées en tant
-- qu'owner via DIRECT_URL) héritent des mêmes privilèges restreints —
-- sans quoi l'application obtiendrait « permission denied » sur toute
-- nouvelle table.
ALTER DEFAULT PRIVILEGES FOR ROLE ecolemiriam_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ecolemiriam_app;

REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO ecolemiriam_app;

COMMIT;

\echo ''
\echo '=== Policies appliquées. La preuve se fait avec verify_rls.sql ==='
\echo '=== (le rôle owner porte BYPASSRLS : compter les policies ne prouve rien) ==='
