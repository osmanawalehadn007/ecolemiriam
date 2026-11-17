-- ============================================================
-- École Miriam — Migration RLS (Row Level Security)
-- ============================================================
-- Active RLS + crée les policies d'isolation tenant/site sur
-- toutes les tables tenant-scoped (48 tables).
--
-- Tables EXEMPTES (cross-tenant, pas de RLS) :
--   User, Tenant, UserTenant, UserSite, AuditLog, DeviceToken
--   → gérées par prismaBase (bypass RLS) pour login/auth.
--
-- Policies :
--   USING  : filtre les lignes visibles (SELECT/UPDATE/DELETE)
--   WITH CHECK : valide les lignes insérées/modifiées
--
-- Fail-closed : si app.tenant_id n'est pas positionné,
--   current_tenant_id() retourne NULL → tenantId = NULL → false
--   → 0 ligne renvoyée. L'extension Prisma throw avant d'arriver
--   ici (fail-closed applicatif), mais la DB protège aussi.
--
-- SUPER_ADMIN : app.is_super_admin='true' → tout passe.
-- Site filtering : app.site_id='' → tous les sites du tenant.
-- ============================================================

-- Absence → absences
ALTER TABLE absences ENABLE ROW LEVEL SECURITY;
ALTER TABLE absences FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON absences;
CREATE POLICY tenant_isolation ON absences
  FOR ALL
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR "tenantId" = current_tenant_id()
  )
  WITH CHECK (
    current_setting('app.is_super_admin', true) = 'true'
    OR "tenantId" = current_tenant_id()
  )
;

-- AbsencePersonnel → absences_personnel
ALTER TABLE absences_personnel ENABLE ROW LEVEL SECURITY;
ALTER TABLE absences_personnel FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON absences_personnel;
CREATE POLICY tenant_isolation ON absences_personnel
  FOR ALL
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR "tenantId" = current_tenant_id()
  )
  WITH CHECK (
    current_setting('app.is_super_admin', true) = 'true'
    OR "tenantId" = current_tenant_id()
  )
;

-- Alumni → alumni
ALTER TABLE alumni ENABLE ROW LEVEL SECURITY;
ALTER TABLE alumni FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON alumni;
CREATE POLICY tenant_isolation ON alumni
  FOR ALL
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR (
      "tenantId" = current_tenant_id()
      AND (current_site_id() = '' OR "siteId" = current_site_id())
    )
  )
  WITH CHECK (
    current_setting('app.is_super_admin', true) = 'true'
    OR (
      "tenantId" = current_tenant_id()
      AND (current_site_id() = '' OR "siteId" = current_site_id())
    )
  )
;

-- AnneesScolaires → annees_scolaires
ALTER TABLE annees_scolaires ENABLE ROW LEVEL SECURITY;
ALTER TABLE annees_scolaires FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON annees_scolaires;
CREATE POLICY tenant_isolation ON annees_scolaires
  FOR ALL
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR "tenantId" = current_tenant_id()
  )
  WITH CHECK (
    current_setting('app.is_super_admin', true) = 'true'
    OR "tenantId" = current_tenant_id()
  )
;

-- Budget → budgets
ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE budgets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON budgets;
CREATE POLICY tenant_isolation ON budgets
  FOR ALL
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR (
      "tenantId" = current_tenant_id()
      AND (current_site_id() = '' OR "siteId" = current_site_id())
    )
  )
  WITH CHECK (
    current_setting('app.is_super_admin', true) = 'true'
    OR (
      "tenantId" = current_tenant_id()
      AND (current_site_id() = '' OR "siteId" = current_site_id())
    )
  )
;

-- BulletinMatiere → bulletin_matieres
ALTER TABLE bulletin_matieres ENABLE ROW LEVEL SECURITY;
ALTER TABLE bulletin_matieres FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON bulletin_matieres;
CREATE POLICY tenant_isolation ON bulletin_matieres
  FOR ALL
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR "tenantId" = current_tenant_id()
  )
  WITH CHECK (
    current_setting('app.is_super_admin', true) = 'true'
    OR "tenantId" = current_tenant_id()
  )
;

-- Bulletin → bulletins
ALTER TABLE bulletins ENABLE ROW LEVEL SECURITY;
ALTER TABLE bulletins FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON bulletins;
CREATE POLICY tenant_isolation ON bulletins
  FOR ALL
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR "tenantId" = current_tenant_id()
  )
  WITH CHECK (
    current_setting('app.is_super_admin', true) = 'true'
    OR "tenantId" = current_tenant_id()
  )
