#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# École Miriam — Setup VPS pour GHCR + déploiement GitHub Actions
# ============================================================
#
# Ce script configure le VPS pour :
#   1. Authentification à GitHub Container Registry (pull images)
#   2. Clé SSH dédiée pour le déploiement depuis GitHub Actions
#
# À exécuter UNE SEULE FOIS sur le VPS :
#   bash docker/scripts/setup-vps-ghcr.sh
#
# Prérequis :
#   - Un Personal Access Token (PAT) GitHub avec scope read:packages
#   - (Créer sur : https://github.com/settings/tokens?type=beta)
#   - Le token doit avoir accès au package ghcr.io/osmanawalehadn007/ecolemiriam-app
#
# Après ce script, configurer les GitHub Secrets (voir DEPLOYMENT-CI.md)
# ============================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[$(date -u +%H:%M:%S)]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()  { echo -e "${RED}[ERREUR]${NC} $1"; exit 1; }

# --- 1. Token GHCR ---
log "=== 1/3 — Configuration du token GHCR ==="

if [ -f ~/.config/ghcr-token ]; then
  warn "Le token GHCR existe déjà (~/.config/ghcr-token)."
  read -p "Le remplacer ? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    log "Token conservé."
  else
    read -s -p "Collez le PAT GitHub (scope read:packages) : " GHCR_TOKEN
    echo
    mkdir -p ~/.config
    echo -n "$GHCR_TOKEN" > ~/.config/ghcr-token
    chmod 600 ~/.config/ghcr-token
    log "Token GHCR sauvegardé."
  fi
else
  echo "Créez un PAT sur : https://github.com/settings/tokens?type=beta"
  echo "  - Scope : read:packages"
  echo "  - Accès au package : ghcr.io/osmanawalehadn007/ecolemiriam-app"
  echo ""
  read -s -p "Collez le PAT GitHub : " GHCR_TOKEN
  echo
  mkdir -p ~/.config
  echo -n "$GHCR_TOKEN" > ~/.config/ghcr-token
  chmod 600 ~/.config/ghcr-token
  log "Token GHCR sauvegardé."
fi

# Tester le login
log "Test du login GHCR..."
if cat ~/.config/ghcr-token | docker login ghcr.io -u osmanawalehadn007 --password-stdin 2>/dev/null; then
  log "  → Login GHCR OK ✓"
else
  err "Login GHCR échoué. Vérifiez le token et les scopes."
fi

# --- 2. Clé SSH de déploiement ---
log "=== 2/3 — Clé SSH de déploiement ==="

DEPLOY_KEY=~/.ssh/deploy_ed25519

if [ -f "$DEPLOY_KEY" ]; then
  warn "La clé SSH de déploiement existe déjà ($DEPLOY_KEY)."
  log "Clé publique à ajouter dans GitHub Secrets (VPS_SSH_PRIVATE_KEY) :"
  log "  (la clé PRIVÉE est $DEPLOY_KEY)"
else
  log "Génération d'une clé SSH dédiée au déploiement..."
  mkdir -p ~/.ssh
  ssh-keygen -t ed25519 -f "$DEPLOY_KEY" -N "" -C "github-actions-deploy@ecolemiriam"
  chmod 600 "$DEPLOY_KEY"
  log "  → Clé générée : $DEPLOY_KEY"
fi

# Ajouter la clé publique aux authorized_keys (restreinte à docker deploy)
PUB_KEY=$(cat "${DEPLOY_KEY}.pub")
AUTH_FILE=~/.ssh/authorized_keys

if grep -q "github-actions-deploy" "$AUTH_FILE" 2>/dev/null; then
  log "  → Clé publique déjà dans authorized_keys"
else
  # Restriction : cette clé ne peut exécuter que des commandes liées au déploiement
  # Commande forcée : seul le déploiement est autorisé (pas de shell arbitraire)
  echo "command=\"cd /opt/ecolemiriam && bash docker/scripts/deploy.sh\",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty $PUB_KEY" >> "$AUTH_FILE"
  log "  → Clé publique ajoutée à authorized_keys (avec restriction de commande)"
  warn "NOTE : La clé est restreinte à 'deploy.sh'. Pour un déploiement plus flexible,"
  warn "      éditez ~/.ssh/authorized_keys et retirez la restriction 'command=...'."
fi

# --- 3. Vérification ---
log "=== 3/3 — Vérification ==="
log ""
log "Setup terminé ✓"
log ""
log "Prochaines étapes :"
log ""
log "1. Récupérez la clé PRIVÉE pour GitHub Secrets :"
log "   cat $DEPLOY_KEY"
log "   → Ajoutez-la dans GitHub → Settings → Secrets → VPS_SSH_PRIVATE_KEY"
log ""
log "2. Configurez les GitHub Secrets suivants :"
log "   VPS_HOST          = $(hostname -I 2>/dev/null | awk '{print $1}' || echo 'IP_DU_VPS')"
log "   VPS_USER          = $(whoami)"
log "   VPS_SSH_PORT      = 22 (ou votre port SSH)"
log "   VPS_SSH_PRIVATE_KEY = (contenu de $DEPLOY_KEY)"
log ""
log "3. Le premier push sur main déclenchera le build + déploiement automatique."
log ""
log "Documentation complète : docker/DEPLOYMENT-CI.md"
