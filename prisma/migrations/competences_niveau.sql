-- ============================================================
-- Migration : niveaux des carnets = niveaux de la plateforme
-- ============================================================
-- competences, carnet_configurations et carnets_primaires indexent le carnet par
-- niveau. On y accepte uniquement les niveaux du cycle Primaire du référentiel
-- (src/lib/niveau.ts, NIVEAUX_CANONIQUES) : '1ère' = 1ère année du primaire,
-- jamais 'Première' (lycée). Idempotent.
-- ============================================================
ALTER TABLE public.competences DROP CONSTRAINT IF EXISTS competences_niveau_canonique;
ALTER TABLE public.competences ADD CONSTRAINT competences_niveau_canonique
  CHECK (niveau IN ('1ère','2ème','3ème','4ème','5ème'));

ALTER TABLE public.carnet_configurations DROP CONSTRAINT IF EXISTS carnet_configurations_niveau_canonique;
ALTER TABLE public.carnet_configurations ADD CONSTRAINT carnet_configurations_niveau_canonique
  CHECK (niveau IN ('1ère','2ème','3ème','4ème','5ème'));

ALTER TABLE public.carnets_primaires DROP CONSTRAINT IF EXISTS carnets_primaires_niveau_canonique;
ALTER TABLE public.carnets_primaires ADD CONSTRAINT carnets_primaires_niveau_canonique
  CHECK (niveau IN ('1ère','2ème','3ème','4ème','5ème'));
