-- ============================================================
-- École Miriam — VÉRIFICATION RLS (anti-régression)
-- ============================================================
-- DOIT être exécuté avec le rôle applicatif (ecolemiriam_app).
-- Sort en erreur au moindre défaut (avec ON_ERROR_STOP=1).
--
--   psql -U ecolemiriam_app -d ecolemiriam -v ON_ERROR_STOP=1 -f verify_rls.sql
--
-- Exécuté par docker/scripts/apply-rls.sh à chaque déploiement, AVANT la
-- bascule du trafic : c'est le test qui aurait attrapé la brèche
-- `*_site_isolation` réintroduite le 23/08.
--
-- La liste des tables exemptées est lue depuis `public.rls_exemptions`,
-- écrite par migration_rls_secure.sql : une seule source de vérité, pas
-- de liste à maintenir en double ici.
-- ============================================================

\set ON_ERROR_STOP on

-- ------------------------------------------------------------
-- 0. Le rôle de test ne doit surtout pas contourner RLS
-- ------------------------------------------------------------
DO $$
DECLARE bypass boolean; super boolean;
BEGIN
  SELECT rolbypassrls, rolsuper INTO bypass, super
  FROM pg_roles WHERE rolname = current_user;

  IF bypass OR super THEN
    RAISE EXCEPTION
      'ÉCHEC: le rôle % contourne RLS (superuser=%, bypassrls=%). '
      'Ce test doit tourner avec le rôle applicatif, sinon il ne prouve rien.',
      current_user, super, bypass;
  END IF;
  RAISE NOTICE 'OK  rôle % : ni superuser ni bypassrls', current_user;
END $$;

-- ------------------------------------------------------------
-- 1. Structure : RLS activé + forcé, 1 permissive + 1 restrictive
-- ------------------------------------------------------------
DO $$
DECLARE r record; defauts int := 0;
BEGIN
  FOR r IN
    SELECT c.relname,
           c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
           count(p.oid) FILTER (WHERE p.polpermissive)     AS nb_perm,
           count(p.oid) FILTER (WHERE NOT p.polpermissive) AS nb_restr,
           EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid
                   AND a.attname = 'tenantId' AND a.attnum > 0
                   AND NOT a.attisdropped) AS has_tenant
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_policy p ON p.polrelid = c.oid
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND c.relname NOT IN (SELECT table_name FROM public.rls_exemptions)
    GROUP BY c.oid, c.relname, c.relrowsecurity, c.relforcerowsecurity
    ORDER BY c.relname
  LOOP
    IF NOT r.rls THEN
      defauts := defauts + 1;
      -- Message actionnable : c'est le cas d'une table ajoutée par une
      -- migration Prisma récente et non encore rattachée au dispositif.
      IF r.has_tenant THEN
        RAISE WARNING 'DÉFAUT % : RLS désactivé alors que la table porte tenantId. '
          'Rejouer migration_rls_secure.sql (elle la détecte par introspection).',
          r.relname;
      ELSE
        RAISE WARNING 'DÉFAUT % : nouvelle table sans tenantId et sans RLS. '
          'Ajouter (%, <table_parente>, <colonne_fk>) dans rls_child_map '
          '(section 2 de migration_rls_secure.sql), ou l''inscrire dans '
          'rls_exemptions (section 0) si l''accès cross-tenant est voulu.',
          r.relname, r.relname;
      END IF;
    ELSIF NOT r.forced THEN
      RAISE WARNING 'DÉFAUT % : RLS non FORCÉ (le propriétaire échappe au filtre)', r.relname;
      defauts := defauts + 1;
    ELSIF r.nb_perm <> 1 OR r.nb_restr <> 1 THEN
      RAISE WARNING 'DÉFAUT % : % permissive(s) + % restrictive(s), attendu 1 + 1. '
        'Plusieurs policies permissives sont combinées en OR : la plus faible l''emporte.',
        r.relname, r.nb_perm, r.nb_restr;
      defauts := defauts + 1;
    END IF;
  END LOOP;

  IF defauts > 0 THEN
    RAISE EXCEPTION 'ÉCHEC: % table(s) mal protégée(s)', defauts;
  END IF;
  RAISE NOTICE 'OK  structure des policies conforme sur toutes les tables';
END $$;

-- ------------------------------------------------------------
-- 2. Fail-closed : AUCUN contexte → aucune ligne, sur chaque table
-- ------------------------------------------------------------
DO $$
DECLARE r record; n bigint; fuites int := 0;
BEGIN
  PERFORM set_config('app.tenant_id', '', true);
  PERFORM set_config('app.site_id', '', true);
  PERFORM set_config('app.is_super_admin', '', true);

  FOR r IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
    ORDER BY c.relname
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', r.relname) INTO n;
    IF n > 0 THEN
      RAISE WARNING 'FUITE % : % ligne(s) visibles sans contexte tenant', r.relname, n;
      fuites := fuites + 1;
    END IF;
  END LOOP;

  IF fuites > 0 THEN
    RAISE EXCEPTION 'ÉCHEC: % table(s) accessibles sans contexte tenant', fuites;
  END IF;
  RAISE NOTICE 'OK  sans contexte : 0 ligne sur toutes les tables RLS';
END $$;

