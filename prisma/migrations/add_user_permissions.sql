-- Migration: add_user_permissions
-- Ajoute la table user_permissions pour les permissions personnalisées par utilisateur

CREATE TABLE IF NOT EXISTS "user_permissions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'grant',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_permissions_pkey" PRIMARY KEY ("id")
);

-- Index uniques et secondaires
CREATE UNIQUE INDEX IF NOT EXISTS "user_permissions_userId_tenantId_permission_key" ON "user_permissions"("userId", "tenantId", "permission");
CREATE INDEX IF NOT EXISTS "user_permissions_tenantId_idx" ON "user_permissions"("tenantId");
CREATE INDEX IF NOT EXISTS "user_permissions_userId_idx" ON "user_permissions"("userId");

-- Clés étrangères
ALTER TABLE "user_permissions"
    ADD CONSTRAINT "user_permissions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE;
ALTER TABLE "user_permissions"
    ADD CONSTRAINT "user_permissions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE;
