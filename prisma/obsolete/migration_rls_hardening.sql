-- ============================================================
-- École Miriam — Durcissement RLS (Row Level Security)
-- ============================================================
-- Objectif : rendre l'isolation multi-tenant et multi-site
-- effective au niveau base de données, en complément du filtrage
-- applicatif (site-scope.ts).
--
-- À exécuter dans : Supabase Dashboard → SQL Editor
-- Idempotent : peut être ré-exécuté sans erreur.
--
-- PRÉREQUIS : l'app utilise actuellement le rôle `postgres`
-- (propriétaire + BYPASSRLS). Cette migration prépare le terrain
-- pour un rôle applicatif restreint. Le basculement se fait en
-- changeant DATABASE_URL → rôle `ecolemiriam_app`.
-- ============================================================

-- ============================================================
-- 1. RÔLE APPLICATIF (NOBYPASSRLS)
-- ============================================================
-- Ce rôle sera utilisé par l'application (DATABASE_URL).
-- Il ne peut PAS contourner la RLS et n'est PAS propriétaire
-- des tables → les policies s'appliquent obligatoirement.

DO $$ BEGIN
  CREATE ROLE ecolemiriam_app
    WITH LOGIN
    NOBYASSRLS
    NOSUPERUSER
    NOCREATEDB
    NOCREATEROLE
    PASSWORD 'CHANGE_ME_IN_PRODUCTION';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 2. FONCTIONS DE CONTEXTE (corrigées)
-- ============================================================
-- Les fonctions existantes sont SECURITY DEFINER, ce qui est
-- correct : elles doivent pouvoir appeler set_config quel que
-- soit le rôle appelant. On les recrée pour garantir la cohérence.

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

CREATE OR REPLACE FUNCTION public.is_site_admin()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  -- TENANT_ADMIN / SUPER_ADMIN : pas de site sélectionné → voit tous les sites
  RETURN current_site_id() IS NULL OR current_site_id() = '';
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_tenant_context(p_tenant_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  PERFORM set_config('app.tenant_id', p_tenant_id, true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_site_context(p_site_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  PERFORM set_config('app.site_id', COALESCE(p_site_id, ''), true);
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
-- 3. POLITIQUES RLS — PRINCIPES
-- ============================================================
-- Chaque table porte une politique par type d'isolation :
--
--   *_tenant_isolation : USING + WITH CHECK sur tenantId
--   *_site_isolation   : USING + WITH CHECK sur siteId (complément)
--
-- Le WITH CHECK empêche l'INSERT/UPDATE d'un tenantId ou siteId
-- étranger (les policies existantes n'avaient que USING → faille).
--
-- Tables sans tenantId direct : filtrage indirect via sous-requête
-- sur la table parente (ex. paiements → factures.tenantId).
--
-- Tables d'auth (accounts, sessions, verification_tokens) :
-- PAS de RLS — l'authentification précède le contexte tenant.
-- ============================================================

-- ============================================================
-- 3a. TABLES AVEC tenantId DIRECT + siteId DIRECT
-- ============================================================

-- eleves
ALTER TABLE public.eleves ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS eleves_tenant_isolation ON public.eleves;
DROP POLICY IF EXISTS eleves_site_isolation ON public.eleves;
CREATE POLICY eleves_tenant_isolation ON public.eleves
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());
CREATE POLICY eleves_site_isolation ON public.eleves
  USING (is_site_admin() OR site_matches("siteId"))
  WITH CHECK (is_site_admin() OR site_matches("siteId"));

-- classes
ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS classes_tenant_isolation ON public.classes;
DROP POLICY IF EXISTS classes_site_isolation ON public.classes;
CREATE POLICY classes_tenant_isolation ON public.classes
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());
CREATE POLICY classes_site_isolation ON public.classes
  USING (is_site_admin() OR site_matches("siteId"))
  WITH CHECK (is_site_admin() OR site_matches("siteId"));

-- cours
ALTER TABLE public.cours ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cours_tenant_isolation ON public.cours;
DROP POLICY IF EXISTS cours_site_isolation ON public.cours;
CREATE POLICY cours_tenant_isolation ON public.cours
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());
CREATE POLICY cours_site_isolation ON public.cours
  USING (is_site_admin() OR site_matches("siteId"))
  WITH CHECK (is_site_admin() OR site_matches("siteId"));

-- examens
ALTER TABLE public.examens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS examens_tenant_isolation ON public.examens;
DROP POLICY IF EXISTS examens_site_isolation ON public.examens;
CREATE POLICY examens_tenant_isolation ON public.examens
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());
CREATE POLICY examens_site_isolation ON public.examens
  USING (is_site_admin() OR site_matches("siteId"))
  WITH CHECK (is_site_admin() OR site_matches("siteId"));

