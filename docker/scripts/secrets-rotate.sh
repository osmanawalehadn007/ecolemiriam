#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# EcolPro — Rotation des secrets SOPS
# ============================================================
#
# Régénère tous les secrets (sauf le token Cloudflare) et
# rechiffre le fichier SOPS.
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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SECRETS_DIR="${DOCKER_DIR}/secrets"
AGE_KEY_FILE="${DOCKER_DIR}/keys/age-key.txt"

[ -f "$AGE_KEY_FILE" ] || { echo "Erreur: $AGE_KEY_FILE introuvable"; exit 1; }

log "=== Rotation des secrets ==="

# Régénérer les secrets (sauf Cloudflare token)
OWNER_PASS=$(openssl rand -base64 32 | tr -d '/+=' | head -c 32)
echo -n "$OWNER_PASS" > "$SECRETS_DIR/postgres_owner_password.txt"

APP_PASS=$(openssl rand -base64 32 | tr -d '/+=' | head -c 32)
echo -n "$APP_PASS" > "$SECRETS_DIR/postgres_app_password.txt"

AUTH_SECRET=$(openssl rand -base64 32)
echo -n "$AUTH_SECRET" > "$SECRETS_DIR/auth_secret.txt"

CRON_SECRET=$(openssl rand -hex 32)
echo -n "$CRON_SECRET" > "$SECRETS_DIR/cron_secret.txt"

PGBACKREST_KEY=$(openssl rand -hex 32)
echo -n "$PGBACKREST_KEY" > "$SECRETS_DIR/pgbackrest_cipher_pass.txt"

chmod 600 "$SECRETS_DIR"/*.txt

# Recréer et chiffrer secrets.yaml
SECRETS_YAML="${SECRETS_DIR}/secrets.yaml"
cat > "$SECRETS_YAML" <<EOF
postgres_owner_password: $(cat "$SECRETS_DIR/postgres_owner_password.txt")
postgres_app_password: $(cat "$SECRETS_DIR/postgres_app_password.txt")
auth_secret: $(cat "$SECRETS_DIR/auth_secret.txt")
cron_secret: $(cat "$SECRETS_DIR/cron_secret.txt")
cloudflare_tunnel_token: $(cat "$SECRETS_DIR/cloudflare_tunnel_token.txt")
pgbackrest_cipher_pass: $(cat "$SECRETS_DIR/pgbackrest_cipher_pass.txt")
EOF

SOPS_AGE_KEY_FILE="$AGE_KEY_FILE" sops --encrypt --in-place "$SECRETS_YAML" 2>/dev/null || warn "SOPS encrypt a échoué"

log "  → secrets rotés et rechiffrés ✓"
log ""
warn "⚠  Après rotation, redémarrer la stack :"
warn "   cd docker && docker compose down && docker compose up -d"
warn "⚠  Mettre à jour .env.production avec les nouvelles valeurs"
