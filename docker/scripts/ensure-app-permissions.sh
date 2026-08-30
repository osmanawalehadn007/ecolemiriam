#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# École Miriam — Ensure app role has permissions on all tables
# ============================================================
#
# Après que Prisma crée les tables, s'assurer que le rôle
# ecolemiriam_app a les permissions CRUD nécessaires.
#
# Problème : les default privileges ne s'appliquent qu'aux tables
# créées APRÈS qu'on les a déclarées. Les tables créées par Prisma
# migrations (qui tournent après docker-entrypoint-initdb.d) ne
# reçoivent pas automatiquement ces permissions.
#
# Solution : exécuter ce script après les migrations, pour explicitement
# GRANT SELECT, INSERT, UPDATE, DELETE sur toutes les tables.
#
# Appelé par :
#   docker/scripts/ci-deploy.sh
#   docker/scripts/blue-green-deploy.sh (dans promote_to_production)
#
# Retourne 0 si succès, 1 si erreur
# ============================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[$(date -u +%H:%M:%S)]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()  { echo -e "${RED}[ERREUR]${NC} $1"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SECRETS_DIR="${DOCKER_DIR}/secrets"

PG_CONTAINER="ecolemiriam-postgres"
DB_NAME="ecolemiriam"

docker ps --format '{{.Names}}' | grep -q "^${PG_CONTAINER}$" || \
  err "Le conteneur $PG_CONTAINER n'est pas en cours d'exécution."

OWNER_PASS_FILE="${SECRETS_DIR}/postgres_owner_password.txt"
[ -f "$OWNER_PASS_FILE" ] || err "Mot de passe owner introuvable : $OWNER_PASS_FILE"
OWNER_PASS=$(cat "$OWNER_PASS_FILE")

log "=== Vérification des permissions ecolemiriam_app ==="

# Script SQL pour accorder les permissions
GRANT_SCRIPT="
-- Accorder SELECT, INSERT, UPDATE, DELETE sur toutes les tables
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ecolemiriam_app;

-- Accorder USAGE, SELECT sur toutes les séquences (pour les SERIAL/auto-increment)
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ecolemiriam_app;

-- Accorder EXECUTE sur toutes les fonctions (pour les helpers RLS)
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ecolemiriam_app;

-- Vérifier qu'au moins une table existe et que les permissions sont accordées
DO \$\$
DECLARE
  tbl_count int;
  perms_ok boolean;
BEGIN
  SELECT count(*) INTO tbl_count FROM pg_tables WHERE schemaname = 'public';
  
  IF tbl_count = 0 THEN
    RAISE WARNING 'Aucune table trouvée en schéma public. Les migrations Prisma n''ont peut-être pas tourné.';
  ELSE
    -- Vérifier qu'au moins une table est accessible par ecolemiriam_app
    -- (ce test tourne avec le rôle owner, on ne peut pas tester directement)
    RAISE NOTICE 'Tables publiques trouvées: %', tbl_count;
  END IF;
END \$\$;
"

# Exécuter via le rôle owner (qui a les permissions pour GRANT)
if docker exec -i -e PGPASSWORD="$OWNER_PASS" "$PG_CONTAINER" \
     psql -w -U ecolemiriam_owner -d "$DB_NAME" -v ON_ERROR_STOP=1 <<< "$GRANT_SCRIPT"
then
  log "=== Permissions accordées ✓ ==="
  exit 0
else
  err "Échec lors de l'accord des permissions"
  exit 1
fi
