#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# École Miriam — Génération du userlist.txt PgBouncer
# ============================================================
#
# Récupère les hashes SCRAM-SHA-256 depuis pg_authid et écrit
# docker/pgbouncer/userlist.txt.
#
# Doit être exécuté APRÈS toute modification de mot de passe
# d'un rôle Postgres (ALTER ROLE ... PASSWORD).
#
# Usage :
#   ./docker/scripts/generate-pgbouncer-userlist.sh
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SECRETS_DIR="${DOCKER_DIR}/secrets"
USERLIST="${DOCKER_DIR}/pgbouncer/userlist.txt"

# Le mot de passe owner est nécessaire pour se connecter à Postgres
OWNER_PASS_FILE="${SECRETS_DIR}/postgres_owner_password.txt"
[ -f "$OWNER_PASS_FILE" ] || { echo "Erreur: $OWNER_PASS_FILE introuvable"; exit 1; }

OWNER_PASS=$(cat "$OWNER_PASS_FILE")
PG_CONTAINER="ecolemiriam-postgres"
DB_USER="ecolemiriam_owner"
DB_NAME="ecolemiriam"

echo "[generate-pgbouncer-userlist] Récupération des hashes SCRAM depuis pg_authid..."

# Récupérer les hashes au format PgBouncer : "username" "hash"
# `-e PGPASSWORD=…` : docker exec ne transmet pas l'environnement de l'hôte.
HASHES=$(docker exec -i -e PGPASSWORD="$OWNER_PASS" "$PG_CONTAINER" \
  psql -w -U "$DB_USER" -d "$DB_NAME" -t -A -c \
  "SELECT '\"' || rolname || '\" \"' || rolpassword || '\"' FROM pg_authid WHERE rolname IN ('ecolemiriam_app','ecolemiriam_owner') ORDER BY rolname;")

[ -n "$HASHES" ] || { echo "Erreur: aucun hash récupéré depuis pg_authid"; exit 1; }

# Écrire le userlist.txt
cat > "$USERLIST" <<EOF
# ============================================================
# École Miriam — PgBouncer userlist
# ============================================================
# Format : "username" "scram-sha-256-hash"
#
# Ce fichier est généré automatiquement par :
#   docker/scripts/generate-pgbouncer-userlist.sh
#
# NE JAMAIS committer ce fichier avec des hashes réels.
# ============================================================

EOF
echo "$HASHES" >> "$USERLIST"
chmod 600 "$USERLIST"

echo "[generate-pgbouncer-userlist] userlist.txt régénéré ✓"
echo "[generate-pgbouncer-userlist] Relancer PgBouncer pour prendre en compte :"
echo "  docker restart ecolemiriam-pgbouncer"
