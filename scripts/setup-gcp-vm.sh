#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# École Miriam — Setup GCP VM depuis le Mac
# ============================================================
#
# Ce script :
#   1. Récupère les secrets depuis le VPS Hetzner (SSH)
#   2. Les transfère vers la VM GCP (via IAP tunnel)
#   3. Clone le repo sur la VM GCP
#   4. Configure .env.production avec Supabase
#   5. Démarre la stack Docker
#
# Prérequis :
#   - gcloud auth login + gcloud config set project ecole-miriam
#   - Accès SSH au VPS Hetzner (scripts/start-vps-tunnel.sh)
#   - Docker installé sur la VM GCP
#
# Usage :
#   bash scripts/setup-gcp-vm.sh
# ============================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${GREEN}[$(date +%H:%M:%S)]${NC} $1"; }
info() { echo -e "${BLUE}[$(date +%H:%M:%S)]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()  { echo -e "${RED}[ERREUR]${NC} $1"; exit 1; }

# --- Config ---
GCP_INSTANCE="ecolpro-prod"
GCP_ZONE="us-central1-a"
GCP_PROJECT="ecole-miriam"
VPS_HOST="169.58.208.217"
VPS_USER="root"
VPS_SSH_PORT="${VPS_SSH_PORT:-22}"

# Supabase config
# ⚠️ AUCUNE URL en dur ici : le mot de passe de la base de production a été
# exposé dans l'historique Git de ce fichier. Actions requises :
#   1. révoquer/régénérer le mot de passe du rôle Supabase ;
#   2. exporter SUPABASE_DATABASE_URL / SUPABASE_DIRECT_URL avant d'appeler ce
#      script (elles sont aussi présentes dans /etc/ecolemirlam/app.env).
: "${SUPABASE_DATABASE_URL:?Définir SUPABASE_DATABASE_URL (pooler Supabase, port 6543)}"
: "${SUPABASE_DIRECT_URL:?Définir SUPABASE_DIRECT_URL (connexion directe, port 5432)}"

TMP_DIR="/tmp/ecolpro-gcp-setup"
mkdir -p "$TMP_DIR"

# ============================================================
# Étape 1 : Récupérer les secrets depuis le VPS Hetzner
# ============================================================
log "=== Étape 1/5 : Récupération des secrets depuis le VPS Hetzner ==="

info "Connexion SSH au VPS ($VPS_HOST)..."

# Tunnel SSH si nécessaire (port personnalisé)
SSH_CMD="ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=no -p $VPS_SSH_PORT $VPS_USER@$VPS_HOST"

# Récupérer les secrets un par un
info "  Récupération du token Cloudflare Tunnel..."
$SSH_CMD "cat /opt/ecolemiriam/docker/secrets/cloudflare_tunnel_token.txt" > "$TMP_DIR/cloudflare_tunnel_token.txt" 2>/dev/null || {
  warn "  Token Cloudflare Tunnel non trouvé sur le VPS"
  echo -n "  Colle le token manuellement : "
  read -r CF_TOKEN
  echo "$CF_TOKEN" > "$TMP_DIR/cloudflare_tunnel_token.txt"
}

info "  Récupération du token GHCR..."
$SSH_CMD "cat ~/.config/ghcr-token" > "$TMP_DIR/ghcr-token" 2>/dev/null || {
  warn "  Token GHCR non trouvé sur le VPS"
  echo -n "  Colle le token GHCR manuellement : "
  read -r GHCR_TOKEN
  echo "$GHCR_TOKEN" > "$TMP_DIR/ghcr-token"
}

info "  Récupération du AUTH_SECRET..."
$SSH_CMD "grep '^AUTH_SECRET=' /opt/ecolemiriam/.env.production | cut -d'=' -f2-" > "$TMP_DIR/auth_secret" 2>/dev/null || {
  warn "  AUTH_SECRET non trouvé sur le VPS"
  echo -n "  Colle le AUTH_SECRET manuellement : "
  read -r AUTH_SECRET
  echo "$AUTH_SECRET" > "$TMP_DIR/auth_secret"
}

info "  Récupération du REDIS_PASSWORD..."
$SSH_CMD "grep '^REDIS_PASSWORD=' /opt/ecolemiriam/.env.production | cut -d'=' -f2-" > "$TMP_DIR/redis_password" 2>/dev/null || {
  warn "  REDIS_PASSWORD non trouvé, génération d'un nouveau..."
  openssl rand -hex 24 > "$TMP_DIR/redis_password"
}

info "  Récupération du CRON_SECRET..."
$SSH_CMD "grep '^CRON_SECRET=' /opt/ecolemiriam/.env.production | cut -d'=' -f2-" > "$TMP_DIR/cron_secret" 2>/dev/null || {
  warn "  CRON_SECRET non trouvé, génération d'un nouveau..."
  openssl rand -hex 24 > "$TMP_DIR/cron_secret"
}

info "  Récupération du NEXTAUTH_SECRET..."
$SSH_CMD "grep '^NEXTAUTH_SECRET=' /opt/ecolemiriam/.env.production | cut -d'=' -f2-" > "$TMP_DIR/nextauth_secret" 2>/dev/null || {
  warn "  NEXTAUTH_SECRET non trouvé, utilisation de AUTH_SECRET..."
  cp "$TMP_DIR/auth_secret" "$TMP_DIR/nextauth_secret"
}

log "  → Secrets récupérés ✓"

# ============================================================
# Étape 2 : Préparer les fichiers à transférer
# ============================================================
log "=== Étape 2/5 : Préparation des fichiers de configuration ==="

# Créer .env.production pour GCP
AUTH_SECRET_VAL=$(cat "$TMP_DIR/auth_secret")
REDIS_PASSWORD_VAL=$(cat "$TMP_DIR/redis_password")
CRON_SECRET_VAL=$(cat "$TMP_DIR/cron_secret")
NEXTAUTH_SECRET_VAL=$(cat "$TMP_DIR/nextauth_secret")

cat > "$TMP_DIR/.env.production" << EOF
# ============================================================
# École Miriam — .env.production (GCP VM, DB sur Supabase)
# ============================================================

# --- Database (Supabase) ---
DATABASE_URL="$SUPABASE_DATABASE_URL"
DIRECT_URL="$SUPABASE_DIRECT_URL"

# --- Auth ---
AUTH_SECRET="$AUTH_SECRET_VAL"
AUTH_URL="https://ecolemiriam.com"
AUTH_TRUST_HOST=true
NEXTAUTH_SECRET="$NEXTAUTH_SECRET_VAL"
NEXTAUTH_URL="https://ecolemiriam.com"

# --- App ---
NEXT_PUBLIC_APP_URL="https://ecolemiriam.com"
NODE_ENV=production
RLS_ACTIVE=true

# --- Redis ---
REDIS_URL="redis://redis:6379"
REDIS_PASSWORD="$REDIS_PASSWORD_VAL"

# --- Cron ---
CRON_SECRET="$CRON_SECRET_VAL"

# --- Cloudflare Turnstile (si configuré) ---
# TURNSTILE_SECRET_KEY=""
# NEXT_PUBLIC_TURNSTILE_SITE_KEY=""
EOF

log "  → .env.production créé ✓"

# ============================================================
# Étape 3 : Transférer les fichiers vers la VM GCP
# ============================================================
log "=== Étape 3/5 : Transfert des fichiers vers la VM GCP ==="

GCP_SSH="gcloud compute ssh $GCP_INSTANCE --zone=$GCP_ZONE --project=$GCP_PROJECT --tunnel-through-iap"
GCP_SCP="gcloud compute scp --zone=$GCP_ZONE --project=$GCP_PROJECT --tunnel-through-iap"

info "  Création du répertoire /opt/ecolemiriam sur la VM..."
$GCP_SSH --command="sudo mkdir -p /opt/ecolemiriam && sudo chown -R \$(whoami):\$(whoami) /opt/ecolemiriam"

info "  Transfert du token GHCR..."
$GCP_SCP "$TMP_DIR/ghcr-token" "$GCP_INSTANCE:~/.config/ghcr-token" 2>/dev/null || {
  $GCP_SSH --command="mkdir -p ~/.config"
  $GCP_SCP "$TMP_DIR/ghcr-token" "$GCP_INSTANCE:~/.config/ghcr-token"
}

info "  Transfert du token Cloudflare Tunnel..."
$GCP_SCP "$TMP_DIR/cloudflare_tunnel_token.txt" "$GCP_INSTANCE:/tmp/cloudflare_tunnel_token.txt"

info "  Transfert du .env.production..."
$GCP_SCP "$TMP_DIR/.env.production" "$GCP_INSTANCE:/tmp/.env.production"

log "  → Fichiers transférés ✓"

# ============================================================
# Étape 4 : Cloner le repo et configurer sur la VM GCP
# ============================================================
log "=== Étape 4/5 : Clonage du repo et configuration ==="

info "  Clonage du repo..."
$GCP_SSH --command="cd /opt/ecolemiriam && git clone https://github.com/osmanawalehadn007/ecolemiriam.git . 2>/dev/null || (cd /opt/ecolemiriam && git pull origin main)"

info "  Installation du .env.production..."
$GCP_SSH --command="cp /tmp/.env.production /opt/ecolemiriam/.env.production"

info "  Installation du token Cloudflare Tunnel..."
$GCP_SSH --command="mkdir -p /opt/ecolemiriam/docker/secrets && cp /tmp/cloudflare_tunnel_token.txt /opt/ecolemiriam/docker/secrets/cloudflare_tunnel_token.txt && chmod 600 /opt/ecolemiriam/docker/secrets/cloudflare_tunnel_token.txt"

info "  Création des fichiers upstream Caddy (bug Docker mount)..."
$GCP_SSH --command="cd /opt/ecolemiriam/docker/caddy && cp upstream.conf.example upstream.conf && cp upstream.conf.example upstream-simple.conf"

info "  Login GHCR..."
$GCP_SSH --command="cat ~/.config/ghcr-token | docker login ghcr.io -u osmanawalehadn007 --password-stdin"

log "  → Repo cloné et configuré ✓"

# ============================================================
# Étape 5 : Démarrer la stack Docker
# ============================================================
log "=== Étape 5/5 : Démarrage de la stack Docker ==="

info "  Build de l'image Caddy..."
$GCP_SSH --command="cd /opt/ecolemiriam/docker && docker compose -f docker-compose.gcp.yml build caddy"

info "  Pull de l'image app depuis GHCR..."
$GCP_SSH --command="cd /opt/ecolemiriam/docker && docker compose -f docker-compose.gcp.yml pull app-blue app-green"

info "  Démarrage de la stack..."
$GCP_SSH --command="cd /opt/ecolemiriam/docker && docker compose -f docker-compose.gcp.yml up -d"

info "  Attente du healthcheck (60s)..."
sleep 60

info "  Vérification des conteneurs..."
$GCP_SSH --command="docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' | head -20"

log ""
log "=== Setup terminé ✓ ==="
log ""
log "Prochaines étapes :"
log "  1. Vérifier que l'app répond : gcloud compute ssh $GCP_INSTANCE --zone=$GCP_ZONE --project=$GCP_PROJECT --tunnel-through-iap --command='curl -s http://localhost:3000/api/health'"
log "  2. Arrêter le cloudflared du VPS Hetzner : ssh root@$VPS_HOST 'docker stop ecolemiriam-cloudflared'"
log "  3. Le tunnel Cloudflare basculera automatiquement vers la VM GCP"
log "  4. Tester : curl -I https://ecolemiriam.com"
log ""
log "Connexion SSH à la VM :"
log "  gcloud compute ssh $GCP_INSTANCE --zone=$GCP_ZONE --project=$GCP_PROJECT --tunnel-through-iap"
