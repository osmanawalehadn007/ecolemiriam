-- Migration : ajout de classeId et matiereId à sessions_examen
-- Permet le filtrage des examens par classe et matière pour les enseignants

ALTER TABLE sessions_examen
  ADD COLUMN IF NOT EXISTS "classeId" TEXT,
  ADD COLUMN IF NOT EXISTS "matiereId" TEXT;

-- Contraintes de clé étrangère
ALTER TABLE sessions_examen
  ADD CONSTRAINT fk_session_examen_classe
  FOREIGN KEY ("classeId") REFERENCES classes(id) ON DELETE SET NULL;

ALTER TABLE sessions_examen
  ADD CONSTRAINT fk_session_examen_matiere
  FOREIGN KEY ("matiereId") REFERENCES matieres(id) ON DELETE SET NULL;

-- Index pour performance
CREATE INDEX IF NOT EXISTS idx_sessions_examen_classe_id ON sessions_examen("classeId");
CREATE INDEX IF NOT EXISTS idx_sessions_examen_matiere_id ON sessions_examen("matiereId");
