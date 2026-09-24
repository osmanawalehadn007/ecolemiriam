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
# Les fichiers générés par blue-green-deploy.sh (upstream.conf,
# upstream-simple.conf, ofelia/config.ini) sont dans .gitignore → git stash
# ne les touche plus, fini la course silencieuse.
#
# On ne stasher QUE les fichiers tracked modifiés (--keep-index implicite
# via `git stash` sans -u). Les fichiers untracked (backups, .sql, .bak)
# sont ignorés par .gitignore et ne doivent pas entrer dans le stash.
# Avant, `git stash` sans précaution pouvait capturer des untracked et
# faire échouer `git stash pop` avec "would be overwritten" → déploiement
# bloqué pendant des heures.
STASHED=false
if git diff --quiet 2>/dev/null && git diff --cached --quiet 2>/dev/null; then
  echo "  Aucune modification locale à stasher."
else
  echo "  Stash des modifications locales (tracked uniquement)..."
  if git stash push -m "ci-deploy: $(date -u +%Y-%m-%dT%H:%M:%SZ)" 2>&1; then
    STASHED=true
  else
    echo "  ATTENTION: git stash a échoué — on continue sans stasher."
    echo "  Les fichiers locaux non-commités peuvent être écrasés par git pull."
  fi
fi

git pull origin main 2>&1

# Réappliquer les modifications locales du VPS
# En cas de conflit, on refuse le stash pop mais on NE s'arrête PAS
# On force un reset dur au remote pour avoir un état cohérent
if [ "$STASHED" = "true" ]; then
  if ! git stash pop 2>&1; then
    echo ""
    echo "ATTENTION: git stash pop a échoué (conflit détecté)"
    echo "→ Stratégie de fallback: force reset vers origin/main"
    echo ""
    git reset --hard origin/main
    git stash drop 2>&1 || true
    echo "Le stash a été supprimé. État repository = origin/main"
  fi
fi

# Régénérer le userlist PgBouncer avec les hashes réels depuis pg_authid.
# Le fichier est dans .gitignore et non-tracké : git pull peut écraser la
# version du repo (placeholder) ou la supprimer du tracking. On la régénère
# systématiquement après le pull pour que PgBouncer ait les bons hashes.
if [ -f docker/scripts/generate-pgbouncer-userlist.sh ]; then
  echo "  Régénération du userlist PgBouncer..."
  bash docker/scripts/generate-pgbouncer-userlist.sh 2>&1 || true
fi

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
