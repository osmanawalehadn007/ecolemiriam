-- Migration : Marquer tous les utilisateurs existants comme ayant un email vérifié
-- ============================================================
-- Contexte : La vérification email a été ajoutée après la création des comptes
-- existants. Pour éviter de bloquer les utilisateurs déjà inscrits, on marque
-- leur email comme vérifié avec la date actuelle.
--
-- Les NOUVEAUX utilisateurs créés après cette migration devront vérifier leur
-- email via le lien envoyé automatiquement à l'inscription.

UPDATE "users"
SET "emailVerified" = NOW()
WHERE "emailVerified" IS NULL;
