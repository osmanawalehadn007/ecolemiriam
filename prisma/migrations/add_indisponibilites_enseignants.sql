-- ============================================================
-- INDISPONIBILITÉS ENSEIGNANTS — Migration
-- Créneaux à éviter lors de la génération/suggestion d'emploi du temps
-- (autre établissement, rendez-vous, jour off…).
-- Une journée entière = 00:00 → 23:59.
-- ============================================================

CREATE TABLE IF NOT EXISTS "indisponibilites_enseignants" (
  "id"           TEXT NOT NULL,
  "tenantId"     TEXT NOT NULL,
  "siteId"       TEXT,
  "enseignantId" TEXT NOT NULL,
  "jour"         "Jour" NOT NULL,
  "heureDebut"   TEXT NOT NULL,
  "heureFin"     TEXT NOT NULL,
  "source"       TEXT NOT NULL DEFAULT 'MANUEL',
  "note"         TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "indisponibilites_enseignants_pkey" PRIMARY KEY ("id")
);

-- Clés étrangères
ALTER TABLE "indisponibilites_enseignants"
  ADD CONSTRAINT "indisponibilites_enseignants_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE;

ALTER TABLE "indisponibilites_enseignants"
  ADD CONSTRAINT "indisponibilites_enseignants_siteId_fkey"
  FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE SET NULL;

ALTER TABLE "indisponibilites_enseignants"
  ADD CONSTRAINT "indisponibilites_enseignants_enseignantId_fkey"
  FOREIGN KEY ("enseignantId") REFERENCES "enseignants"("id") ON DELETE CASCADE;

-- Index
CREATE INDEX IF NOT EXISTS "indisponibilites_enseignants_tenantId_idx"
  ON "indisponibilites_enseignants"("tenantId");
CREATE INDEX IF NOT EXISTS "indisponibilites_enseignants_siteId_idx"
  ON "indisponibilites_enseignants"("siteId");
CREATE INDEX IF NOT EXISTS "indisponibilites_enseignants_enseignantId_idx"
  ON "indisponibilites_enseignants"("enseignantId");