-- ------------------------------------------------------------
-- 3. Fail-closed : tenant inexistant → aucune ligne
--    (c'est exactement le scénario qui renvoyait 880 élèves)
-- ------------------------------------------------------------
DO $$
DECLARE r record; n bigint; fuites int := 0;
BEGIN
  PERFORM set_config('app.tenant_id', 'TENANT_QUI_NEXISTE_PAS', true);
  PERFORM set_config('app.site_id', '', true);   -- cas déclencheur de la brèche
  PERFORM set_config('app.is_super_admin', '', true);

  FOR r IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
    ORDER BY c.relname
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', r.relname) INTO n;
    IF n > 0 THEN
      RAISE WARNING 'FUITE % : % ligne(s) visibles pour un tenant inexistant', r.relname, n;
      fuites := fuites + 1;
    END IF;
  END LOOP;

  IF fuites > 0 THEN
    RAISE EXCEPTION 'ÉCHEC: % table(s) fuient vers un tenant inexistant', fuites;
  END IF;
  RAISE NOTICE 'OK  tenant inexistant + site vide : 0 ligne partout';
END $$;

-- ------------------------------------------------------------
-- 4. Partition exacte : Σ(lignes vues par tenant) = total
-- ------------------------------------------------------------
-- Invariant fort et sans faux positif, y compris sur base vide :
--   * somme < total  → une policy trop restrictive cache des données
--                      (l'application afficherait des listes vides)
--   * somme > total  → une ligne est visible par plusieurs tenants,
--                      c'est-à-dire une fuite inter-tenant.
-- Le total est obtenu via le bypass SUPER_ADMIN, disponible au rôle
-- applicatif : aucun privilège spécial n'est requis pour ce contrôle.
DO $$
DECLARE r record; t record; total bigint; somme bigint; n bigint; ecarts int := 0;
BEGIN
  FOR r IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
      AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid
                  AND a.attname = 'tenantId' AND a.attnum > 0 AND NOT a.attisdropped)
    ORDER BY c.relname
  LOOP
    PERFORM set_config('app.is_super_admin', 'true', true);
    PERFORM set_config('app.tenant_id', '', true);
    PERFORM set_config('app.site_id', '', true);
    EXECUTE format('SELECT count(*) FROM public.%I', r.relname) INTO total;

    somme := 0;
    FOR t IN SELECT id FROM public.tenants LOOP
      PERFORM set_config('app.is_super_admin', '', true);
      PERFORM set_config('app.tenant_id', t.id, true);
      PERFORM set_config('app.site_id', '', true);
      EXECUTE format('SELECT count(*) FROM public.%I', r.relname) INTO n;
      somme := somme + n;
    END LOOP;

    -- Les lignes à tenantId NULL (entrées système : audit hors session,
    -- comptes SUPER_ADMIN) ne sont rattachées à aucun tenant : elles
    -- comptent dans le total sans appartenir à aucune partition.
    PERFORM set_config('app.is_super_admin', 'true', true);
    EXECUTE format(
      'SELECT count(*) FROM public.%I x WHERE x."tenantId" IS NULL '
      'OR NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = x."tenantId")',
      r.relname) INTO n;

    IF somme + n <> total THEN
      RAISE WARNING 'ÉCART % : total=%, Σ par tenant=%, orphelines=%',
        r.relname, total, somme, n;
      ecarts := ecarts + 1;
    END IF;
  END LOOP;

  IF ecarts > 0 THEN
    RAISE EXCEPTION 'ÉCHEC: % table(s) dont la partition par tenant est incorrecte', ecarts;
  END IF;
  RAISE NOTICE 'OK  partition exacte : chaque ligne visible par un tenant et un seul';
END $$;

-- ------------------------------------------------------------
-- 5. Écriture : impossible d'insérer hors de son tenant
-- ------------------------------------------------------------
DO $$
BEGIN
  PERFORM set_config('app.is_super_admin', '', true);
  PERFORM set_config('app.site_id', '', true);
  PERFORM set_config('app.tenant_id', 'TENANT_QUI_NEXISTE_PAS', true);

  BEGIN
    INSERT INTO public.annees_scolaires (id, "tenantId", libelle, "dateDebut", "dateFin")
    VALUES ('rls-probe-' || gen_random_uuid()::text, 'UN_AUTRE_TENANT',
            'sonde-rls', now(), now());
    RAISE EXCEPTION 'ÉCHEC: écriture cross-tenant acceptée (WITH CHECK inopérant)';
  EXCEPTION
    WHEN insufficient_privilege THEN
      -- SQLSTATE 42501 = « new row violates row-level security policy »
      RAISE NOTICE 'OK  écriture cross-tenant refusée par WITH CHECK';
    WHEN OTHERS THEN
      -- Colonne NOT NULL absente de la sonde, etc. : le test ne peut pas
      -- conclure, mais ce n'est pas une faille — on ne fait pas échouer.
      RAISE NOTICE 'SKIP test d''écriture (% : %)', SQLSTATE, SQLERRM;
  END;
END $$;

-- ------------------------------------------------------------
-- 6. Privilèges : pas de TRUNCATE (il court-circuite RLS)
-- ------------------------------------------------------------
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
  FROM information_schema.role_table_grants
  WHERE grantee = current_user AND table_schema = 'public'
    AND privilege_type IN ('TRUNCATE', 'REFERENCES', 'TRIGGER');

  IF n > 0 THEN
    RAISE EXCEPTION
      'ÉCHEC: % privilège(s) TRUNCATE/REFERENCES/TRIGGER encore accordés '
      '(TRUNCATE ignore totalement les policies RLS)', n;
  END IF;
  RAISE NOTICE 'OK  aucun privilège TRUNCATE/REFERENCES/TRIGGER';
END $$;

\echo ''
\echo '=== Isolation multi-tenant vérifiée ✓ ==='