-- factures
ALTER TABLE public.factures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS factures_tenant_isolation ON public.factures;
DROP POLICY IF EXISTS factures_site_isolation ON public.factures;
CREATE POLICY factures_tenant_isolation ON public.factures
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());
CREATE POLICY factures_site_isolation ON public.factures
  USING (is_site_admin() OR site_matches("siteId"))
  WITH CHECK (is_site_admin() OR site_matches("siteId"));

-- evenements
ALTER TABLE public.evenements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS evenements_tenant_isolation ON public.evenements;
DROP POLICY IF EXISTS evenements_site_isolation ON public.evenements;
CREATE POLICY evenements_tenant_isolation ON public.evenements
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());
CREATE POLICY evenements_site_isolation ON public.evenements
  USING (is_site_admin() OR site_matches("siteId"))
  WITH CHECK (is_site_admin() OR site_matches("siteId"));

-- notifications
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notifications_tenant_isolation ON public.notifications;
DROP POLICY IF EXISTS notifications_site_isolation ON public.notifications;
CREATE POLICY notifications_tenant_isolation ON public.notifications
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());
CREATE POLICY notifications_site_isolation ON public.notifications
  USING (is_site_admin() OR site_matches("siteId"))
  WITH CHECK (is_site_admin() OR site_matches("siteId"));

-- candidatures
ALTER TABLE public.candidatures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS candidatures_tenant_isolation ON public.candidatures;
DROP POLICY IF EXISTS candidatures_site_isolation ON public.candidatures;
CREATE POLICY candidatures_tenant_isolation ON public.candidatures
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());
CREATE POLICY candidatures_site_isolation ON public.candidatures
  USING (is_site_admin() OR site_matches("siteId"))
  WITH CHECK (is_site_admin() OR site_matches("siteId"));

-- alumni
ALTER TABLE public.alumni ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS alumni_tenant_isolation ON public.alumni;
DROP POLICY IF EXISTS alumni_site_isolation ON public.alumni;
CREATE POLICY alumni_tenant_isolation ON public.alumni
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());
CREATE POLICY alumni_site_isolation ON public.alumni
  USING (is_site_admin() OR site_matches("siteId"))
  WITH CHECK (is_site_admin() OR site_matches("siteId"));

-- inventaire
ALTER TABLE public.inventaire ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inventaire_tenant_isolation ON public.inventaire;
DROP POLICY IF EXISTS inventaire_site_isolation ON public.inventaire;
CREATE POLICY inventaire_tenant_isolation ON public.inventaire
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());
CREATE POLICY inventaire_site_isolation ON public.inventaire
  USING (is_site_admin() OR site_matches("siteId"))
  WITH CHECK (is_site_admin() OR site_matches("siteId"));

-- salles
ALTER TABLE public.salles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS salles_tenant_isolation ON public.salles;
DROP POLICY IF EXISTS salles_site_isolation ON public.salles;
CREATE POLICY salles_tenant_isolation ON public.salles
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());
CREATE POLICY salles_site_isolation ON public.salles
  USING (is_site_admin() OR site_matches("siteId"))
  WITH CHECK (is_site_admin() OR site_matches("siteId"));

-- ============================================================
-- 3b. TABLES AVEC tenantId DIRECT + siteId NULL=PARTAGÉ
-- (matieres, structures, disponibilites_enseignants, tarifs_niveau,
--  conversations, depenses, budgets, remises_caisse)
-- ============================================================

-- matieres
ALTER TABLE public.matieres ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS matieres_tenant_isolation ON public.matieres;
DROP POLICY IF EXISTS matieres_site_isolation ON public.matieres;
CREATE POLICY matieres_tenant_isolation ON public.matieres
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());
CREATE POLICY matieres_site_isolation ON public.matieres
  USING (is_site_admin() OR site_matches("siteId"))
  WITH CHECK (is_site_admin() OR site_matches("siteId"));

-- structures
ALTER TABLE public.structures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS structures_tenant_isolation ON public.structures;
DROP POLICY IF EXISTS structures_site_isolation ON public.structures;
CREATE POLICY structures_tenant_isolation ON public.structures
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());
CREATE POLICY structures_site_isolation ON public.structures
  USING (is_site_admin() OR site_matches("siteId"))
  WITH CHECK (is_site_admin() OR site_matches("siteId"));

-- disponibilites_enseignants
ALTER TABLE public.disponibilites_enseignants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS disponibilites_tenant_isolation ON public.disponibilites_enseignants;
DROP POLICY IF EXISTS disponibilites_site_isolation ON public.disponibilites_enseignants;
CREATE POLICY disponibilites_tenant_isolation ON public.disponibilites_enseignants
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());
CREATE POLICY disponibilites_site_isolation ON public.disponibilites_enseignants
  USING (is_site_admin() OR site_matches("siteId"))
  WITH CHECK (is_site_admin() OR site_matches("siteId"));

