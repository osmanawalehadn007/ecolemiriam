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
echo "=== 1/3 — Git pull ==="
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

# Pas de régénération PgBouncer userlist sur GCP (pas de PgBouncer)

# --- 2. Login GHCR ---
# Ordre : $GHCR_TOKEN_FILE, emplacement partagé, home (legacy).
# L'emplacement partagé est requis en OS Login : le SA se connecte en
# sa_<id>, dont le home n'est pas celui où le token a été écrit.
echo "=== 2/3 — Login GHCR ==="
GHCR_TOKEN_PATH=""
for f in "${GHCR_TOKEN_FILE:-}" /etc/ecolemiriam/ghcr-token ~/.config/ghcr-token; do
  if [ -n "$f" ] && [ -r "$f" ]; then
    GHCR_TOKEN_PATH="$f"
    break
  fi
done
if [ -n "$GHCR_TOKEN_PATH" ]; then
  docker login ghcr.io -u wilsan007 --password-stdin < "$GHCR_TOKEN_PATH"
else
  echo "ERREUR: Token GHCR introuvable (/etc/ecolemiriam/ghcr-token ou ~/.config/ghcr-token)"
  exit 1
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
