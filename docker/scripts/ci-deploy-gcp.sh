#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# École Miriam — Wrapper de déploiement GCP (via IAP)
# ============================================================
#
# Version GCP de ci-deploy.sh. Différences avec la version VPS :
#   - Utilise docker-compose.gcp.yml (sans postgres/pgbouncer/pgbackrest)
#   - Skip PgBouncer userlist (pas de PgBouncer sur GCP)
#   - RLS est sur Supabase, appliqué via migration_rls_supabase.sql
#   - DB sur Supabase, pas de backup pgBackRest local
#
# Ce script est exécuté SUR la VM GCP (via IAP tunnel depuis GitHub Actions).
#
# Usage :
#   /opt/ecolemiriam/docker/scripts/ci-deploy-gcp.sh [phase]
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

echo "=== CI Deploy GCP — phase: $PHASE ==="

# --- 1. Git pull ---
# Le workflow CI synchronise le dépôt dans une étape distincte, AVANT d'invoquer
# ce script, et passe CI_SKIP_GIT_SYNC=1. Sans cela le `git pull` réécrirait ce
# fichier pendant que bash le lit au fil de l'eau : l'exécution en cours
# continuerait sur l'ancienne logique, voire à un décalage incohérent.
# En invocation manuelle la variable est absente et le pull a lieu comme avant.
echo "=== 1/3 — Git pull ==="
if [ "${CI_SKIP_GIT_SYNC:-0}" = "1" ]; then
  echo "  Ignoré — dépôt déjà synchronisé par le workflow."
else
  STASHED=false
  if git diff --quiet 2>/dev/null && git diff --cached --quiet 2>/dev/null; then
    echo "  Aucune modification locale à stasher."
  else
    echo "  Stash des modifications locales (tracked uniquement)..."
    if git stash push -m "ci-deploy-gcp: $(date -u +%Y-%m-%dT%H:%M:%SZ)" 2>&1; then
      STASHED=true
    else
      echo "  ATTENTION: git stash a échoué — on continue sans stasher."
    fi
  fi
  git pull origin main 2>&1
  if [ "$STASHED" = "true" ]; then
    if ! git stash pop 2>&1; then
      echo "ERREUR: git stash pop a échoué (conflit). Stash conservé."
      echo "Résoudre manuellement : cd /opt/ecolemiriam && git stash pop"
      exit 1
    fi
  fi
fi

# Pas de régénération PgBouncer userlist sur GCP (pas de PgBouncer)

# --- 2. Login GHCR ---
# Deux sources, dans cet ordre :
#
#   1. `GHCR_LOGIN_STDIN=1` : les identifiants (« <utilisateur> <jeton> » sur
#      UNE ligne) arrivent par l'entrée standard. C'est le chemin de la CI : le
#      workflow transmet le GITHUB_TOKEN éphémère du job (`packages: read`,
#      invalidé à la fin du run, lié à ce dépôt). Rien à faire tourner, rien
#      qui expire un jour sans prévenir. Le login est confiné à un
#      DOCKER_CONFIG temporaire : le trousseau de l'opérateur n'est ni lu ni
#      écrasé, et aucun jeton ne reste sur la VM.
#   2. Sinon, le PAT des fichiers ci-dessous. Chemin MANUEL, pour un humain qui
#      lance le script sur la VM.
#
# Pourquoi la source 1 existe : un PAT classique a une échéance (30 jours par
# défaut). Celui de /etc/ecolemiriam/ghcr-token (`ghp_…`, écrit le 30/08/2026)
# a expiré le 30/09/2026 et le déploiement s'est arrêté sur
# « Error response from daemon: Get "https://ghcr.io/v2/": denied: denied » —
# même panne programmée que le jeton git de la synchronisation.
echo "=== 2/3 — Login GHCR ==="
if [ "${GHCR_LOGIN_STDIN:-0}" = "1" ]; then
  read -r GHCR_USER GHCR_TOKEN || true
  if [ -z "${GHCR_TOKEN:-}" ]; then
    echo "ERREUR: GHCR_LOGIN_STDIN=1 attend « <utilisateur> <jeton> » sur l'entrée standard."
    exit 1
  fi
  GHCR_DOCKER_CONFIG="$(mktemp -d)"
  export DOCKER_CONFIG="$GHCR_DOCKER_CONFIG"
  trap 'rm -rf "$GHCR_DOCKER_CONFIG"' EXIT
  printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin >/dev/null
  unset GHCR_TOKEN
  # Prévient les scripts délégués (blue-green) : la session est déjà établie,
  # ils ne doivent PAS refaire un login avec le PAT local — celui-ci a expiré
  # le 30/09/2026 et faisait échouer la phase staging malgré la CI authentifiée.
  export GHCR_AUTH_READY=1
  echo "  Connecté avec le jeton éphémère du workflow (config Docker temporaire)."
else
  GHCR_TOKEN_PATH=""
  for f in "${GHCR_TOKEN_FILE:-}" /etc/ecolemiriam/ghcr-token ~/.config/ghcr-token; do
    if [ -n "$f" ] && [ -r "$f" ]; then
      GHCR_TOKEN_PATH="$f"
      break
    fi
  done
  if [ -n "$GHCR_TOKEN_PATH" ]; then
    docker login ghcr.io -u osmanawalehadn007 --password-stdin < "$GHCR_TOKEN_PATH" >/dev/null
    echo "  Connecté avec $GHCR_TOKEN_PATH."
  else
    echo "ERREUR: Token GHCR introuvable (/etc/ecolemiriam/ghcr-token ou ~/.config/ghcr-token)"
    exit 1
  fi
fi

# --- 3. Délégation au script blue-green GCP ---
echo "=== 3/3 — Deploy GCP (phase: $PHASE) ==="

case "$PHASE" in
  staging)
    bash docker/scripts/blue-green-deploy-gcp.sh --staging-only
    ;;
  promote)
    bash docker/scripts/blue-green-deploy-gcp.sh --promote
    ;;
  full)
    bash docker/scripts/blue-green-deploy-gcp.sh --full
    ;;
  rollback)
    bash docker/scripts/blue-green-deploy-gcp.sh --rollback
    ;;
  status)
    bash docker/scripts/blue-green-deploy-gcp.sh --status
    ;;
  *)
    echo "ERREUR: Phase inconnue: $PHASE"
    echo "Phases valides: staging, promote, full, rollback, status"
    exit 1
    ;;
esac