-- tarifs_niveau
ALTER TABLE public.tarifs_niveau ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tarifs_tenant_isolation ON public.tarifs_niveau;
DROP POLICY IF EXISTS tarifs_site_isolation ON public.tarifs_niveau;
CREATE POLICY tarifs_tenant_isolation ON public.tarifs_niveau
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());
CREATE POLICY tarifs_site_isolation ON public.tarifs_niveau
  USING (is_site_admin() OR site_matches("siteId"))
  WITH CHECK (is_site_admin() OR site_matches("siteId"));

-- conversations
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS conversations_tenant_isolation ON public.conversations;
DROP POLICY IF EXISTS conversations_site_isolation ON public.conversations;
CREATE POLICY conversations_tenant_isolation ON public.conversations
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());
CREATE POLICY conversations_site_isolation ON public.conversations
  USING (is_site_admin() OR site_matches("siteId"))
  WITH CHECK (is_site_admin() OR site_matches("siteId"));

-- depenses
ALTER TABLE public.depenses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS depenses_tenant_isolation ON public.depenses;
DROP POLICY IF EXISTS depenses_site_isolation ON public.depenses;
CREATE POLICY depenses_tenant_isolation ON public.depenses
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());
CREATE POLICY depenses_site_isolation ON public.depenses
  USING (is_site_admin() OR site_matches("siteId"))
  WITH CHECK (is_site_admin() OR site_matches("siteId"));

-- budgets
ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS budgets_tenant_isolation ON public.budgets;
DROP POLICY IF EXISTS budgets_site_isolation ON public.budgets;
CREATE POLICY budgets_tenant_isolation ON public.budgets
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());
CREATE POLICY budgets_site_isolation ON public.budgets
  USING (is_site_admin() OR site_matches("siteId"))
  WITH CHECK (is_site_admin() OR site_matches("siteId"));

-- remises_caisse
ALTER TABLE public.remises_caisse ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS remises_caisse_tenant_isolation ON public.remises_caisse;
DROP POLICY IF EXISTS remises_caisse_site_isolation ON public.remises_caisse;
CREATE POLICY remises_caisse_tenant_isolation ON public.remises_caisse
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());
CREATE POLICY remises_caisse_site_isolation ON public.remises_caisse
  USING (is_site_admin() OR site_matches("siteId"))
  WITH CHECK (is_site_admin() OR site_matches("siteId"));

-- ============================================================
-- 3c. TABLES AVEC tenantId DIRECT, SANS siteId
-- (filtrage tenant uniquement, site géré indirectement)
-- ============================================================

-- annees_scolaires
ALTER TABLE public.annees_scolaires ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS annees_tenant_isolation ON public.annees_scolaires;
CREATE POLICY annees_tenant_isolation ON public.annees_scolaires
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());

-- enseignants
ALTER TABLE public.enseignants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS enseignants_tenant_isolation ON public.enseignants;
CREATE POLICY enseignants_tenant_isolation ON public.enseignants
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());

-- parents
ALTER TABLE public.parents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS parents_tenant_isolation ON public.parents;
CREATE POLICY parents_tenant_isolation ON public.parents
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());

-- fiches_rh
ALTER TABLE public.fiches_rh ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fiches_rh_tenant_isolation ON public.fiches_rh;
CREATE POLICY fiches_rh_tenant_isolation ON public.fiches_rh
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());

-- absences_personnel
ALTER TABLE public.absences_personnel ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS absences_personnel_tenant_isolation ON public.absences_personnel;
CREATE POLICY absences_personnel_tenant_isolation ON public.absences_personnel
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());

-- conges_personnel
ALTER TABLE public.conges_personnel ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS conges_personnel_tenant_isolation ON public.conges_personnel;
CREATE POLICY conges_personnel_tenant_isolation ON public.conges_personnel
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());

-- regles_appreciation
ALTER TABLE public.regles_appreciation ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS regles_appreciation_tenant_isolation ON public.regles_appreciation;
CREATE POLICY regles_appreciation_tenant_isolation ON public.regles_appreciation
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());

-- enseignant_affectations
ALTER TABLE public.enseignant_affectations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS enseignant_affectations_tenant_isolation ON public.enseignant_affectations;
CREATE POLICY enseignant_affectations_tenant_isolation ON public.enseignant_affectations
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());

-- enseignant_matieres
ALTER TABLE public.enseignant_matieres ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS enseignant_matieres_tenant_isolation ON public.enseignant_matieres;
CREATE POLICY enseignant_matieres_tenant_isolation ON public.enseignant_matieres
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());

-- exclusions_eleve
ALTER TABLE public.exclusions_eleve ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS exclusions_eleve_tenant_isolation ON public.exclusions_eleve;
CREATE POLICY exclusions_eleve_tenant_isolation ON public.exclusions_eleve
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());

