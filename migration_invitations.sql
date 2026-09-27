-- ============================================================
-- EcolPro — Migration : invitations d'utilisateurs (jeton à usage unique)
-- À exécuter sur la base Supabase/PostgreSQL.
-- Idempotent : réexécutable sans erreur.
-- ============================================================

-- 1. Statut d'invitation
DO $$ BEGIN
  CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 2. Drappeau « changement de mot de passe obligatoire » sur les comptes
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

-- 3. Table des invitations
CREATE TABLE IF NOT EXISTS "invitations" (
  "id"         TEXT PRIMARY KEY,
  "tenantId"   TEXT NOT NULL,
  "siteId"     TEXT,
  "email"      TEXT NOT NULL,
  "name"       TEXT,
  "role"       "Role" NOT NULL DEFAULT 'TEACHER',
  "phone"      TEXT,
  "tokenHash"  TEXT NOT NULL,
  "status"     "InvitationStatus" NOT NULL DEFAULT 'PENDING',
  "expiresAt"  TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "revokedAt"  TIMESTAMP(3),
  "invitedById"      TEXT,
  "acceptedByUserId" TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "invitations_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "invitations_siteId_fkey"
    FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "invitations_invitedById_fkey"
    FOREIGN KEY ("invitedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "invitations_acceptedByUserId_fkey"
    FOREIGN KEY ("acceptedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- 4. Index & unicité du jeton (empreinte SHA-256)
CREATE UNIQUE INDEX IF NOT EXISTS "invitations_tokenHash_key" ON "invitations"("tokenHash");
CREATE INDEX IF NOT EXISTS "invitations_tenantId_status_idx" ON "invitations"("tenantId", "status");
CREATE INDEX IF NOT EXISTS "invitations_email_idx" ON "invitations"("email");
CREATE INDEX IF NOT EXISTS "invitations_expiresAt_idx" ON "invitations"("expiresAt");

-- Remarque : l'unicité « une seule invitation PENDING par (tenant, email) » est
-- garantie au niveau applicatif (voir `createInvitation`) plutôt que par un
-- index partiel, car Prisma ne sait pas déclarer d'index partiel/fonctionnel :
-- un tel index serait vu comme une dérive par `prisma db push` (utilisé en CI).

