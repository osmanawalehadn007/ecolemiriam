-- ============================================================
-- Migration : Cahier de texte (registre des séances de cours)
-- ============================================================
-- Table: cahier_textes
-- Permet aux enseignants de noter ce qui a été fait à chaque séance,
-- les devoirs donnés, et ce qui est prévu pour le cours suivant.
-- Le conseiller (CPE) et la direction peuvent consulter.
-- ============================================================

CREATE TABLE IF NOT EXISTS "cahier_textes" (
    "id"          TEXT NOT NULL,
    "tenantId"    TEXT NOT NULL,
    "siteId"      TEXT,
    "classeId"    TEXT NOT NULL,
    "matiereId"   TEXT NOT NULL,
    "enseignantId" TEXT,
    "date"        TIMESTAMP(3) NOT NULL,
    "heureDebut"  TEXT,
    "heureFin"    TEXT,
    "contenu"     TEXT NOT NULL,
    "devoirs"     TEXT,
    "prochainCours" TEXT,
    "commentaire" TEXT,
    "saisieParId" TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cahier_textes_pkey" PRIMARY KEY ("id")
);

-- Index
CREATE INDEX IF NOT EXISTS "cahier_textes_tenantId_idx" ON "cahier_textes"("tenantId");
CREATE INDEX IF NOT EXISTS "cahier_textes_siteId_idx" ON "cahier_textes"("siteId");
CREATE INDEX IF NOT EXISTS "cahier_textes_classeId_idx" ON "cahier_textes"("classeId");
CREATE INDEX IF NOT EXISTS "cahier_textes_matiereId_idx" ON "cahier_textes"("matiereId");
CREATE INDEX IF NOT EXISTS "cahier_textes_enseignantId_idx" ON "cahier_textes"("enseignantId");
CREATE INDEX IF NOT EXISTS "cahier_textes_tenantId_date_idx" ON "cahier_textes"("tenantId", "date");

-- Foreign keys
ALTER TABLE "cahier_textes"
  ADD CONSTRAINT "cahier_textes_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE;

ALTER TABLE "cahier_textes"
  ADD CONSTRAINT "cahier_textes_siteId_fkey"
  FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE SET NULL;

ALTER TABLE "cahier_textes"
  ADD CONSTRAINT "cahier_textes_classeId_fkey"
  FOREIGN KEY ("classeId") REFERENCES "classes"("id") ON DELETE CASCADE;

ALTER TABLE "cahier_textes"
  ADD CONSTRAINT "cahier_textes_matiereId_fkey"
  FOREIGN KEY ("matiereId") REFERENCES "matieres"("id") ON DELETE RESTRICT;

ALTER TABLE "cahier_textes"
  ADD CONSTRAINT "cahier_textes_enseignantId_fkey"
  FOREIGN KEY ("enseignantId") REFERENCES "enseignants"("id") ON DELETE SET NULL;

ALTER TABLE "cahier_textes"
  ADD CONSTRAINT "cahier_textes_saisieParId_fkey"
  FOREIGN KEY ("saisieParId") REFERENCES "users"("id") ON DELETE SET NULL;