;

-- CarnetPrimaire → carnets_primaires
ALTER TABLE carnets_primaires ENABLE ROW LEVEL SECURITY;
ALTER TABLE carnets_primaires FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON carnets_primaires;
CREATE POLICY tenant_isolation ON carnets_primaires
  FOR ALL
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR "tenantId" = current_tenant_id()
  )
  WITH CHECK (
    current_setting('app.is_super_admin', true) = 'true'
    OR "tenantId" = current_tenant_id()
  );

-- CarnetConfiguration → carnet_configurations
ALTER TABLE carnet_configurations ENABLE ROW LEVEL SECURITY;
ALTER TABLE carnet_configurations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON carnet_configurations;
CREATE POLICY tenant_isolation ON carnet_configurations
  FOR ALL
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR "tenantId" = current_tenant_id()
  )
  WITH CHECK (
    current_setting('app.is_super_admin', true) = 'true'
    OR "tenantId" = current_tenant_id()
  );

-- CahierTexteCommentaire → cahier_texte_commentaires
ALTER TABLE cahier_texte_commentaires ENABLE ROW LEVEL SECURITY;
ALTER TABLE cahier_texte_commentaires FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON cahier_texte_commentaires;
CREATE POLICY tenant_isolation ON cahier_texte_commentaires
  FOR ALL
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR "tenantId" = current_tenant_id()
  )
  WITH CHECK (
    current_setting('app.is_super_admin', true) = 'true'
    OR "tenantId" = current_tenant_id()
  )
;

-- CahierTexte → cahier_textes
ALTER TABLE cahier_textes ENABLE ROW LEVEL SECURITY;
ALTER TABLE cahier_textes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON cahier_textes;
CREATE POLICY tenant_isolation ON cahier_textes
  FOR ALL
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR (
      "tenantId" = current_tenant_id()
      AND (current_site_id() = '' OR "siteId" = current_site_id())
    )
  )
  WITH CHECK (
    current_setting('app.is_super_admin', true) = 'true'
    OR (
      "tenantId" = current_tenant_id()
      AND (current_site_id() = '' OR "siteId" = current_site_id())
    )
  )
;

-- Candidature → candidatures
ALTER TABLE candidatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidatures FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON candidatures;
CREATE POLICY tenant_isolation ON candidatures
  FOR ALL
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR (
      "tenantId" = current_tenant_id()
      AND (current_site_id() = '' OR "siteId" = current_site_id())
    )
  )
  WITH CHECK (
    current_setting('app.is_super_admin', true) = 'true'
    OR (
      "tenantId" = current_tenant_id()
      AND (current_site_id() = '' OR "siteId" = current_site_id())
    )
  )
;

-- Chapitre → chapitres
ALTER TABLE chapitres ENABLE ROW LEVEL SECURITY;
ALTER TABLE chapitres FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON chapitres;
CREATE POLICY tenant_isolation ON chapitres
  FOR ALL
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR (
      "tenantId" = current_tenant_id()
      AND (current_site_id() = '' OR "siteId" = current_site_id())
    )
  )
  WITH CHECK (
    current_setting('app.is_super_admin', true) = 'true'
    OR (
      "tenantId" = current_tenant_id()
      AND (current_site_id() = '' OR "siteId" = current_site_id())
    )
  )
;

-- Classe → classes
ALTER TABLE classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE classes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON classes;
CREATE POLICY tenant_isolation ON classes
  FOR ALL
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR (
      "tenantId" = current_tenant_id()
      AND (current_site_id() = '' OR "siteId" = current_site_id())
    )
  )
  WITH CHECK (
    current_setting('app.is_super_admin', true) = 'true'
    OR (
      "tenantId" = current_tenant_id()
      AND (current_site_id() = '' OR "siteId" = current_site_id())
    )
  )
;

-- CongePersonnel → conges_personnel
ALTER TABLE conges_personnel ENABLE ROW LEVEL SECURITY;
ALTER TABLE conges_personnel FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON conges_personnel;
CREATE POLICY tenant_isolation ON conges_personnel
  FOR ALL
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR "tenantId" = current_tenant_id()
  )
  WITH CHECK (
    current_setting('app.is_super_admin', true) = 'true'
    OR "tenantId" = current_tenant_id()
  )
;

