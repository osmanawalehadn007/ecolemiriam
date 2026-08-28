-- ============================================================
-- MIGRATION : la classe est identifiée par (tenant, site, année, nom)
-- ============================================================
--
-- Contexte
-- --------
-- Une classe n'a de sens que dans un site ET une année scolaire. La table
-- `classes` ne portait aucune contrainte : un même nom pouvait exister
-- plusieurs fois sur le même site et la même année (« 1ère SG » en double sur
-- l'Annexe Warabaleh), et rien n'empêchait une classe sans site — visible
-- depuis TOUS les sites, la policy RLS laissant toujours passer
-- `"siteId" IS NULL`.
--
-- Cette migration rend la structure de données porteuse de la règle, au lieu
-- de la laisser à la charge de chaque `where` applicatif.
--
-- Application :
--   psql "$DIRECT_URL" -f migration_classe_unicite_site_annee.sql
-- (tunnel VPS actif : ./scripts/start-vps-tunnel.sh)
-- ============================================================

BEGIN;

-- ── 1. Supprimer les doublons SANS aucune dépendance ────────────────────────
--    Un doublon vide est un accident de saisie : on garde le plus ancien.
--    Un doublon qui porte des élèves/notes/emplois du temps n'est PAS touché
--    automatiquement — l'étape 2 fera échouer la migration et il faudra
--    trancher manuellement (fusion ou renommage).
WITH classes_rangees AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY "tenantId", "siteId", annee, nom
      ORDER BY id
    ) AS rang
  FROM public.classes
),
doublons_vides AS (
  SELECT c.id
  FROM classes_rangees cr
  JOIN public.classes c ON c.id = cr.id
  WHERE cr.rang > 1
    AND NOT EXISTS (SELECT 1 FROM public.eleves        e WHERE e."classeId" = c.id)
    AND NOT EXISTS (SELECT 1 FROM public.notes         n WHERE n."classeId" = c.id)
    AND NOT EXISTS (SELECT 1 FROM public.emplois_temps t WHERE t."classeId" = c.id)
    AND NOT EXISTS (SELECT 1 FROM public.evaluations   v WHERE v."classeId" = c.id)
)
DELETE FROM public.classes WHERE id IN (SELECT id FROM doublons_vides);

-- ── 2. Refuser d'aller plus loin s'il reste des doublons porteurs de données ─
DO $$
DECLARE restants int;
BEGIN
  SELECT count(*) INTO restants FROM (
    SELECT 1 FROM public.classes
    GROUP BY "tenantId", "siteId", annee, nom
    HAVING count(*) > 1
  ) d;

  IF restants > 0 THEN
    RAISE EXCEPTION
      'Il reste % groupe(s) de classes en double portant des données. '
      'Fusionnez-les manuellement (npx tsx scripts/audit-coherence-site-annee.ts) '
      'avant de rejouer cette migration.', restants;
  END IF;
END $$;

-- ── 3. Unicité : une classe par (tenant, site, année, nom) ──────────────────
--    NULLS NOT DISTINCT : deux classes sans site portant le même nom et la
--    même année sont également refusées (Postgres 15+).
CREATE UNIQUE INDEX IF NOT EXISTS classes_tenant_site_annee_nom_key
  ON public.classes ("tenantId", "siteId", annee, nom) NULLS NOT DISTINCT;

-- ── 4. Index de lecture : tout sélecteur de classe filtre (site, année) ─────
CREATE INDEX IF NOT EXISTS idx_classes_site_annee
  ON public.classes ("siteId", annee);

-- ── 5. Interdire la création d'une classe SANS site dans un établissement
--       qui possède des sites. Un CHECK ne peut pas contenir de sous-requête :
--       on passe par un trigger. Les lignes existantes ne sont pas touchées,
--       seules les écritures futures sont contraintes.
CREATE OR REPLACE FUNCTION public.classes_site_requis()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."siteId" IS NULL
     AND EXISTS (SELECT 1 FROM public.sites s WHERE s."tenantId" = NEW."tenantId")
  THEN
    RAISE EXCEPTION
      'Classe sans site interdite : cet établissement possède des sites. '
      'Sélectionnez un site avant de créer la classe « % ».', NEW.nom;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_classes_site_requis ON public.classes;
CREATE TRIGGER trg_classes_site_requis
  BEFORE INSERT OR UPDATE OF "siteId" ON public.classes
  FOR EACH ROW EXECUTE FUNCTION public.classes_site_requis();

COMMIT;
