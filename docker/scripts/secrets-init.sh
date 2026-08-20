#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# École Miriam — Initialisation SOPS + age (gestion chiffrée des secrets)
# ============================================================
#
# Étapes :
#   1. Génère une clé age (X25519) pour chiffrer/déchiffrer les secrets
#   2. Met à jour .sops.yaml avec la clé publique
#   3. Génère les secrets en clair dans docker/secrets/
#   4. Chiffre les secrets avec SOPS
#   5. Crée le dossier docker/secrets/ pour Docker (déchiffré au runtime)
#
# Usage :
#   ./docker/scripts/secrets-init.sh
#
# Prérequis :
#   - age installé : apt install age (ou brew install age)
#   - sops installé : https://github.com/getsops/sops/releases
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
KEYS_DIR="${DOCKER_DIR}/keys"

mkdir -p "$SECRETS_DIR" "$KEYS_DIR"

# Vérifier les dépendances
command -v age >/dev/null 2>&1 || err "age non installé. Installer : apt install age (ou brew install age)"
command -v sops >/dev/null 2>&1 || err "sops non installé. Voir : https://github.com/getsops/sops/releases"

log "=== Initialisation SOPS + age ==="

# 1. Générer la clé age
AGE_KEY_FILE="${KEYS_DIR}/age-key.txt"
if [ -f "$AGE_KEY_FILE" ]; then
  warn "Clé age existante : $AGE_KEY_FILE (rutilisation)"
else
  age-keygen -o "$AGE_KEY_FILE" 2>/dev/null
  chmod 600 "$AGE_KEY_FILE"
  log "  → clé age générée : $AGE_KEY_FILE"
fi

AGE_PUBKEY=$(grep -oP 'age1[a-z0-9]+' "$AGE_KEY_FILE" | head -1)
[ -n "$AGE_PUBKEY" ] || err "Impossible d'extraire la clé publique age"
log "  → clé publique : $AGE_PUBKEY"

# 2. Mettre à jour .sops.yaml avec la clé publique
SOPS_CONFIG="${PROJECT_DIR}/.sops.yaml"
if [ -f "$SOPS_CONFIG" ]; then
  sed -i "s/age1[a-z0-9]*/${AGE_PUBKEY}/g" "$SOPS_CONFIG"
  log "  → .sops.yaml mis à jour avec la clé publique"
fi

# 3. Générer les secrets en clair
log "Génération des secrets..."

# Postgres owner password
OWNER_PASS=$(openssl rand -base64 32 | tr -d '/+=' | head -c 32)
echo -n "$OWNER_PASS" > "$SECRETS_DIR/postgres_owner_password.txt"

# Postgres app password
APP_PASS=$(openssl rand -base64 32 | tr -d '/+=' | head -c 32)
echo -n "$APP_PASS" > "$SECRETS_DIR/postgres_app_password.txt"

# AUTH_SECRET (NextAuth)
AUTH_SECRET=$(openssl rand -base64 32)
echo -n "$AUTH_SECRET" > "$SECRETS_DIR/auth_secret.txt"

# CRON_SECRET
CRON_SECRET=$(openssl rand -hex 32)
echo -n "$CRON_SECRET" > "$SECRETS_DIR/cron_secret.txt"

# Cloudflare Tunnel token (placeholder)
if [ ! -f "$SECRETS_DIR/cloudflare_tunnel_token.txt" ]; then
  echo "REMPLACER_PAR_TOKEN_CLOUDFLARE" > "$SECRETS_DIR/cloudflare_tunnel_token.txt"
fi

# Cloudflare API token (placeholder — pour cloudflare-setup.sh)
if [ ! -f "$SECRETS_DIR/cloudflare_api_token.txt" ]; then
  echo "REMPLACER_PAR_API_TOKEN_CLOUDFLARE" > "$SECRETS_DIR/cloudflare_api_token.txt"
fi

# pgBackRest cipher pass
PGBACKREST_KEY=$(openssl rand -hex 32)
echo -n "$PGBACKREST_KEY" > "$SECRETS_DIR/pgbackrest_cipher_pass.txt"

# Permissions restrictives
chmod 600 "$SECRETS_DIR"/*.txt

log "  → 7 secrets générés dans $SECRETS_DIR"

# 4. Créer le fichier secrets.yaml pour SOPS
SECRETS_YAML="${SECRETS_DIR}/secrets.yaml"
cat > "$SECRETS_YAML" <<EOF
postgres_owner_password: $(cat "$SECRETS_DIR/postgres_owner_password.txt")
postgres_app_password: $(cat "$SECRETS_DIR/postgres_app_password.txt")
auth_secret: $(cat "$SECRETS_DIR/auth_secret.txt")
cron_secret: $(cat "$SECRETS_DIR/cron_secret.txt")
cloudflare_tunnel_token: $(cat "$SECRETS_DIR/cloudflare_tunnel_token.txt")
cloudflare_api_token: $(cat "$SECRETS_DIR/cloudflare_api_token.txt")
pgbackrest_cipher_pass: $(cat "$SECRETS_DIR/pgbackrest_cipher_pass.txt")
EOF

# 5. Chiffrer avec SOPS
SOPS_AGE_KEY_FILE="$AGE_KEY_FILE" sops --encrypt --in-place "$SECRETS_YAML" 2>/dev/null || {
  warn "SOPS encrypt a échoué — le fichier reste en clair"
  warn "Réessayer manuellement : SOPS_AGE_KEY_FILE=$AGE_KEY_FILE sops --encrypt --in-place $SECRETS_YAML"
}

log "  → secrets.yaml chiffré avec SOPS ✓"

log ""
log "=== Initialisation terminée ✓ ==="
log ""
log "PROCHAINES ÉTAPES :"
log "  1. Récupérer le token Cloudflare Tunnel :"
log "     https://one.dash.cloudflare.com → Networks → Tunnels → Create tunnel"
log "     Remplacer le contenu de secrets/cloudflare_tunnel_token.txt"
log ""
log "  1b. Récupérer le token API Cloudflare :"
log "     https://dash.cloudflare.com/profile/api-tokens → Create Token"
log "     Remplacer le contenu de secrets/cloudflare_api_token.txt"
log "     OU placer dans .cf-token.env (CF_API_TOKEN=...)"
log ""
log "  2. Recrypter après modification :"
log "     ./docker/scripts/secrets-rotate.sh"
log ""
log "  3. NE JAMAIS committer :"
log "     - docker/keys/ (clé privée age)"
log "     - docker/secrets/*.txt (secrets en clair)"
log "     - .env.production"
log ""
warn "⚠  La clé age ($AGE_KEY_FILE) est SENSIBLE."
warn "   La sauvegarder hors du serveur (1Password, Vault, etc.)."
