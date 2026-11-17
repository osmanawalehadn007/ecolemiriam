-- ============================================================
-- Migration : Configuration des carnets par niveau
-- ============================================================
-- Ajoute carnet_configurations : la direction ajuste les domaines,
-- compétences et barèmes de chaque niveau (1ère à 5ème). Sans ligne,
-- le modèle par défaut de src/lib/carnet-primaire s'applique.
-- À appliquer après carnet_primaire.sql.
-- ============================================================

CREATE TABLE IF NOT EXISTS "carnet_configurations" (
  "id"        TEXT PRIMARY KEY,
  "tenantId"  TEXT NOT NULL,
  "niveau"    TEXT NOT NULL,
  "domaines"  JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

ALTER TABLE "carnet_configurations"
  ADD CONSTRAINT "carnet_configurations_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS "carnet_configurations_tenantId_niveau_key"
  ON "carnet_configurations"("tenantId", "niveau");

-- RLS : même politique que bulletins
ALTER TABLE "carnet_configurations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "carnet_configurations" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "carnet_configurations";
CREATE POLICY tenant_isolation ON "carnet_configurations"
  FOR ALL
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR "tenantId" = current_tenant_id()
  )
  WITH CHECK (
    current_setting('app.is_super_admin', true) = 'true'
    OR "tenantId" = current_tenant_id()
  );