-- relances
ALTER TABLE public.relances ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS relances_tenant_isolation ON public.relances;
CREATE POLICY relances_tenant_isolation ON public.relances
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());

-- documents
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS documents_tenant_isolation ON public.documents;
DROP POLICY IF EXISTS documents_site_isolation ON public.documents;
CREATE POLICY documents_tenant_isolation ON public.documents
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());
CREATE POLICY documents_site_isolation ON public.documents
  USING (is_site_admin() OR "eleveId" IS NULL OR EXISTS (
    SELECT 1 FROM eleves e
    WHERE e.id = documents."eleveId"
      AND (e."siteId" = current_site_id() OR e."siteId" IS NULL)
  ))
  WITH CHECK (is_site_admin() OR "eleveId" IS NULL OR EXISTS (
    SELECT 1 FROM eleves e
    WHERE e.id = documents."eleveId"
      AND (e."siteId" = current_site_id() OR e."siteId" IS NULL)
  ));

-- ============================================================
-- 3d. TABLES AVEC tenantId + siteId INDIRECT VIA SOUS-REQUÊTE
-- (absences, bulletins, notes, incidents, dispenses_matiere,
--  parcours_scolaires, evaluations, emplois_temps)
-- ============================================================

-- absences
ALTER TABLE public.absences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS absences_tenant_isolation ON public.absences;
DROP POLICY IF EXISTS absences_site_isolation ON public.absences;
CREATE POLICY absences_tenant_isolation ON public.absences
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());
CREATE POLICY absences_site_isolation ON public.absences
  USING (is_site_admin() OR EXISTS (
    SELECT 1 FROM eleves e
    WHERE e.id = absences."eleveId"
      AND (e."siteId" = current_site_id() OR e."siteId" IS NULL)
  ))
  WITH CHECK (is_site_admin() OR EXISTS (
    SELECT 1 FROM eleves e
    WHERE e.id = absences."eleveId"
      AND (e."siteId" = current_site_id() OR e."siteId" IS NULL)
  ));

-- bulletins
ALTER TABLE public.bulletins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bulletins_tenant_isolation ON public.bulletins;
DROP POLICY IF EXISTS bulletins_site_isolation ON public.bulletins;
CREATE POLICY bulletins_tenant_isolation ON public.bulletins
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());
CREATE POLICY bulletins_site_isolation ON public.bulletins
  USING (is_site_admin() OR EXISTS (
    SELECT 1 FROM eleves e
    WHERE e.id = bulletins."eleveId"
      AND (e."siteId" = current_site_id() OR e."siteId" IS NULL)
  ))
  WITH CHECK (is_site_admin() OR EXISTS (
    SELECT 1 FROM eleves e
    WHERE e.id = bulletins."eleveId"
      AND (e."siteId" = current_site_id() OR e."siteId" IS NULL)
  ));

-- notes
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notes_tenant_isolation ON public.notes;
DROP POLICY IF EXISTS notes_site_isolation ON public.notes;
CREATE POLICY notes_tenant_isolation ON public.notes
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());
CREATE POLICY notes_site_isolation ON public.notes
  USING (is_site_admin() OR EXISTS (
    SELECT 1 FROM eleves e
    WHERE e.id = notes."eleveId"
      AND (e."siteId" = current_site_id() OR e."siteId" IS NULL)
  ))
  WITH CHECK (is_site_admin() OR EXISTS (
    SELECT 1 FROM eleves e
    WHERE e.id = notes."eleveId"
      AND (e."siteId" = current_site_id() OR e."siteId" IS NULL)
  ));

-- incidents
ALTER TABLE public.incidents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS incidents_tenant_isolation ON public.incidents;
DROP POLICY IF EXISTS incidents_site_isolation ON public.incidents;
CREATE POLICY incidents_tenant_isolation ON public.incidents
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());
CREATE POLICY incidents_site_isolation ON public.incidents
  USING (is_site_admin() OR EXISTS (
    SELECT 1 FROM eleves e
    WHERE e.id = incidents."eleveId"
      AND (e."siteId" = current_site_id() OR e."siteId" IS NULL)
  ))
  WITH CHECK (is_site_admin() OR EXISTS (
    SELECT 1 FROM eleves e
    WHERE e.id = incidents."eleveId"
      AND (e."siteId" = current_site_id() OR e."siteId" IS NULL)
  ));

