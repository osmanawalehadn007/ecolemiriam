-- ============================================================
-- MIGRATION : le niveau est un RÉFÉRENTIEL FERMÉ
-- ============================================================
-- `classes.niveau` et `tarifs_niveau.niveau` étaient du texte libre. Or la
-- grille tarifaire est indexée sur ce libellé : « 2 », « 2eme » ou
-- « 2ème année » produisaient une classe que plus aucun tarif ne rattrapait.
-- Constaté le 28/09/2026 : 191 élèves de Campus Central invisibles du moteur
-- de facturation, leurs classes portant les niveaux « 2 » et « 3 ».
--
-- Le référentiel de référence est src/lib/niveau.ts (`NIVEAUX_CANONIQUES`).
-- L'application normalise désormais toute saisie (2 → 2ème) et refuse
-- l'inclassable ; cette migration pose LA MÊME règle en base, pour qu'aucun
-- script, import SQL ou outil externe ne puisse réintroduire un libellé
-- divergent.
--
-- Idempotent : rejouable sans risque (DROP CONSTRAINT IF EXISTS puis ADD).
-- Application (psql non requis) :
--   npx tsx scripts/appliquer-migration-niveaux.ts          # vérifie
--   npx tsx scripts/appliquer-migration-niveaux.ts --apply  # verrouille
--
-- ⚠️ Ne PAS confondre « 1ère » (1ère année, primaire) et « Première »
--    (classe de Première, lycée) : deux niveaux distincts, deux tarifs.
-- ⚠️ `matieres.niveau` n'est PAS concerné : il porte un numéro (1-12).
-- ============================================================

BEGIN;

-- ── 1. Refuser de verrouiller si des valeurs hors référentiel subsistent ──
--    Échouer bruyamment vaut mieux que figer une contrainte sur des données
--    fausses : le message renvoie vers l'outil d'harmonisation.
DO $$
DECLARE
  niveaux_classes text;
  niveaux_tarifs  text;
BEGIN
  SELECT string_agg(DISTINCT niveau, ', ') INTO niveaux_classes
  FROM public.classes
  WHERE niveau NOT IN (
    'Maternelle','1ère','2ème','3ème','4ème','5ème',
    '6ème','7ème','8ème','9ème','Seconde','Première','Terminale'
  );

  SELECT string_agg(DISTINCT niveau, ', ') INTO niveaux_tarifs
  FROM public.tarifs_niveau
  WHERE niveau NOT IN (
    'Maternelle','1ère','2ème','3ème','4ème','5ème',
    '6ème','7ème','8ème','9ème','Seconde','Première','Terminale'
  );

  IF niveaux_classes IS NOT NULL OR niveaux_tarifs IS NOT NULL THEN
    RAISE EXCEPTION
      'Niveaux hors référentiel — classes : [%] / tarifs : [%]. Corrigez-les d''abord avec : npx tsx scripts/harmoniser-niveaux-classes.ts --apply',
      COALESCE(niveaux_classes, 'aucun'), COALESCE(niveaux_tarifs, 'aucun');
  END IF;
END $$;

-- ── 2. Verrou sur les classes ───────────────────────────────────────────
ALTER TABLE public.classes DROP CONSTRAINT IF EXISTS classes_niveau_canonique;
ALTER TABLE public.classes ADD CONSTRAINT classes_niveau_canonique CHECK (
  niveau IN (
    'Maternelle','1ère','2ème','3ème','4ème','5ème',
    '6ème','7ème','8ème','9ème','Seconde','Première','Terminale'
  )
);

-- ── 3. Verrou sur la grille tarifaire ───────────────────────────────────
ALTER TABLE public.tarifs_niveau DROP CONSTRAINT IF EXISTS tarifs_niveau_canonique;
ALTER TABLE public.tarifs_niveau ADD CONSTRAINT tarifs_niveau_canonique CHECK (
  niveau IN (
    'Maternelle','1ère','2ème','3ème','4ème','5ème',
    '6ème','7ème','8ème','9ème','Seconde','Première','Terminale'
  )
);

COMMIT;
