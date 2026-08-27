-- Migration: add_email_log_model
-- Journal des emails transactionnels (suivi d'envoi, délivrance, rebond, échec)
-- Date: 2026-08-27

-- Types d'email transactionnel
DO $$ BEGIN
    CREATE TYPE "TypeEmail" AS ENUM ('VERIFICATION', 'PASSWORD_RESET', 'NOTIFICATION', 'ADMISSION', 'RELANCE', 'AUTRE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Statuts d'email
DO $$ BEGIN
    CREATE TYPE "StatutEmail" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'BOUNCED', 'FAILED', 'COMPLAINED', 'OPENED', 'DELIVERY_DELAYED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Table email_logs
CREATE TABLE IF NOT EXISTS "email_logs" (
    "id"              TEXT NOT NULL,
    "tenantId"        TEXT,
    "userId"          TEXT,
    "email"           TEXT NOT NULL,
    "type"            "TypeEmail" NOT NULL,
    "subject"         TEXT NOT NULL,
    "status"          "StatutEmail" NOT NULL DEFAULT 'PENDING',
    "resendEmailId"   TEXT,
    "errorMessage"    TEXT,
    "bounceReason"    TEXT,
    "sentAt"          TIMESTAMP(3),
    "deliveredAt"     TIMESTAMP(3),
    "bouncedAt"       TIMESTAMP(3),
    "openedAt"        TIMESTAMP(3),
    "complainedAt"    TIMESTAMP(3),
    "createdBy"       TEXT,
    "tags"            JSONB,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_logs_pkey" PRIMARY KEY ("id")
);

-- Clés étrangères
ALTER TABLE "email_logs"
    ADD CONSTRAINT "email_logs_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "email_logs"
    ADD CONSTRAINT "email_logs_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Index
CREATE INDEX IF NOT EXISTS "email_logs_tenantId_idx" ON "email_logs"("tenantId");
CREATE INDEX IF NOT EXISTS "email_logs_userId_idx" ON "email_logs"("userId");
CREATE INDEX IF NOT EXISTS "email_logs_email_idx" ON "email_logs"("email");
CREATE INDEX IF NOT EXISTS "email_logs_resendEmailId_idx" ON "email_logs"("resendEmailId");
CREATE INDEX IF NOT EXISTS "email_logs_status_idx" ON "email_logs"("status");
