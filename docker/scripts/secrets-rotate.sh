#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# École Miriam — Rotation des secrets
# ============================================================
#
# Régénère tous les secrets (sauf le token Cloudflare), met à
# jour les mots de passe Postgres (ALTER ROLE), régénère le
# userlist.txt PgBouncer, et rechiffre le fichier SOPS.
#
# ⚠  Cette rotation :
#   - Invalide TOUTES les sessions JWT (AUTH_SECRET change)
#   - Déconnecte tous les utilisateurs simultanément
#   - Provoque ~10s de downtime (restart PgBouncer + app)
#
# Usage :
#   ./docker/scripts/secrets-rotate.sh
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
AGE_KEY_FILE="${DOCKER_DIR}/keys/age-key.txt"
USERLIST_GEN="${SCRIPT_DIR}/generate-pgbouncer-userlist.sh"

PG_CONTAINER="ecolemiriam-postgres"
DB_NAME="ecolemiriam"

[ -f "$AGE_KEY_FILE" ] || err "Erreur: $AGE_KEY_FILE introuvable"
[ -f "$USERLIST_GEN" ] || err "Erreur: $USERLIST_GEN introuvable"

# Vérifier que Postgres tourne
docker ps --format '{{.Names}}' | grep -q "^${PG_CONTAINER}$" || \
  err "Le conteneur $PG_CONTAINER n'est pas en cours d'exécution. Démarrer la stack d'abord."

log "=== Rotation des secrets ==="
warn "⚠  Cette opération va déconnecter TOUS les utilisateurs (AUTH_SECRET change)."
warn "⚠  Provoque ~10s de downtime (restart PgBouncer + app)."
echo ""
read -r -p "Continuer ? [o/N] " confirm
[ "$confirm" = "o" ] || [ "$confirm" = "O" ] || { echo "Annulé."; exit 0; }

# ── 1. Sauvegarder les anciens mots de passe (pour la connexion DB) ──
OLD_OWNER_PASS=""
OLD_APP_PASS=""
if [ -f "$SECRETS_DIR/postgres_owner_password.txt" ]; then
  OLD_OWNER_PASS=$(cat "$SECRETS_DIR/postgres_owner_password.txt")
fi
if [ -f "$SECRETS_DIR/postgres_app_password.txt" ]; then
  OLD_APP_PASS=$(cat "$SECRETS_DIR/postgres_app_password.txt")
fi

[ -n "$OLD_OWNER_PASS" ] || err "Ancien mot de passe owner introuvable. Impossible de se connecter à Postgres."

# ── 2. Générer les nouveaux secrets ──
log "Génération des nouveaux secrets..."

NEW_OWNER_PASS=$(openssl rand -base64 32 | tr -d '/+=' | head -c 32)
NEW_APP_PASS=$(openssl rand -base64 32 | tr -d '/+=' | head -c 32)
NEW_AUTH_SECRET=$(openssl rand -base64 32)
NEW_CRON_SECRET=$(openssl rand -hex 32)
NEW_PGBACKREST_KEY=$(openssl rand -hex 32)

log "  → Nouveaux secrets générés ✓"

# ── 3. Mettre à jour les mots de passe dans Postgres (ALTER ROLE) ──
log "Mise à jour des mots de passe Postgres (ALTER ROLE)..."

# Utiliser l'ancien mot de passe owner pour se connecter
# psql variable substitution (:var) évite l'injection SQL et l'exposition dans le process list
# `-e PGPASSWORD=…` : docker exec ne transmet pas l'environnement de l'hôte.
docker exec -i -e PGPASSWORD="$OLD_OWNER_PASS" "$PG_CONTAINER" \
  psql -w -U ecolemiriam_owner -d "$DB_NAME" -v ON_ERROR_STOP=1 -v new_owner="$NEW_OWNER_PASS" -v new_app="$NEW_APP_PASS" <<'SQL'
ALTER ROLE ecolemiriam_owner WITH PASSWORD :'new_owner';
ALTER ROLE ecolemiriam_app   WITH PASSWORD :'new_app';
SQL

log "  → Mots de passe Postgres mis à jour ✓"

# ── 4. Régénérer le userlist.txt PgBouncer ──
# IMPORTANT : écrire les nouveaux mots de passe dans les fichiers secrets
# AVANT d'appeler generate-pgbouncer-userlist.sh, car ce script lit
# postgres_owner_password.txt pour se connecter à Postgres.
echo -n "$NEW_OWNER_PASS" > "$SECRETS_DIR/postgres_owner_password.txt"
echo -n "$NEW_APP_PASS" > "$SECRETS_DIR/postgres_app_password.txt"

log "Régénération du userlist.txt PgBouncer..."
bash "$USERLIST_GEN"
log "  → userlist.txt régénéré ✓"

# ── 5. Écrire les autres secrets ──
echo -n "$NEW_AUTH_SECRET" > "$SECRETS_DIR/auth_secret.txt"
echo -n "$NEW_CRON_SECRET" > "$SECRETS_DIR/cron_secret.txt"
echo -n "$NEW_PGBACKREST_KEY" > "$SECRETS_DIR/pgbackrest_cipher_pass.txt"