-- dispenses_matiere
ALTER TABLE public.dispenses_matiere ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dispenses_matiere_tenant_isolation ON public.dispenses_matiere;
DROP POLICY IF EXISTS dispenses_site_isolation ON public.dispenses_matiere;
CREATE POLICY dispenses_matiere_tenant_isolation ON public.dispenses_matiere
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());
CREATE POLICY dispenses_site_isolation ON public.dispenses_matiere
  USING (is_site_admin() OR EXISTS (
    SELECT 1 FROM eleves e
    WHERE e.id = dispenses_matiere."eleveId"
      AND (e."siteId" = current_site_id() OR e."siteId" IS NULL)
  ))
  WITH CHECK (is_site_admin() OR EXISTS (
    SELECT 1 FROM eleves e
    WHERE e.id = dispenses_matiere."eleveId"
      AND (e."siteId" = current_site_id() OR e."siteId" IS NULL)
  ));

-- parcours_scolaires
ALTER TABLE public.parcours_scolaires ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS parcours_scolaires_tenant_isolation ON public.parcours_scolaires;
DROP POLICY IF EXISTS parcours_site_isolation ON public.parcours_scolaires;
CREATE POLICY parcours_scolaires_tenant_isolation ON public.parcours_scolaires
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());
CREATE POLICY parcours_site_isolation ON public.parcours_scolaires
  USING (is_site_admin() OR EXISTS (
    SELECT 1 FROM eleves e
    WHERE e.id = parcours_scolaires."eleveId"
      AND (e."siteId" = current_site_id() OR e."siteId" IS NULL)
  ))
  WITH CHECK (is_site_admin() OR EXISTS (
    SELECT 1 FROM eleves e
    WHERE e.id = parcours_scolaires."eleveId"
      AND (e."siteId" = current_site_id() OR e."siteId" IS NULL)
  ));

-- evaluations
ALTER TABLE public.evaluations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS evaluations_tenant_isolation ON public.evaluations;
DROP POLICY IF EXISTS evaluations_site_isolation ON public.evaluations;
CREATE POLICY evaluations_tenant_isolation ON public.evaluations
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());
CREATE POLICY evaluations_site_isolation ON public.evaluations
  USING (is_site_admin() OR EXISTS (
    SELECT 1 FROM classes c
    WHERE c.id = evaluations."classeId"
      AND (c."siteId" = current_site_id() OR c."siteId" IS NULL)
  ))
  WITH CHECK (is_site_admin() OR EXISTS (
    SELECT 1 FROM classes c
    WHERE c.id = evaluations."classeId"
      AND (c."siteId" = current_site_id() OR c."siteId" IS NULL)
  ));

-- emplois_temps
ALTER TABLE public.emplois_temps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS emplois_temps_tenant_isolation ON public.emplois_temps;
DROP POLICY IF EXISTS emplois_tenant_isolation ON public.emplois_temps;
DROP POLICY IF EXISTS emplois_temps_site_isolation ON public.emplois_temps;
CREATE POLICY emplois_temps_tenant_isolation ON public.emplois_temps
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());
CREATE POLICY emplois_temps_site_isolation ON public.emplois_temps
  USING (is_site_admin() OR EXISTS (
    SELECT 1 FROM classes c
    WHERE c.id = emplois_temps."classeId"
      AND (c."siteId" = current_site_id() OR c."siteId" IS NULL)
  ))
  WITH CHECK (is_site_admin() OR EXISTS (
    SELECT 1 FROM classes c
    WHERE c.id = emplois_temps."classeId"
      AND (c."siteId" = current_site_id() OR c."siteId" IS NULL)
  ));

-- ============================================================
-- 3e. TABLES SANS tenantId — FILTRAGE INDIRECT COMPLET
-- (bulletin_matieres, contenus_cours, progressions_eleves,
--  paiements, sanctions, sessions_examen, messages,
--  conversation_participants, eleve_parents, device_tokens,
--  bulletins_paie, periodes, enseignant_sites, user_sites)
-- ============================================================

-- bulletin_matieres (via bulletins → tenant, via bulletins.eleve → site)
ALTER TABLE public.bulletin_matieres ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bulletin_matieres_tenant ON public.bulletin_matieres;
DROP POLICY IF EXISTS bulletin_matieres_site_isolation ON public.bulletin_matieres;
CREATE POLICY bulletin_matieres_tenant ON public.bulletin_matieres
  USING (EXISTS (
    SELECT 1 FROM bulletins b
    WHERE b.id = bulletin_matieres."bulletinId"
      AND b."tenantId" = current_tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM bulletins b
    WHERE b.id = bulletin_matieres."bulletinId"
      AND b."tenantId" = current_tenant_id()
  ));
CREATE POLICY bulletin_matieres_site_isolation ON public.bulletin_matieres
  USING (is_site_admin() OR EXISTS (
    SELECT 1 FROM bulletins b
    JOIN eleves e ON e.id = b."eleveId"
    WHERE b.id = bulletin_matieres."bulletinId"
      AND (e."siteId" = current_site_id() OR e."siteId" IS NULL)
  ))
  WITH CHECK (is_site_admin() OR EXISTS (
    SELECT 1 FROM bulletins b
    JOIN eleves e ON e.id = b."eleveId"
    WHERE b.id = bulletin_matieres."bulletinId"
      AND (e."siteId" = current_site_id() OR e."siteId" IS NULL)
  ));

