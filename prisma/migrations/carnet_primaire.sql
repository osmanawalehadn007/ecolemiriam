-- ============================================================
-- Migration : Carnet de l'enseignement fondamental (1ère à 5ème)
-- ============================================================
-- Ajoute la table carnets_primaires : une ligne par élève et par année,
-- avec les saisies par module en JSON (voir src/lib/carnet-primaire).
-- Isolation par tenant identique aux bulletins (RLS + FORCE).
-- ============================================================

CREATE TABLE IF NOT EXISTS "carnets_primaires" (
  "id"            TEXT PRIMARY KEY,
  "tenantId"      TEXT NOT NULL,
  "eleveId"       TEXT NOT NULL,
  "annee"         TEXT NOT NULL,
  "niveau"        TEXT NOT NULL,
  "saisie"        JSONB NOT NULL DEFAULT '{}'::jsonb,
  "appreciations" TEXT,
  "decision"      TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL
);

ALTER TABLE "carnets_primaires"
  ADD CONSTRAINT "carnets_primaires_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE;

ALTER TABLE "carnets_primaires"
  ADD CONSTRAINT "carnets_primaires_eleveId_fkey"
  FOREIGN KEY ("eleveId") REFERENCES "eleves"("id") ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS "carnets_primaires_eleveId_annee_key" ON "carnets_primaires"("eleveId", "annee");
CREATE INDEX IF NOT EXISTS "carnets_primaires_tenantId_idx" ON "carnets_primaires"("tenantId");

-- RLS : même politique que bulletins
ALTER TABLE "carnets_primaires" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "carnets_primaires" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "carnets_primaires";
CREATE POLICY tenant_isolation ON "carnets_primaires"
  FOR ALL
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR "tenantId" = current_tenant_id()
  )
  WITH CHECK (
    current_setting('app.is_super_admin', true) = 'true'
    OR "tenantId" = current_tenant_id()
  );
