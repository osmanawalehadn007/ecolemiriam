#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# École Miriam — Application des policies RLS (post-migration)
# ============================================================
#
# N-5 (diagnostic instabilité) : les policies RLS vivaient dans des
# fichiers SQL détachés (prisma/migration_rls_activate.sql, etc.)
# qui n'étaient jamais exécutés automatiquement. Rien ne garantissait
# que la RLS était active en production.
#
# Ce script applique migration_rls_activate.sql (idempotent) sur la
# base de données après chaque déploiement, garantissant que :
#   - RLS + FORCE RLS sont activés sur toutes les tables métier
#   - Les policies tenant_isolation et site_isolation existent
#   - Les fonctions de contexte (current_tenant_id, etc.) sont à jour
#
# Doit être exécuté APRÈS prisma migrate / db push (les tables
# doivent exister).
#
# Usage :
#   ./docker/scripts/apply-rls.sh
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
PROJECT_DIR="$(cd "$DOCKER_DIR/.." && pwd)"
SECRETS_DIR="${DOCKER_DIR}/secrets"
RLS_SQL="${PROJECT_DIR}/prisma/migration_rls_activate.sql"

PG_CONTAINER="ecolemiriam-postgres"
DB_NAME="ecolemiriam"

[ -f "$RLS_SQL" ] || err "Fichier RLS introuvable : $RLS_SQL"

# Vérifier que Postgres tourne
docker ps --format '{{.Names}}' | grep -q "^${PG_CONTAINER}$" || \
  err "Le conteneur $PG_CONTAINER n'est pas en cours d'exécution."

# Récupérer le mot de passe owner
OWNER_PASS_FILE="${SECRETS_DIR}/postgres_owner_password.txt"
[ -f "$OWNER_PASS_FILE" ] || err "Mot de passe owner introuvable : $OWNER_PASS_FILE"
OWNER_PASS=$(cat "$OWNER_PASS_FILE")

log "=== Application des policies RLS ==="
log "Fichier SQL : $RLS_SQL"
log "Cible : $PG_CONTAINER / $DB_NAME"
echo ""

# Appliquer le SQL via psql (idempotent — DROP POLICY IF EXISTS + CREATE)
#
# `-e PGPASSWORD=…` et NON `PGPASSWORD=… docker exec` : préfixer la commande
# `docker` ne pose la variable que dans l'environnement du client Docker sur
# l'hôte. `docker exec` ne transmet pas l'environnement de l'appelant, donc
# psql démarrait dans le conteneur SANS mot de passe, tombait sur la règle
# `local all all scram-sha-256` de pg_hba.conf et réclamait le mot de passe
# de façon interactive — ce qui échoue en CI.
#
# `-w` interdit toute invite : en l'absence de mot de passe, psql échoue
# immédiatement avec un message clair au lieu d'attendre une saisie.
log "Exécution de migration_rls_activate.sql..."
docker exec -i -e PGPASSWORD="$OWNER_PASS" "$PG_CONTAINER" \
  psql -w -U ecolemiriam_owner -d "$DB_NAME" -v ON_ERROR_STOP=1 < "$RLS_SQL"

log ""
log "=== Vérification de l'état RLS ==="

# Vérifier combien de tables ont RLS activé
RLS_COUNT=$(docker exec -i -e PGPASSWORD="$OWNER_PASS" "$PG_CONTAINER" \
  psql -w -U ecolemiriam_owner -d "$DB_NAME" -t -A -c \
  "SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND relrowsecurity = true;")

# Vérifier combien de policies existent
POLICY_COUNT=$(docker exec -i -e PGPASSWORD="$OWNER_PASS" "$PG_CONTAINER" \
  psql -w -U ecolemiriam_owner -d "$DB_NAME" -t -A -c \
  "SELECT count(*) FROM pg_policies WHERE schemaname = 'public';")

# Ne garder que les chiffres : une comparaison `-eq` sur une chaîne non
# numérique interromprait le script avec une erreur peu lisible.
RLS_COUNT="${RLS_COUNT//[!0-9]/}"
POLICY_COUNT="${POLICY_COUNT//[!0-9]/}"

log "  → Tables avec RLS activé : ${RLS_COUNT:-0}"
log "  → Policies créées        : ${POLICY_COUNT:-0}"

if [ "${RLS_COUNT:-0}" -eq 0 ]; then
  err "⚠  Aucune table n'a RLS activé ! Vérifier que les migrations Prisma ont été exécutées."
fi

if [ "${POLICY_COUNT:-0}" -eq 0 ]; then
  err "⚠  Aucune policy RLS n'existe ! Le SQL a échoué silencieusement."
fi

log ""
log "=== RLS appliquée avec succès ✓ ==="
log "L'isolation multi-tenant est garantie au niveau base de données."