-- contenus_cours (via cours → tenant + site)
-- CORRECTION : la policy existante ne vérifiait QUE le site, pas le tenant
ALTER TABLE public.contenus_cours ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contenus_cours_site_isolation ON public.contenus_cours;
DROP POLICY IF EXISTS contenus_cours_tenant_isolation ON public.contenus_cours;
CREATE POLICY contenus_cours_tenant_isolation ON public.contenus_cours
  USING (EXISTS (
    SELECT 1 FROM cours c
    WHERE c.id = contenus_cours."coursId"
      AND c."tenantId" = current_tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM cours c
    WHERE c.id = contenus_cours."coursId"
      AND c."tenantId" = current_tenant_id()
  ));
CREATE POLICY contenus_cours_site_isolation ON public.contenus_cours
  USING (is_site_admin() OR EXISTS (
    SELECT 1 FROM cours c
    WHERE c.id = contenus_cours."coursId"
      AND (c."siteId" = current_site_id() OR c."siteId" IS NULL)
  ))
  WITH CHECK (is_site_admin() OR EXISTS (
    SELECT 1 FROM cours c
    WHERE c.id = contenus_cours."coursId"
      AND (c."siteId" = current_site_id() OR c."siteId" IS NULL)
  ));

-- progressions_eleves (via cours → tenant + site)
-- CORRECTION : la policy existante ne vérifiait QUE le site, pas le tenant
ALTER TABLE public.progressions_eleves ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS progressions_site_isolation ON public.progressions_eleves;
DROP POLICY IF EXISTS progressions_eleves_tenant_isolation ON public.progressions_eleves;
CREATE POLICY progressions_eleves_tenant_isolation ON public.progressions_eleves
  USING (EXISTS (
    SELECT 1 FROM cours c
    WHERE c.id = progressions_eleves."coursId"
      AND c."tenantId" = current_tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM cours c
    WHERE c.id = progressions_eleves."coursId"
      AND c."tenantId" = current_tenant_id()
  ));
CREATE POLICY progressions_eleves_site_isolation ON public.progressions_eleves
  USING (is_site_admin() OR EXISTS (
    SELECT 1 FROM cours c
    WHERE c.id = progressions_eleves."coursId"
      AND (c."siteId" = current_site_id() OR c."siteId" IS NULL)
  ))
  WITH CHECK (is_site_admin() OR EXISTS (
    SELECT 1 FROM cours c
    WHERE c.id = progressions_eleves."coursId"
      AND (c."siteId" = current_site_id() OR c."siteId" IS NULL)
  ));

-- paiements (via factures → tenant + site)
-- CORRECTION : la policy existante ne vérifiait QUE le site, pas le tenant
ALTER TABLE public.paiements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS paiements_site_isolation ON public.paiements;
DROP POLICY IF EXISTS paiements_tenant_isolation ON public.paiements;
CREATE POLICY paiements_tenant_isolation ON public.paiements
  USING (EXISTS (
    SELECT 1 FROM factures f
    WHERE f.id = paiements."factureId"
      AND f."tenantId" = current_tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM factures f
    WHERE f.id = paiements."factureId"
      AND f."tenantId" = current_tenant_id()
  ));
CREATE POLICY paiements_site_isolation ON public.paiements
  USING (is_site_admin() OR EXISTS (
    SELECT 1 FROM factures f
    WHERE f.id = paiements."factureId"
      AND (f."siteId" = current_site_id() OR f."siteId" IS NULL)
  ))
  WITH CHECK (is_site_admin() OR EXISTS (
    SELECT 1 FROM factures f
    WHERE f.id = paiements."factureId"
      AND (f."siteId" = current_site_id() OR f."siteId" IS NULL)
  ));

-- sanctions (via incidents → tenant, via incidents.eleve → site)
-- CORRECTION : la policy existante ne vérifiait QUE le site, pas le tenant
ALTER TABLE public.sanctions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sanctions_site_isolation ON public.sanctions;
DROP POLICY IF EXISTS sanctions_tenant_isolation ON public.sanctions;
CREATE POLICY sanctions_tenant_isolation ON public.sanctions
  USING (EXISTS (
    SELECT 1 FROM incidents i
    WHERE i.id = sanctions."incidentId"
      AND i."tenantId" = current_tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM incidents i
    WHERE i.id = sanctions."incidentId"
      AND i."tenantId" = current_tenant_id()
  ));