-- Conversation → conversations
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON conversations;
CREATE POLICY tenant_isolation ON conversations
  FOR ALL
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR (
      "tenantId" = current_tenant_id()
      AND (current_site_id() = '' OR "siteId" = current_site_id())
    )
  )
  WITH CHECK (
    current_setting('app.is_super_admin', true) = 'true'
    OR (
      "tenantId" = current_tenant_id()
      AND (current_site_id() = '' OR "siteId" = current_site_id())
    )
  )
;

-- Cours → cours
ALTER TABLE cours ENABLE ROW LEVEL SECURITY;
ALTER TABLE cours FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON cours;
CREATE POLICY tenant_isolation ON cours
  FOR ALL
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR (
      "tenantId" = current_tenant_id()
      AND (current_site_id() = '' OR "siteId" = current_site_id())
    )
  )
  WITH CHECK (
    current_setting('app.is_super_admin', true) = 'true'
    OR (
      "tenantId" = current_tenant_id()
      AND (current_site_id() = '' OR "siteId" = current_site_id())
    )
  )
;

-- Depense → depenses
ALTER TABLE depenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE depenses FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON depenses;
CREATE POLICY tenant_isolation ON depenses
  FOR ALL
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR (
      "tenantId" = current_tenant_id()
      AND (current_site_id() = '' OR "siteId" = current_site_id())
    )
  )
  WITH CHECK (
    current_setting('app.is_super_admin', true) = 'true'
    OR (
      "tenantId" = current_tenant_id()
      AND (current_site_id() = '' OR "siteId" = current_site_id())
    )
  )
;

-- Devoir → devoirs
ALTER TABLE devoirs ENABLE ROW LEVEL SECURITY;
ALTER TABLE devoirs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON devoirs;
CREATE POLICY tenant_isolation ON devoirs
  FOR ALL
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR (
      "tenantId" = current_tenant_id()
      AND (current_site_id() = '' OR "siteId" = current_site_id())
    )
  )
  WITH CHECK (
    current_setting('app.is_super_admin', true) = 'true'
    OR (
      "tenantId" = current_tenant_id()
      AND (current_site_id() = '' OR "siteId" = current_site_id())
    )
  )
;

-- DispenseMatiere → dispenses_matiere
ALTER TABLE dispenses_matiere ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispenses_matiere FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON dispenses_matiere;
CREATE POLICY tenant_isolation ON dispenses_matiere
  FOR ALL
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR "tenantId" = current_tenant_id()
  )
  WITH CHECK (
    current_setting('app.is_super_admin', true) = 'true'
    OR "tenantId" = current_tenant_id()
  )
;

-- DisponibiliteEnseignant → disponibilites_enseignants
ALTER TABLE disponibilites_enseignants ENABLE ROW LEVEL SECURITY;
ALTER TABLE disponibilites_enseignants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON disponibilites_enseignants;
CREATE POLICY tenant_isolation ON disponibilites_enseignants
  FOR ALL
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR (
      "tenantId" = current_tenant_id()
      AND (current_site_id() = '' OR "siteId" = current_site_id())
    )
  )
  WITH CHECK (
    current_setting('app.is_super_admin', true) = 'true'
    OR (
      "tenantId" = current_tenant_id()
      AND (current_site_id() = '' OR "siteId" = current_site_id())
    )
  )
;

-- Document → documents
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON documents;
CREATE POLICY tenant_isolation ON documents
  FOR ALL
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR "tenantId" = current_tenant_id()
  )
  WITH CHECK (
    current_setting('app.is_super_admin', true) = 'true'
    OR "tenantId" = current_tenant_id()
  )
;

-- Eleve → eleves
ALTER TABLE eleves ENABLE ROW LEVEL SECURITY;
ALTER TABLE eleves FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON eleves;
CREATE POLICY tenant_isolation ON eleves
  FOR ALL
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR (
      "tenantId" = current_tenant_id()
      AND (current_site_id() = '' OR "siteId" = current_site_id())
    )
  )
  WITH CHECK (
    current_setting('app.is_super_admin', true) = 'true'
    OR (
      "tenantId" = current_tenant_id()
      AND (current_site_id() = '' OR "siteId" = current_site_id())
    )
  )
;

-- EmploiTemps → emplois_temps
ALTER TABLE emplois_temps ENABLE ROW LEVEL SECURITY;
ALTER TABLE emplois_temps FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON emplois_temps;
CREATE POLICY tenant_isolation ON emplois_temps
  FOR ALL
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR "tenantId" = current_tenant_id()
  )
  WITH CHECK (
    current_setting('app.is_super_admin', true) = 'true'
    OR "tenantId" = current_tenant_id()
  )
