-- ============================================================
-- Migration : Évaluations → carnet du primaire
-- ============================================================
-- Deux colonnes facultatives sur evaluations : le module du carnet (1 à 4)
-- et la ligne de compétence visée. Additif et rétro-compatible : le code
-- précédent continue de fonctionner. À APPLIQUER AVANT le déploiement du code
-- qui lit ces colonnes (Prisma sélectionne toutes les colonnes du modèle).
-- ============================================================

ALTER TABLE "evaluations"
  ADD COLUMN IF NOT EXISTS "moduleCarnet" INTEGER,
  ADD COLUMN IF NOT EXISTS "ligneCarnet" INTEGER;