CREATE POLICY sanctions_site_isolation ON public.sanctions
  USING (is_site_admin() OR EXISTS (
    SELECT 1 FROM incidents i
    JOIN eleves e ON e.id = i."eleveId"
    WHERE i.id = sanctions."incidentId"
      AND (e."siteId" = current_site_id() OR e."siteId" IS NULL)
  ))
  WITH CHECK (is_site_admin() OR EXISTS (
    SELECT 1 FROM incidents i
    JOIN eleves e ON e.id = i."eleveId"
    WHERE i.id = sanctions."incidentId"
      AND (e."siteId" = current_site_id() OR e."siteId" IS NULL)
  ));

-- sessions_examen (via examens → tenant + site)
ALTER TABLE public.sessions_examen ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sessions_examen_tenant ON public.sessions_examen;
DROP POLICY IF EXISTS sessions_examen_site_isolation ON public.sessions_examen;
CREATE POLICY sessions_examen_tenant ON public.sessions_examen
  USING (EXISTS (
    SELECT 1 FROM examens e
    WHERE e.id = sessions_examen."examId"
      AND e."tenantId" = current_tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM examens e
    WHERE e.id = sessions_examen."examId"
      AND e."tenantId" = current_tenant_id()
  ));
CREATE POLICY sessions_examen_site_isolation ON public.sessions_examen
  USING (is_site_admin() OR EXISTS (
    SELECT 1 FROM examens e
    WHERE e.id = sessions_examen."examId"
      AND (e."siteId" = current_site_id() OR e."siteId" IS NULL)
  ))
  WITH CHECK (is_site_admin() OR EXISTS (
    SELECT 1 FROM examens e
    WHERE e.id = sessions_examen."examId"
      AND (e."siteId" = current_site_id() OR e."siteId" IS NULL)
  ));

-- messages (via conversations → tenant)
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS messages_tenant ON public.messages;
CREATE POLICY messages_tenant ON public.messages
  USING (EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = messages."conversationId"
      AND c."tenantId" = current_tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = messages."conversationId"
      AND c."tenantId" = current_tenant_id()
  ));

-- conversation_participants (via conversations → tenant)
ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS conv_participants_tenant ON public.conversation_participants;
CREATE POLICY conv_participants_tenant ON public.conversation_participants
  USING (EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = conversation_participants."conversationId"
      AND c."tenantId" = current_tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = conversation_participants."conversationId"
      AND c."tenantId" = current_tenant_id()
  ));

-- eleve_parents (via eleves → tenant)
ALTER TABLE public.eleve_parents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS eleve_parents_tenant ON public.eleve_parents;
CREATE POLICY eleve_parents_tenant ON public.eleve_parents
  USING (EXISTS (
    SELECT 1 FROM eleves e
    WHERE e.id = eleve_parents."eleveId"
      AND e."tenantId" = current_tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM eleves e
    WHERE e.id = eleve_parents."eleveId"
      AND e."tenantId" = current_tenant_id()
  ));

-- device_tokens (via users → tenant)
ALTER TABLE public.device_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS device_tokens_tenant ON public.device_tokens;
CREATE POLICY device_tokens_tenant ON public.device_tokens
  USING (EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = device_tokens."userId"
      AND (u."tenantId" = current_tenant_id() OR u."tenantId" IS NULL)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = device_tokens."userId"
      AND (u."tenantId" = current_tenant_id() OR u."tenantId" IS NULL)
  ));

-- bulletins_paie (via fiches_rh → tenant)
ALTER TABLE public.bulletins_paie ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bulletins_paie_tenant_isolation ON public.bulletins_paie;
CREATE POLICY bulletins_paie_tenant_isolation ON public.bulletins_paie
  USING (EXISTS (
    SELECT 1 FROM fiches_rh fh
    WHERE fh.id = bulletins_paie."ficheRHId"
      AND fh."tenantId" = current_tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM fiches_rh fh
    WHERE fh.id = bulletins_paie."ficheRHId"
      AND fh."tenantId" = current_tenant_id()
  ));

-- periodes (via annees_scolaires → tenant)
ALTER TABLE public.periodes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS periodes_tenant_isolation ON public.periodes;
CREATE POLICY periodes_tenant_isolation ON public.periodes
  USING (EXISTS (
    SELECT 1 FROM annees_scolaires a
    WHERE a.id = periodes."anneeId"
      AND a."tenantId" = current_tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM annees_scolaires a
    WHERE a.id = periodes."anneeId"
      AND a."tenantId" = current_tenant_id()
  ));

-- enseignant_sites (via sites → tenant)
ALTER TABLE public.enseignant_sites ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS enseignant_sites_tenant_isolation ON public.enseignant_sites;
CREATE POLICY enseignant_sites_tenant_isolation ON public.enseignant_sites
  USING (EXISTS (
    SELECT 1 FROM sites s
    WHERE s.id = enseignant_sites."siteId"
      AND s."tenantId" = current_tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM sites s
    WHERE s.id = enseignant_sites."siteId"
      AND s."tenantId" = current_tenant_id()
  ));

