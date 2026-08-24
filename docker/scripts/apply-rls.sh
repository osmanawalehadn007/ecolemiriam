#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# École Miriam — Application + vérification des policies RLS
# ============================================================
#
# Ce script applique `prisma/migration_rls_secure.sql`, puis EXÉCUTE LA
# VÉRIFICATION avec le rôle applicatif et échoue si l'isolation n'est pas
# effective.
#
# Pourquoi la vérification est obligatoire
# ----------------------------------------
# Ce script appliquait auparavant `migration_rls_activate.sql`, lequel
# recréait la policy permissive `<table>_site_isolation`. Son qual
# (`is_site_admin() OR site_matches("siteId")`) ne contrôle pas le tenant
# et vaut TRUE dès que `app.site_id` est vide. Les policies permissives
# étant combinées en OR, chaque déploiement rouvrait la brèche — et le
# script se déclarait « appliqué avec succès » parce qu'il ne comptait
# que le NOMBRE de policies, jamais leur effet.
#
# On ne compte plus les policies : on prouve qu'un tenant inexistant ne
# voit aucune ligne.
#
# Doit être exécuté APRÈS prisma migrate / db push.
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

RLS_SQL="${PROJECT_DIR}/prisma/migration_rls_secure.sql"
VERIFY_SQL="${PROJECT_DIR}/prisma/verify_rls.sql"

PG_CONTAINER="ecolemiriam-postgres"
DB_NAME="ecolemiriam"

[ -f "$RLS_SQL" ]    || err "Migration RLS introuvable : $RLS_SQL"
[ -f "$VERIFY_SQL" ] || err "Script de vérification introuvable : $VERIFY_SQL"

docker ps --format '{{.Names}}' | grep -q "^${PG_CONTAINER}$" || \
  err "Le conteneur $PG_CONTAINER n'est pas en cours d'exécution."

OWNER_PASS_FILE="${SECRETS_DIR}/postgres_owner_password.txt"
APP_PASS_FILE="${SECRETS_DIR}/postgres_app_password.txt"
[ -f "$OWNER_PASS_FILE" ] || err "Mot de passe owner introuvable : $OWNER_PASS_FILE"
[ -f "$APP_PASS_FILE" ]   || err "Mot de passe app introuvable : $APP_PASS_FILE"
OWNER_PASS=$(cat "$OWNER_PASS_FILE")
APP_PASS=$(cat "$APP_PASS_FILE")

log "=== 1/2 — Application des policies RLS ==="
log "Fichier : $RLS_SQL"
echo ""

# `-e PGPASSWORD=…` et NON `PGPASSWORD=… docker exec` : préfixer la commande
# `docker` ne pose la variable que côté hôte ; `docker exec` ne transmet pas
# l'environnement de l'appelant, et psql réclamerait le mot de passe de façon
# interactive. `-w` interdit toute invite (échec immédiat et lisible en CI).
docker exec -i -e PGPASSWORD="$OWNER_PASS" "$PG_CONTAINER" \
  psql -w -U ecolemiriam_owner -d "$DB_NAME" -v ON_ERROR_STOP=1 < "$RLS_SQL"

echo ""
log "=== 2/2 — Vérification avec le rôle applicatif ==="
log "Le rôle owner porte BYPASSRLS : vérifier avec lui ne prouverait rien."
echo ""

# ecolemiriam_app n'est autorisé que depuis le réseau Docker (pg_hba.conf) :
# on passe donc par `-h postgres` et non par la socket locale.
if ! docker exec -i -e PGPASSWORD="$APP_PASS" "$PG_CONTAINER" \
      psql -w -U ecolemiriam_app -h postgres -d "$DB_NAME" \
           -v ON_ERROR_STOP=1 < "$VERIFY_SQL"
then
  err "⚠  L'isolation multi-tenant N'EST PAS effective. Déploiement interrompu."
fi

echo ""
log "=== RLS appliquée et vérifiée ✓ ==="
log "Un tenant inexistant ne voit aucune ligne : l'isolation est prouvée."