chmod 600 "$SECRETS_DIR"/*.txt

# ── 6. Recréer et chiffrer secrets.yaml ──
SECRETS_YAML="${SECRETS_DIR}/secrets.yaml"
cat > "$SECRETS_YAML" <<EOF
postgres_owner_password: $(cat "$SECRETS_DIR/postgres_owner_password.txt")
postgres_app_password: $(cat "$SECRETS_DIR/postgres_app_password.txt")
auth_secret: $(cat "$SECRETS_DIR/auth_secret.txt")
cron_secret: $(cat "$SECRETS_DIR/cron_secret.txt")
cloudflare_tunnel_token: $(cat "$SECRETS_DIR/cloudflare_tunnel_token.txt")
pgbackrest_cipher_pass: $(cat "$SECRETS_DIR/pgbackrest_cipher_pass.txt")
EOF

SOPS_AGE_KEY_FILE="$AGE_KEY_FILE" sops --encrypt --in-place "$SECRETS_YAML" 2>/dev/null || warn "SOPS encrypt a échoué (sops installé ?)"

log "  → secrets rotés et rechiffrés ✓"

# ── 7. Mettre à jour .env.production ──
ENV_FILE="${DOCKER_DIR}/../.env.production"
if [ -f "$ENV_FILE" ]; then
  log "Mise à jour de .env.production..."
  # Sauvegarder
  cp "$ENV_FILE" "${ENV_FILE}.bak.$(date +%s)"

  # Mettre à jour AUTH_SECRET et CRON_SECRET
  if grep -q "^AUTH_SECRET=" "$ENV_FILE"; then
    sed -i.bak "s|^AUTH_SECRET=.*|AUTH_SECRET=${NEW_AUTH_SECRET}|" "$ENV_FILE"
  fi
  if grep -q "^CRON_SECRET=" "$ENV_FILE"; then
    sed -i.bak "s|^CRON_SECRET=.*|CRON_SECRET=${NEW_CRON_SECRET}|" "$ENV_FILE"
  fi

  # Mettre à jour DATABASE_URL et DIRECT_URL avec le nouveau mot de passe app
  if grep -q "^DATABASE_URL=" "$ENV_FILE"; then
    sed -i.bak "s|postgresql://ecolemiriam_app:[^@]*@|postgresql://ecolemiriam_app:${NEW_APP_PASS}@|" "$ENV_FILE"
  fi
  if grep -q "^DIRECT_URL=" "$ENV_FILE"; then
    sed -i.bak "s|postgresql://ecolemiriam_app:[^@]*@|postgresql://ecolemiriam_app:${NEW_APP_PASS}@|" "$ENV_FILE"
  fi

  rm -f "${ENV_FILE}.bak"
  log "  → .env.production mis à jour ✓"
else
  warn ".env.production introuvable — mettre à jour manuellement DATABASE_URL, DIRECT_URL, AUTH_SECRET, CRON_SECRET"
fi

# ── 8. Redémarrer les services affectés ──
log "Redémarrage des services affectés..."

# PgBouncer : relire le userlist.txt (bind mount :ro → restart nécessaire)
docker restart ecolemiriam-pgbouncer 2>/dev/null && log "  → PgBouncer redémarré ✓" || warn "  → PgBouncer non redémarré"

# App : recréer le conteneur actif pour recharger env_file (.env.production)
# env_file n'est lu qu'à la création du conteneur, pas au restart.
ACTIVE_COLOR="blue"
[ -f "${DOCKER_DIR}/.active-color" ] && ACTIVE_COLOR=$(cat "${DOCKER_DIR}/.active-color")
ACTIVE_SVC="app-${ACTIVE_COLOR}"

log "  → Recréation du conteneur app actif ($ACTIVE_SVC)..."
docker compose -f "${DOCKER_DIR}/docker-compose.yml" up -d --no-deps --force-recreate "$ACTIVE_SVC" 2>/dev/null && \
  log "  → $ACTIVE_SVC recréé ✓" || warn "  → $ACTIVE_SVC non recréé (le faire manuellement)"

# Ofelia : recréer pour recharger CRON_SECRET via env_file
docker compose -f "${DOCKER_DIR}/docker-compose.yml" up -d --no-deps --force-recreate ofelia 2>/dev/null && \
  log "  → Ofelia recréé ✓" || warn "  → Ofelia non recréé"

log ""
log "=== Rotation terminée ✓ ==="
log ""
warn "⚠  Tous les utilisateurs ont été déconnectés (AUTH_SECRET a changé)."
warn "⚠  Ils devront se reconnecter."
echo ""
log "Vérifications recommandées :"
log "  1. docker exec ecolemiriam-pgbouncer psql -U ecolemiriam_app -d ecolemiriam -h localhost -p 6432 -c 'SELECT 1;'"
log "  2. curl -sf https://ecolemiriam.com/api/health"
log "  3. Se connecter à l'app pour valider l'auth"