-- user_sites (via sites → tenant)
ALTER TABLE public.user_sites ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_sites_tenant_isolation ON public.user_sites;
CREATE POLICY user_sites_tenant_isolation ON public.user_sites
  USING (EXISTS (
    SELECT 1 FROM sites s
    WHERE s.id = user_sites."siteId"
      AND s."tenantId" = current_tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM sites s
    WHERE s.id = user_sites."siteId"
      AND s."tenantId" = current_tenant_id()
  ));

-- ============================================================
-- 3f. TABLES SPÉCIALES
-- ============================================================

-- tenants : un tenant ne voit que lui-même
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_select_own ON public.tenants;
CREATE POLICY tenant_select_own ON public.tenants
  FOR SELECT
  USING (id = current_tenant_id());

-- users : tenantId + siteId (tenantId null = SUPER_ADMIN global)
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_tenant_isolation ON public.users;
DROP POLICY IF EXISTS users_site_isolation ON public.users;
CREATE POLICY users_tenant_isolation ON public.users
  USING ("tenantId" = current_tenant_id() OR "tenantId" IS NULL)
  WITH CHECK ("tenantId" = current_tenant_id() OR "tenantId" IS NULL);
CREATE POLICY users_site_isolation ON public.users
  USING (is_site_admin() OR site_matches("siteId"))
  WITH CHECK (is_site_admin() OR site_matches("siteId"));

-- sites : un tenant voit ses propres sites
ALTER TABLE public.sites ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sites_tenant_isolation ON public.sites;
CREATE POLICY sites_tenant_isolation ON public.sites
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());

-- user_tenants : un tenant voit ses propres associations
ALTER TABLE public.user_tenants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_tenants_tenant_isolation ON public.user_tenants;
CREATE POLICY user_tenants_tenant_isolation ON public.user_tenants
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());

-- audit_logs : tenantId nullable (actions globales = null)
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_logs_tenant_isolation ON public.audit_logs;
CREATE POLICY audit_logs_tenant_isolation ON public.audit_logs
  USING ("tenantId" = current_tenant_id() OR "tenantId" IS NULL)
  WITH CHECK ("tenantId" = current_tenant_id() OR "tenantId" IS NULL);

-- site_deletion_logs
ALTER TABLE public.site_deletion_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS site_deletion_logs_tenant_isolation ON public.site_deletion_logs;
DROP POLICY IF EXISTS site_deletion_logs_admin_write ON public.site_deletion_logs;
CREATE POLICY site_deletion_logs_tenant_isolation ON public.site_deletion_logs
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());

-- ============================================================
-- 3g. TABLES D'AUTHENTIFICATION — PAS DE RLS
-- ============================================================
-- accounts, sessions, verification_tokens : accédées par
-- Auth.js AVANT l'établissement du contexte tenant (login).
-- La sécurité repose sur l'imprévisibilité des tokens.
-- On désactive la RLS si elle était activée par erreur.

ALTER TABLE public.accounts DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.verification_tokens DISABLE ROW LEVEL SECURITY;

-- ============================================================
-- 4. PRIVILÈGES
-- ============================================================

-- Révoquer les privilèges excessifs des rôles Supabase
-- (anon et authenticated ne sont pas utilisés par l'app)
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

-- Accorder les privilèges au rôle applicatif
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ecolemiriam_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ecolemiriam_app;

-- Permettre l'exécution des fonctions de contexte
GRANT EXECUTE ON FUNCTIONS public.current_tenant_id(),
                              public.current_site_id(),
                              public.is_site_admin(),
                              public.set_tenant_context(text),
                              public.set_site_context(text),
                              public.site_matches(text)
TO ecolemiriam_app;

-- Privilèges par défaut pour les futures tables créées par Prisma
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ecolemiriam_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO ecolemiriam_app;

-- ============================================================
-- 5. VÉRIFICATION
-- ============================================================
-- Après exécution, vérifier qu'aucune table n'a RLS activée
-- sans policy (ce qui bloquerait tout accès) :
--
-- SELECT relname FROM pg_class c
-- JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public' AND c.relkind = 'r'
--   AND c.relrowsecurity
--   AND NOT EXISTS (
--     SELECT 1 FROM pg_policies p
--     WHERE p.schemaname = 'public' AND p.tablename = c.relname
--   )
-- ORDER BY relname;
--
-- Doit retourner : accounts, sessions, verification_tokens
-- (tables d'auth sans RLS — normal)
--
-- Vérifier que le rôle ecolemiriam_app ne peut PAS contourner la RLS :
-- SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname = 'ecolemiriam_app';
-- Doit retourner : ecolemiriam_app | false
-- ============================================================
