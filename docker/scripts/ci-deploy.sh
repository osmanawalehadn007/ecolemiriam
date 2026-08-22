#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# École Miriam — Wrapper de déploiement appelé par GitHub Actions
# ============================================================
#
# Ce script est appelé via SSH par le workflow deploy.yml.
# La clé SSH de déploiement est restreinte (authorized_keys) à ce
# script uniquement — pas de shell arbitraire possible.
#
# Étapes :
#   1. Git pull (avec stash des modifications locales du VPS)
#   2. Login GHCR
#   3. Délégation au script blue-green selon la phase
#
# Usage (depuis GitHub Actions) :
#   /opt/ecolemiriam/docker/scripts/ci-deploy.sh [phase]
#
# Phases :
#   staging   — déployer en staging seulement (slot inactif + smoke tests)
#   promote   — promouvoir le staging en production (bascule Caddy)
#   full      — staging + promotion en une fois (déploiement complet)
#   rollback  — rollback manuel (bascule vers l'ancien slot)
#   status    — afficher le statut blue-green
#   (vide)    — équivalent à "full"
# ============================================================

cd /opt/ecolemiriam

PHASE="${1:-full}"

echo "=== CI Deploy — phase: $PHASE ==="

# --- 1. Git pull ---
echo "=== 1/3 — Git pull ==="
# Stasher les modifications locales (docker-compose.yml a des changements
# spécifiques au VPS : backups, rclone, TLS postgres, etc.)
git stash 2>/dev/null || true
git pull origin main 2>&1
# Réappliquer les modifications locales du VPS
git stash pop 2>/dev/null || true

# --- 2. Login GHCR ---
echo "=== 2/3 — Login GHCR ==="
if [ -f ~/.config/ghcr-token ]; then
  cat ~/.config/ghcr-token | docker login ghcr.io -u wilsan007 --password-stdin
else
  echo "ERREUR: Token GHCR manquant (~/.config/ghcr-token)"
  exit 1
fi

# --- 3. Délégation au script blue-green ---
echo "=== 3/3 — Deploy (phase: $PHASE) ==="

case "$PHASE" in
  staging)
    # Déployer en staging seulement (slot inactif)
    # Le slot inactif reçoit la nouvelle image + healthcheck + smoke tests
    # Caddy n'est PAS basculé — la production reste sur le slot actif
    bash docker/scripts/blue-green-deploy.sh --staging-only
    ;;
  promote)
    # Promouvoir le staging en production (après approbation manuelle)
    # Bascule Caddy vers le slot inactif (qui contient la nouvelle image)
    bash docker/scripts/blue-green-deploy.sh --promote
    ;;
  full)
    # Déploiement complet : staging + promotion en une fois
    bash docker/scripts/blue-green-deploy.sh --full
    ;;
  rollback)
    bash docker/scripts/blue-green-deploy.sh --rollback
    ;;
  status)
    bash docker/scripts/blue-green-deploy.sh --status
    ;;
  *)
    echo "ERREUR: Phase inconnue: $PHASE"
    echo "Phases valides: staging, promote, full, rollback, status"
    exit 1
    ;;
esac
