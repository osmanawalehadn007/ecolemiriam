-- ============================================================
-- Habilitations sur une dépense : qui AUTORISE, qui PAIE
-- ============================================================
-- Règle métier :
--   * autorisation → responsable d'établissement (« Directeur », TENANT_ADMIN)
--                    et chef d'établissement (PRINCIPAL) ;
--   * paiement     → comptable / caissier (ACCOUNTANT). Il n'existe pas de rôle
--                    `CAISSIER` dans l'énumération `Role` : dans cette
--                    application, le caissier EST le comptable — c'est le seul
--                    rôle qui porte `finance:*` en dehors de la direction.
--
-- À NE PAS CONFONDRE — deux niveaux distincts :
--
--   1. LES LISTES DÉROULANTES de l'écran Finances → onglet Dépenses
--      (« Autorisé par », « Payé par ») sont construites par le CODE, pas par
--      une table de paramétrage : src/components/finances/DepensesSection.tsx
--      appelle `getUsersForTenant()` puis filtre avec le référentiel partagé
--      `src/lib/depense-habilitations.ts`. AUCUN SQL ne peut filtrer un menu :
--      les deux règles y sont également appliquées côté serveur par
--      `createDepense` (finance.ts).
--
--   2. CE SCRIPT pose les mêmes règles EN BASE (défense en profondeur) : toute
--      écriture qui désignerait une personne d'un autre rôle est rejetée, y
--      compris depuis un client SQL direct, un import ou une future API.
--
-- Les deux colonnes sont facultatives : NULL reste autorisé.
--
-- Idempotent : rejouable sans effet de bord.
-- Application : psql "$DIRECT_URL" -f prisma/migration_habilitations_depenses.sql
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. AUTORISATEUR de dépense
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verifier_autoriseur_depense()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  role_autoriseur "Role";
BEGIN
  IF NEW."autoriseParId" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT u.role INTO role_autoriseur
  FROM public.users u
  WHERE u.id = NEW."autoriseParId";

  IF role_autoriseur IS NULL THEN
    RAISE EXCEPTION
      'Autorisateur de dépense introuvable (users.id = %)', NEW."autoriseParId";
  END IF;

  -- Pour ajouter l'équipe plateforme : NOT IN ('TENANT_ADMIN','PRINCIPAL','SUPER_ADMIN')
  IF role_autoriseur NOT IN ('TENANT_ADMIN', 'PRINCIPAL') THEN
    RAISE EXCEPTION
      'Autorisateur de dépense non habilité : rôle « % » (attendu : TENANT_ADMIN ou PRINCIPAL)',
      role_autoriseur;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS verifier_autoriseur_depense ON public.depenses;
CREATE TRIGGER verifier_autoriseur_depense
  BEFORE INSERT OR UPDATE OF "autoriseParId" ON public.depenses
  FOR EACH ROW
  EXECUTE FUNCTION public.verifier_autoriseur_depense();

-- ------------------------------------------------------------
-- 2. PAYEUR de dépense
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verifier_payeur_depense()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  role_payeur "Role";
BEGIN
  IF NEW."payeParId" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT u.role INTO role_payeur
  FROM public.users u
  WHERE u.id = NEW."payeParId";

  IF role_payeur IS NULL THEN
    RAISE EXCEPTION
      'Payeur de dépense introuvable (users.id = %)', NEW."payeParId";
  END IF;

  -- Pour autoriser la direction à payer aussi : NOT IN ('ACCOUNTANT','TENANT_ADMIN')
  IF role_payeur NOT IN ('ACCOUNTANT') THEN
    RAISE EXCEPTION
      'Payeur de dépense non habilité : rôle « % » (attendu : ACCOUNTANT — comptable/caissier)',
      role_payeur;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS verifier_payeur_depense ON public.depenses;
CREATE TRIGGER verifier_payeur_depense
  BEFORE INSERT OR UPDATE OF "payeParId" ON public.depenses
  FOR EACH ROW
  EXECUTE FUNCTION public.verifier_payeur_depense();

COMMIT;

-- ------------------------------------------------------------
-- Contrôles de mise en place (lecture seule)
-- ------------------------------------------------------------
-- a) Les deux triggers sont posés :
--    SELECT tgname, tgenabled FROM pg_trigger
--    WHERE tgrelid = 'public.depenses'::regclass AND NOT tgisinternal;
--
-- b) Dépenses existantes désignant une personne non habilitée (à corriger) :
--    SELECT d.id, d.categorie, d.montant, u.name, u.role,
--           CASE WHEN d."autoriseParId" = u.id THEN 'autorisation' ELSE 'paiement' END AS colonne
--    FROM public.depenses d
--    JOIN public.users u ON u.id IN (d."autoriseParId", d."payeParId")
--    WHERE (u.id = d."autoriseParId" AND u.role NOT IN ('TENANT_ADMIN','PRINCIPAL'))
--       OR (u.id = d."payeParId"     AND u.role NOT IN ('ACCOUNTANT'));
--
-- c) Les personnes qui DOIVENT apparaître dans les listes déroulantes
--    (hors comptes désactivés, hors SUPER_ADMIN) :
--    SELECT u.id, u.name, u.role FROM public.users u
--    WHERE u."tenantId" = '<tenantId>'
--      AND u."isActive" = true
--      AND u.role IN ('TENANT_ADMIN','PRINCIPAL','ACCOUNTANT')
--    ORDER BY u.name;
