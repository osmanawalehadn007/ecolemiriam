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
#   3. deploy.sh (backup + pull image + restart + healthcheck + rollback)
# ============================================================

cd /opt/ecolemiriam

echo "=== 1/3 — Git pull ==="
# Stasher les modifications locales (docker-compose.yml a des changements
# spécifiques au VPS : backups, rclone, TLS postgres, etc.)
git stash 2>/dev/null || true
git pull origin main 2>&1
# Réappliquer les modifications locales du VPS
git stash pop 2>/dev/null || true

echo "=== 2/3 — Login GHCR ==="
if [ -f ~/.config/ghcr-token ]; then
  cat ~/.config/ghcr-token | docker login ghcr.io -u wilsan007 --password-stdin
else
  echo "ERREUR: Token GHCR manquant (~/.config/ghcr-token)"
  exit 1
fi

echo "=== 3/3 — Deploy ==="
bash docker/scripts/deploy.sh