;

-- EnseignantAffectation → enseignant_affectations
ALTER TABLE enseignant_affectations ENABLE ROW LEVEL SECURITY;
ALTER TABLE enseignant_affectations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON enseignant_affectations;
CREATE POLICY tenant_isolation ON enseignant_affectations
  FOR ALL
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR "tenantId" = current_tenant_id()
  )
  WITH CHECK (
    current_setting('app.is_super_admin', true) = 'true'
    OR "tenantId" = current_tenant_id()
  )
;

-- EnseignantMatiere → enseignant_matieres
ALTER TABLE enseignant_matieres ENABLE ROW LEVEL SECURITY;
ALTER TABLE enseignant_matieres FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON enseignant_matieres;
CREATE POLICY tenant_isolation ON enseignant_matieres
  FOR ALL
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR "tenantId" = current_tenant_id()
  )
  WITH CHECK (
    current_setting('app.is_super_admin', true) = 'true'
    OR "tenantId" = current_tenant_id()
  )
;

-- Enseignant → enseignants
ALTER TABLE enseignants ENABLE ROW LEVEL SECURITY;
ALTER TABLE enseignants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON enseignants;
CREATE POLICY tenant_isolation ON enseignants
  FOR ALL
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR "tenantId" = current_tenant_id()
  )
  WITH CHECK (
    current_setting('app.is_super_admin', true) = 'true'
    OR "tenantId" = current_tenant_id()
  )
;

-- Evaluation → evaluations
ALTER TABLE evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE evaluations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON evaluations;
CREATE POLICY tenant_isolation ON evaluations
  FOR ALL
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR "tenantId" = current_tenant_id()
  )
  WITH CHECK (
    current_setting('app.is_super_admin', true) = 'true'
    OR "tenantId" = current_tenant_id()
  )
;

-- Evenement → evenements
ALTER TABLE evenements ENABLE ROW LEVEL SECURITY;
ALTER TABLE evenements FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON evenements;
CREATE POLICY tenant_isolation ON evenements
  FOR ALL
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR (
      "tenantId" = current_tenant_id()
      AND (current_site_id() = '' OR "siteId" = current_site_id())
    )
  )
  WITH CHECK (
    current_setting('app.is_super_admin', true) = 'true'
    OR (
      "tenantId" = current_tenant_id()
      AND (current_site_id() = '' OR "siteId" = current_site_id())
    )
  )
;

-- Examen → examens
ALTER TABLE examens ENABLE ROW LEVEL SECURITY;
ALTER TABLE examens FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON examens;
CREATE POLICY tenant_isolation ON examens
  FOR ALL
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR (
      "tenantId" = current_tenant_id()
      AND (current_site_id() = '' OR "siteId" = current_site_id())
    )
  )
  WITH CHECK (
    current_setting('app.is_super_admin', true) = 'true'
    OR (
      "tenantId" = current_tenant_id()
      AND (current_site_id() = '' OR "siteId" = current_site_id())
    )
  )
;

-- ExclusionEleve → exclusions_eleve
ALTER TABLE exclusions_eleve ENABLE ROW LEVEL SECURITY;
ALTER TABLE exclusions_eleve FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON exclusions_eleve;
CREATE POLICY tenant_isolation ON exclusions_eleve
  FOR ALL
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR "tenantId" = current_tenant_id()
  )
  WITH CHECK (
    current_setting('app.is_super_admin', true) = 'true'
    OR "tenantId" = current_tenant_id()
  )
;

-- Facture → factures
ALTER TABLE factures ENABLE ROW LEVEL SECURITY;
ALTER TABLE factures FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON factures;
CREATE POLICY tenant_isolation ON factures
  FOR ALL
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR (
      "tenantId" = current_tenant_id()
      AND (current_site_id() = '' OR "siteId" = current_site_id())
    )
  )
  WITH CHECK (
    current_setting('app.is_super_admin', true) = 'true'
    OR (
      "tenantId" = current_tenant_id()
      AND (current_site_id() = '' OR "siteId" = current_site_id())
    )
  )
;

-- FicheRH → fiches_rh
ALTER TABLE fiches_rh ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiches_rh FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON fiches_rh;
CREATE POLICY tenant_isolation ON fiches_rh
  FOR ALL
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR "tenantId" = current_tenant_id()
  )
  WITH CHECK (
    current_setting('app.is_super_admin', true) = 'true'
    OR "tenantId" = current_tenant_id()
  )
