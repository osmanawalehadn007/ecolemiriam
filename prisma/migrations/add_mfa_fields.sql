-- Migration: Ajout des champs 2FA (TOTP) sur la table users
-- Champs: mfaSecret (secret chiffré base32), mfaEnabled (booléen)

ALTER TABLE "users" ADD COLUMN "mfaSecret" TEXT;
ALTER TABLE "users" ADD COLUMN "mfaEnabled" BOOLEAN NOT NULL DEFAULT false;
