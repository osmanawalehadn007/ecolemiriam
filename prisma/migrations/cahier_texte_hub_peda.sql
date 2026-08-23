-- ============================================================
-- Migration : Cahier de texte — hub pédagogique
-- ============================================================
-- Ajoute :
--   1. Enum StatutSeance sur cahier_textes (avec défaut EFFECTUEE)
--   2. Champs structurés (contenuStructure, emploiTempsId, chapitreId, statut, effectueeAt, clotureeAt)
--   3. Table devoirs (travail à la maison traçable, lié à une séance)
--   4. Table chapitres (progression du programme par matière/classe)
--   5. Back-relations sur emplois_temps, evaluations, periodes, users, sites, tenants
-- ============================================================

-- 1. Enum StatutSeance
DO $$ BEGIN
  CREATE TYPE "StatutSeance" AS ENUM ('PLANIFIEE', 'EFFECTUEE', 'CLOTUREE', 'ANNULEE', 'REMPLACEE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Nouveaux champs sur cahier_textes
ALTER TABLE "cahier_textes"
  ADD COLUMN IF NOT EXISTS "statut" "StatutSeance" NOT NULL DEFAULT 'EFFECTUEE',
  ADD COLUMN IF NOT EXISTS "emploiTempsId" TEXT,
  ADD COLUMN IF NOT EXISTS "chapitreId" TEXT,
  ADD COLUMN IF NOT EXISTS "contenuStructure" JSONB,
  ADD COLUMN IF NOT EXISTS "effectueeAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "clotureeAt" TIMESTAMP(3);

-- Back-relation vers emplois_temps
ALTER TABLE "cahier_textes"
  ADD CONSTRAINT IF NOT EXISTS "cahier_textes_emploiTempsId_fkey"
  FOREIGN KEY ("emploiTempsId") REFERENCES "emplois_temps"("id") ON DELETE SET NULL;

-- Index sur les nouveaux champs
CREATE INDEX IF NOT EXISTS "cahier_textes_emploiTempsId_idx" ON "cahier_textes"("emploiTempsId");
CREATE INDEX IF NOT EXISTS "cahier_textes_chapitreId_idx" ON "cahier_textes"("chapitreId");
CREATE INDEX IF NOT EXISTS "cahier_textes_statut_idx" ON "cahier_textes"("statut");

-- 3. Enums pour les devoirs
DO $$ BEGIN
  CREATE TYPE "TypeDevoir" AS ENUM ('EXERCICE', 'LECTURE', 'RECHERCHE', 'REVISION', 'PROJET', 'DISSERTATION', 'AUTRE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "StatutDevoir" AS ENUM ('DONNE', 'RENDU', 'NON_RENDU', 'CORRIGE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 4. Table devoirs
CREATE TABLE IF NOT EXISTS "devoirs" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "siteId" TEXT,
  "seanceId" TEXT NOT NULL,
  "classeId" TEXT NOT NULL,
  "matiereId" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "type" "TypeDevoir" NOT NULL DEFAULT 'EXERCICE',
  "dateRemise" TIMESTAMP(3) NOT NULL,
  "statut" "StatutDevoir" NOT NULL DEFAULT 'DONNE',
  "evaluationId" TEXT,
  "fichiers" JSONB,
  "donneParId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "devoirs_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "devoirs"
  ADD CONSTRAINT IF NOT EXISTS "devoirs_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE;
ALTER TABLE "devoirs"
  ADD CONSTRAINT IF NOT EXISTS "devoirs_siteId_fkey"
  FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE SET NULL;
ALTER TABLE "devoirs"
  ADD CONSTRAINT IF NOT EXISTS "devoirs_seanceId_fkey"
  FOREIGN KEY ("seanceId") REFERENCES "cahier_textes"("id") ON DELETE CASCADE;
ALTER TABLE "devoirs"
  ADD CONSTRAINT IF NOT EXISTS "devoirs_classeId_fkey"
  FOREIGN KEY ("classeId") REFERENCES "classes"("id") ON DELETE CASCADE;
ALTER TABLE "devoirs"
  ADD CONSTRAINT IF NOT EXISTS "devoirs_matiereId_fkey"
  FOREIGN KEY ("matiereId") REFERENCES "matieres"("id");
ALTER TABLE "devoirs"
  ADD CONSTRAINT IF NOT EXISTS "devoirs_evaluationId_fkey"
  FOREIGN KEY ("evaluationId") REFERENCES "evaluations"("id") ON DELETE SET NULL;
ALTER TABLE "devoirs"
  ADD CONSTRAINT IF NOT EXISTS "devoirs_donneParId_fkey"
  FOREIGN KEY ("donneParId") REFERENCES "users"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "devoirs_tenantId_idx" ON "devoirs"("tenantId");
CREATE INDEX IF NOT EXISTS "devoirs_siteId_idx" ON "devoirs"("siteId");
CREATE INDEX IF NOT EXISTS "devoirs_seanceId_idx" ON "devoirs"("seanceId");
CREATE INDEX IF NOT EXISTS "devoirs_classeId_idx" ON "devoirs"("classeId");
CREATE INDEX IF NOT EXISTS "devoirs_matiereId_idx" ON "devoirs"("matiereId");
CREATE INDEX IF NOT EXISTS "devoirs_statut_idx" ON "devoirs"("statut");
CREATE INDEX IF NOT EXISTS "devoirs_dateRemise_idx" ON "devoirs"("dateRemise");

-- 5. Table chapitres
CREATE TABLE IF NOT EXISTS "chapitres" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "siteId" TEXT,
  "matiereId" TEXT NOT NULL,
  "niveau" TEXT,
  "classeId" TEXT,
  "titre" TEXT NOT NULL,
  "description" TEXT,
  "ordre" INTEGER NOT NULL DEFAULT 0,
  "nbHeuresPrevues" INTEGER NOT NULL DEFAULT 0,
  "periodeId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "chapitres_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "chapitres"
  ADD CONSTRAINT IF NOT EXISTS "chapitres_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE;
ALTER TABLE "chapitres"
  ADD CONSTRAINT IF NOT EXISTS "chapitres_siteId_fkey"
  FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE SET NULL;
ALTER TABLE "chapitres"
  ADD CONSTRAINT IF NOT EXISTS "chapitres_matiereId_fkey"
  FOREIGN KEY ("matiereId") REFERENCES "matieres"("id");
ALTER TABLE "chapitres"
  ADD CONSTRAINT IF NOT EXISTS "chapitres_classeId_fkey"
  FOREIGN KEY ("classeId") REFERENCES "classes"("id") ON DELETE SET NULL;
ALTER TABLE "chapitres"
  ADD CONSTRAINT IF NOT EXISTS "chapitres_periodeId_fkey"
  FOREIGN KEY ("periodeId") REFERENCES "periodes"("id") ON DELETE SET NULL;

-- Back-relation cahier_textes → chapitres
ALTER TABLE "cahier_textes"
  ADD CONSTRAINT IF NOT EXISTS "cahier_textes_chapitreId_fkey"
  FOREIGN KEY ("chapitreId") REFERENCES "chapitres"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "chapitres_tenantId_idx" ON "chapitres"("tenantId");
CREATE INDEX IF NOT EXISTS "chapitres_matiereId_idx" ON "chapitres"("matiereId");
CREATE INDEX IF NOT EXISTS "chapitres_classeId_idx" ON "chapitres"("classeId");
CREATE INDEX IF NOT EXISTS "chapitres_periodeId_idx" ON "chapitres"("periodeId");
