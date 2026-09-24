-- ============================================================
-- FOURNITURES SCOLAIRES — Migration
-- Flux : enseignant → secrétariat → publication → parents/élèves
-- ============================================================

-- Types de fournitures
DO $$ BEGIN
  CREATE TYPE "FournitureType" AS ENUM ('LIVRE', 'CAHIER', 'INSTRUMENT', 'AUTRE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Statuts de liste
DO $$ BEGIN
  CREATE TYPE "FournitureStatut" AS ENUM ('BROUILLON', 'SOUMISE', 'VALIDEE', 'PUBLIEE', 'REJETEE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Table des listes de fournitures
CREATE TABLE IF NOT EXISTS "fourniture_listes" (
  "id"                    TEXT NOT NULL,
  "tenantId"              TEXT NOT NULL,
  "siteId"                TEXT,
  "niveau"                TEXT NOT NULL,
  "annee"                 TEXT NOT NULL,
  "matiereId"             TEXT,
  "statut"                "FournitureStatut" NOT NULL DEFAULT 'BROUILLON',
  "enseignantId"          TEXT,
  "valideeParId"          TEXT,
  "valideeAt"             TIMESTAMP(3),
  "publieeAt"             TIMESTAMP(3),
  "commentaireEnseignant"  TEXT,
  "commentaireSecretariat" TEXT,
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3) NOT NULL,

  CONSTRAINT "fourniture_listes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fourniture_listes_tenantId_niveau_annee_matiereId_key" UNIQUE ("tenantId", "niveau", "annee", "matiereId")
);

-- Table des items de fournitures
CREATE TABLE IF NOT EXISTS "fourniture_items" (
  "id"          TEXT NOT NULL,
  "listeId"     TEXT NOT NULL,
  "nom"         TEXT NOT NULL,
  "type"        "FournitureType" NOT NULL,
  "quantite"    INTEGER NOT NULL DEFAULT 1,
  "format"      TEXT,
  "description" TEXT,
  "marque"      TEXT,
  "ordre"       INTEGER NOT NULL DEFAULT 0,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,

  CONSTRAINT "fourniture_items_pkey" PRIMARY KEY ("id")
);

-- Index
CREATE INDEX IF NOT EXISTS "fourniture_listes_tenantId_idx" ON "fourniture_listes"("tenantId");
CREATE INDEX IF NOT EXISTS "fourniture_listes_siteId_idx" ON "fourniture_listes"("siteId");
CREATE INDEX IF NOT EXISTS "fourniture_listes_matiereId_idx" ON "fourniture_listes"("matiereId");
CREATE INDEX IF NOT EXISTS "fourniture_listes_enseignantId_idx" ON "fourniture_listes"("enseignantId");
CREATE INDEX IF NOT EXISTS "fourniture_listes_statut_idx" ON "fourniture_listes"("statut");
CREATE INDEX IF NOT EXISTS "fourniture_items_listeId_idx" ON "fourniture_items"("listeId");

-- Clés étrangères
ALTER TABLE "fourniture_listes"
  ADD CONSTRAINT "fourniture_listes_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE;

ALTER TABLE "fourniture_listes"
  ADD CONSTRAINT "fourniture_listes_siteId_fkey"
  FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE SET NULL;

ALTER TABLE "fourniture_listes"
  ADD CONSTRAINT "fourniture_listes_matiereId_fkey"
  FOREIGN KEY ("matiereId") REFERENCES "matieres"("id") ON DELETE SET NULL;

ALTER TABLE "fourniture_listes"
  ADD CONSTRAINT "fourniture_listes_enseignantId_fkey"
  FOREIGN KEY ("enseignantId") REFERENCES "enseignants"("id") ON DELETE SET NULL;

ALTER TABLE "fourniture_listes"
  ADD CONSTRAINT "fourniture_listes_valideeParId_fkey"
  FOREIGN KEY ("valideeParId") REFERENCES "users"("id") ON DELETE SET NULL;

ALTER TABLE "fourniture_items"
  ADD CONSTRAINT "fourniture_items_listeId_fkey"
  FOREIGN KEY ("listeId") REFERENCES "fourniture_listes"("id") ON DELETE CASCADE;
