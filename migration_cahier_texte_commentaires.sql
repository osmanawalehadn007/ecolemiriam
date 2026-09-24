-- ============================================================
-- Migration : Cahier de texte — fichiers attachés + commentaires
-- ============================================================

-- 1. Ajouter la colonne fichiers (JSON) à cahier_textes
ALTER TABLE "cahier_textes" ADD COLUMN IF NOT EXISTS "fichiers" JSONB;

-- 2. Créer la table des commentaires
CREATE TABLE IF NOT EXISTS "cahier_texte_commentaires" (
    "id"             TEXT NOT NULL,
    "tenantId"       TEXT NOT NULL,
    "cahierTexteId"  TEXT NOT NULL,
    "auteurId"       TEXT NOT NULL,
    "contenu"        TEXT NOT NULL,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cahier_texte_commentaires_pkey" PRIMARY KEY ("id")
);

-- Index
CREATE INDEX IF NOT EXISTS "cahier_texte_commentaires_tenantId_idx" ON "cahier_texte_commentaires"("tenantId");
CREATE INDEX IF NOT EXISTS "cahier_texte_commentaires_cahierTexteId_idx" ON "cahier_texte_commentaires"("cahierTexteId");
CREATE INDEX IF NOT EXISTS "cahier_texte_commentaires_auteurId_idx" ON "cahier_texte_commentaires"("auteurId");

-- Foreign keys
ALTER TABLE "cahier_texte_commentaires"
  ADD CONSTRAINT "cahier_texte_commentaires_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE;

ALTER TABLE "cahier_texte_commentaires"
  ADD CONSTRAINT "cahier_texte_commentaires_cahierTexteId_fkey"
  FOREIGN KEY ("cahierTexteId") REFERENCES "cahier_textes"("id") ON DELETE CASCADE;

ALTER TABLE "cahier_texte_commentaires"
  ADD CONSTRAINT "cahier_texte_commentaires_auteurId_fkey"
  FOREIGN KEY ("auteurId") REFERENCES "users"("id") ON DELETE CASCADE;