;

-- FournitureListe → fourniture_listes
ALTER TABLE fourniture_listes ENABLE ROW LEVEL SECURITY;
ALTER TABLE fourniture_listes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON fourniture_listes;
CREATE POLICY tenant_isolation ON fourniture_listes
  FOR ALL
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR (
      "tenantId" = current_tenant_id()
      AND (current_site_id() = '' OR "siteId" = current_site_id())
    )
  )
  WITH CHECK (
    current_setting('app.is_super_admin', true) = 'true'
    OR (
      "tenantId" = current_tenant_id()
      AND (current_site_id() = '' OR "siteId" = current_site_id())
    )
  )
;

-- Incident → incidents
ALTER TABLE incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE incidents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON incidents;
CREATE POLICY tenant_isolation ON incidents
  FOR ALL
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR "tenantId" = current_tenant_id()
  )
  WITH CHECK (
    current_setting('app.is_super_admin', true) = 'true'
    OR "tenantId" = current_tenant_id()
  )
;

-- ItemInventaire → inventaire
ALTER TABLE inventaire ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventaire FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON inventaire;
CREATE POLICY tenant_isolation ON inventaire
  FOR ALL
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR (
      "tenantId" = current_tenant_id()
      AND (current_site_id() = '' OR "siteId" = current_site_id())
    )
  )
  WITH CHECK (
    current_setting('app.is_super_admin', true) = 'true'
    OR (
      "tenantId" = current_tenant_id()
      AND (current_site_id() = '' OR "siteId" = current_site_id())
    )
  )
;

-- Matiere → matieres
ALTER TABLE matieres ENABLE ROW LEVEL SECURITY;
ALTER TABLE matieres FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON matieres;
CREATE POLICY tenant_isolation ON matieres
  FOR ALL
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR (
      "tenantId" = current_tenant_id()
      AND (current_site_id() = '' OR "siteId" = current_site_id())
    )
  )
  WITH CHECK (
    current_setting('app.is_super_admin', true) = 'true'
    OR (
      "tenantId" = current_tenant_id()
      AND (current_site_id() = '' OR "siteId" = current_site_id())
    )
  )
;

-- Note → notes
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE notes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON notes;
CREATE POLICY tenant_isolation ON notes
  FOR ALL
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR "tenantId" = current_tenant_id()
  )
  WITH CHECK (
    current_setting('app.is_super_admin', true) = 'true'
    OR "tenantId" = current_tenant_id()
  )
;

-- Notification → notifications
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON notifications;
CREATE POLICY tenant_isolation ON notifications
  FOR ALL
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR (
      "tenantId" = current_tenant_id()
      AND (current_site_id() = '' OR "siteId" = current_site_id())
    )
  )
  WITH CHECK (
    current_setting('app.is_super_admin', true) = 'true'
    OR (
      "tenantId" = current_tenant_id()
      AND (current_site_id() = '' OR "siteId" = current_site_id())
    )
  )
;

-- ParcoursScolaire → parcours_scolaires
ALTER TABLE parcours_scolaires ENABLE ROW LEVEL SECURITY;
ALTER TABLE parcours_scolaires FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON parcours_scolaires;
CREATE POLICY tenant_isolation ON parcours_scolaires
  FOR ALL
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR "tenantId" = current_tenant_id()
  )
  WITH CHECK (
    current_setting('app.is_super_admin', true) = 'true'
    OR "tenantId" = current_tenant_id()
  )
;

-- Parent → parents
ALTER TABLE parents ENABLE ROW LEVEL SECURITY;
ALTER TABLE parents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON parents;
CREATE POLICY tenant_isolation ON parents
  FOR ALL
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR "tenantId" = current_tenant_id()
  )
  WITH CHECK (
    current_setting('app.is_super_admin', true) = 'true'
    OR "tenantId" = current_tenant_id()
  )
;

-- ReglesAppreciation → regles_appreciation
ALTER TABLE regles_appreciation ENABLE ROW LEVEL SECURITY;
ALTER TABLE regles_appreciation FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON regles_appreciation;
CREATE POLICY tenant_isolation ON regles_appreciation
  FOR ALL
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR "tenantId" = current_tenant_id()
  )
  WITH CHECK (
    current_setting('app.is_super_admin', true) = 'true'
    OR "tenantId" = current_tenant_id()
  )
