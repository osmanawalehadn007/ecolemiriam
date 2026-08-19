#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# EcolPro — Migration Supabase → VPS Postgres
# ============================================================
#
# Étapes :
#   1. pg_dump de Supabase (rôle postgres, bypass RLS)
#   2. Restore dans le Postgres du VPS
#   3. Exécuter la migration RLS (durcissement)
#   4. Vérifier l'intégrité (comptage de tables, lignes)
#   5. Générer les hashes PgBouncer
#
# Usage :
#   ./docker/scripts/migrate-from-supabase.sh
#
# Prérequis :
#   - .env.local avec SUPABASE_DB_URL et VPS_DB_URL
#   - Docker en cours d'exécution (stack VPS démarrée)
# ============================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[$(date -u +%H:%M:%S)]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()  { echo -e "${RED}[ERREUR]${NC} $1"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="${PROJECT_DIR}/.env.local"

[ -f "$ENV_FILE" ] || err "Fichier $ENV_FILE introuvable. Créer avec SUPABASE_DB_URL et VPS_DB_URL."
source "$ENV_FILE"

[ -n "${SUPABASE_DB_URL:-}" ] || err "SUPABASE_DB_URL requis dans $ENV_FILE"
[ -n "${VPS_DB_URL:-}" ] || err "VPS_DB_URL requis dans $ENV_FILE"

TMPDIR=$(mktemp -d)
DUMP_FILE="${TMPDIR}/ecolpro-supabase.dump"
RLS_FILE="${PROJECT_DIR}/prisma/migration_rls_hardening.sql"

trap 'rm -rf "$TMPDIR"' EXIT

log "=== Migration Supabase → VPS Postgres ==="

# 1. pg_dump
log "1/5 — pg_dump depuis Supabase..."
pg_dump "$SUPABASE_DB_URL" \
  --no-owner \
  --no-privileges \
  --format=custom \
  --compress=9 \
  --file="$DUMP_FILE"

DUMP_SIZE=$(stat -f%z "$DUMP_FILE" 2>/dev/null || stat -c%s "$DUMP_FILE" 2>/dev/null)
log "  → dump: $((DUMP_SIZE / 1024 / 1024)) Mo"

# 2. Restore
log "2/5 — restore dans le Postgres du VPS..."
pg_restore "$VPS_DB_URL" \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --dbname=ecolpro \
  "$DUMP_FILE" 2>&1 | grep -v "^$" || true

# 3. Migration RLS
if [ -f "$RLS_FILE" ]; then
  log "3/5 — exécution de la migration RLS..."
  psql "$VPS_DB_URL" -f "$RLS_FILE" 2>&1 | grep -E "^(CREATE|ALTER|GRANT|REVOKE|ERROR)" || true
else
  warn "3/5 — migration RLS non trouvée ($RLS_FILE), ignorée"
fi

# 4. Vérification
log "4/5 — vérification d'intégrité..."

TABLES=$(psql "$VPS_DB_URL" -t -c "SELECT count(*) FROM pg_tables WHERE schemaname='public'" 2>/dev/null | xargs)
log "  → tables: $TABLES"

ELEVES=$(psql "$VPS_DB_URL" -t -c "SELECT count(*) FROM eleves" 2>/dev/null | xargs || echo "N/A")
log "  → élèves: $ELEVES"

TENANTS=$(psql "$VPS_DB_URL" -t -c "SELECT count(*) FROM tenants" 2>/dev/null | xargs || echo "N/A")
log "  → tenants: $TENANTS"

USERS=$(psql "$VPS_DB_URL" -t -c "SELECT count(*) FROM users" 2>/dev/null | xargs || echo "N/A")
log "  → utilisateurs: $USERS"

RLS_TABLES=$(psql "$VPS_DB_URL" -t -c "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity" 2>/dev/null | xargs)
log "  → tables avec RLS: $RLS_TABLES"

BYPASS=$(psql "$VPS_DB_URL" -t -c "SELECT rolbypassrls FROM pg_roles WHERE rolname='ecolpro_app'" 2>/dev/null | xargs)
log "  → ecolpro_app bypassrls: $BYPASS (doit être f)"

# 5. Hashes PgBouncer
log "5/5 — génération des hashes PgBouncer..."
APP_HASH=$(psql "$VPS_DB_URL" -t -c "SELECT rolpassword FROM pg_authid WHERE rolname='ecolpro_app'" 2>/dev/null | xargs)
OWNER_HASH=$(psql "$VPS_DB_URL" -t -c "SELECT rolpassword FROM pg_authid WHERE rolname='ecolpro_owner'" 2>/dev/null | xargs)

if [ -n "$APP_HASH" ] && [ -n "$OWNER_HASH" ]; then
  USERLIST="${SCRIPT_DIR}/../pgbouncer/userlist.txt"
  cat > "$USERLIST" <<EOF
# Généré automatiquement le $(date -u +%FT%TZ)
"ecolpro_app" "$APP_HASH"
"ecolpro_owner" "$OWNER_HASH"
EOF
  chmod 600 "$USERLIST"
  log "  → hashes écrits dans $USERLIST"
else
  warn "  → hashes non disponibles (rôles non créés ?)"
fi

log "=== Migration terminée ✓ ==="
log ""
log "PROCHAINES ÉTAPES :"
log "  1. Redémarrer PgBouncer : docker compose restart pgbouncer"
log "  2. Tester : docker compose exec app curl -f http://localhost:3000/api/health"
log "  3. Activer le tunnel : docker compose up -d cloudflared"