;

-- Relance → relances
ALTER TABLE relances ENABLE ROW LEVEL SECURITY;
ALTER TABLE relances FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON relances;
CREATE POLICY tenant_isolation ON relances
  FOR ALL
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR "tenantId" = current_tenant_id()
  )
  WITH CHECK (
    current_setting('app.is_super_admin', true) = 'true'
    OR "tenantId" = current_tenant_id()
  )
;

-- RemiseCaisse → remises_caisse
ALTER TABLE remises_caisse ENABLE ROW LEVEL SECURITY;
ALTER TABLE remises_caisse FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON remises_caisse;
CREATE POLICY tenant_isolation ON remises_caisse
  FOR ALL
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR (
      "tenantId" = current_tenant_id()
      AND (current_site_id() = '' OR "siteId" = current_site_id())
    )
  )
  WITH CHECK (
    current_setting('app.is_super_admin', true) = 'true'
    OR (
      "tenantId" = current_tenant_id()
      AND (current_site_id() = '' OR "siteId" = current_site_id())
    )
  )
;

-- Salle → salles
ALTER TABLE salles ENABLE ROW LEVEL SECURITY;
ALTER TABLE salles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON salles;
CREATE POLICY tenant_isolation ON salles
  FOR ALL
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR (
      "tenantId" = current_tenant_id()
      AND (current_site_id() = '' OR "siteId" = current_site_id())
    )
  )
  WITH CHECK (
    current_setting('app.is_super_admin', true) = 'true'
    OR (
      "tenantId" = current_tenant_id()
      AND (current_site_id() = '' OR "siteId" = current_site_id())
    )
  )
;

-- SiteDeletionLog → site_deletion_logs
ALTER TABLE site_deletion_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_deletion_logs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON site_deletion_logs;
CREATE POLICY tenant_isolation ON site_deletion_logs
  FOR ALL
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR (
      "tenantId" = current_tenant_id()
      AND (current_site_id() = '' OR "siteId" = current_site_id())
    )
  )
  WITH CHECK (
    current_setting('app.is_super_admin', true) = 'true'
    OR (
      "tenantId" = current_tenant_id()
      AND (current_site_id() = '' OR "siteId" = current_site_id())
    )
  )
;

-- Site → sites
ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE sites FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sites;
CREATE POLICY tenant_isolation ON sites
  FOR ALL
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR "tenantId" = current_tenant_id()
  )
  WITH CHECK (
    current_setting('app.is_super_admin', true) = 'true'
    OR "tenantId" = current_tenant_id()
  )
;

-- Structure → structures
ALTER TABLE structures ENABLE ROW LEVEL SECURITY;
ALTER TABLE structures FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON structures;
CREATE POLICY tenant_isolation ON structures
  FOR ALL
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR (
      "tenantId" = current_tenant_id()
      AND (current_site_id() = '' OR "siteId" = current_site_id())
    )
  )
  WITH CHECK (
    current_setting('app.is_super_admin', true) = 'true'
    OR (
      "tenantId" = current_tenant_id()
      AND (current_site_id() = '' OR "siteId" = current_site_id())
    )
  )
;

-- TarifNiveau → tarifs_niveau
ALTER TABLE tarifs_niveau ENABLE ROW LEVEL SECURITY;
ALTER TABLE tarifs_niveau FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tarifs_niveau;
CREATE POLICY tenant_isolation ON tarifs_niveau
  FOR ALL
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR (
      "tenantId" = current_tenant_id()
      AND (current_site_id() = '' OR "siteId" = current_site_id())
    )
  )
  WITH CHECK (
    current_setting('app.is_super_admin', true) = 'true'
    OR (
      "tenantId" = current_tenant_id()
      AND (current_site_id() = '' OR "siteId" = current_site_id())
    )
  )
;

-- UserPermission → user_permissions
ALTER TABLE user_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_permissions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON user_permissions;
CREATE POLICY tenant_isolation ON user_permissions
  FOR ALL
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR "tenantId" = current_tenant_id()
  )
  WITH CHECK (
    current_setting('app.is_super_admin', true) = 'true'
    OR "tenantId" = current_tenant_id()
  )
;

-- ============================================================
-- Vérification
-- ============================================================
SELECT relname, relrowsecurity, relforcerowsecurity
  FROM pg_class
  WHERE relrowsecurity = true
  ORDER BY relname;
