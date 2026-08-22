#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# École Miriam — Déploiement sur le VPS (pull depuis GHCR)
# ============================================================
#
# Le build se fait maintenant sur GitHub Actions (workflow deploy.yml).
# Ce script pull l'image pré-construite depuis GHCR et la déploie.
#
# Étapes :
#   1. Backup de la base avant déploiement (safety net)
#   2. Login GHCR (si token présent)
#   3. Pull de la nouvelle image depuis GHCR
#   4. Sauvegarde de l'image actuelle comme "previous"
#   5. Déploiement de la nouvelle image
#   6. Healthcheck (rollback auto si échec)
#   7. Nettoyage
#
# Usage :
#   ./docker/scripts/deploy.sh              # déploiement normal (pull GHCR)
#   ./docker/scripts/deploy.sh --rollback   # rollback manuel
#   ./docker/scripts/deploy.sh --build      # build local (fallback, lent)
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
COMPOSE_FILE="${DOCKER_DIR}/docker-compose.yml"

# Image GHCR (construite par GitHub Actions)
GHCR_IMAGE="ghcr.io/wilsan007/ecolemiriam-app:latest"

cd "$DOCKER_DIR"

# --- Mode rollback ---
if [ "${1:-}" = "--rollback" ]; then
  log "=== ROLLBACK ==="
  if docker image inspect ecolemiriam-app:previous &>/dev/null; then
    docker tag ecolemiriam-app:previous "${GHCR_IMAGE}"
    docker compose -f "$COMPOSE_FILE" up -d --no-deps --pull never app
    log "Rollback terminé. Vérifier : docker exec ecolemiriam-app curl -f http://localhost:3000/api/health"
  else
    err "Aucune image précédente (ecolemiriam-app:previous) trouvée"
  fi
  exit 0
fi

# --- Mode build local (fallback) ---
if [ "${1:-}" = "--build" ]; then
  log "=== BUILD LOCAL (fallback lent) ==="
  log "1/6 — backup pré-déploiement..."
  docker exec ecolemiriam-pgbackrest pgbackrest --stanza=ecolemiriam --type=incr backup 2>/dev/null || warn "Backup a échoué — continuer"

  log "2/6 — build de l'image Next.js..."
  DOCKER_BUILDKIT=1 docker build -t "${GHCR_IMAGE}" "$PROJECT_DIR" -f "${DOCKER_DIR}/app/Dockerfile"

  if docker image inspect "${GHCR_IMAGE}" &>/dev/null; then
    docker tag "${GHCR_IMAGE}" ecolemiriam-app:previous
    log "  → image actuelle sauvegardée comme ecolemiriam-app:previous"
  fi

  log "3/6 — déploiement..."
  docker compose -f "$COMPOSE_FILE" up -d --no-deps --pull never app

  log "4/6 — healthcheck (60s max)..."
  HEALTH_OK=false
  for i in $(seq 1 12); do
    if docker exec ecolemiriam-app curl -sf http://localhost:3000/api/health 2>/dev/null; then
      HEALTH_OK=true
      break
    fi
    sleep 5
  done

  if [ "$HEALTH_OK" = "false" ]; then
    err "Healthcheck échoué — ROLLBACK AUTOMATIQUE"
    docker tag ecolemiriam-app:previous "${GHCR_IMAGE}"
    docker compose -f "$COMPOSE_FILE" up -d --no-deps --pull never app
    warn "Rollback effectué."
    exit 1
  fi

  log "  → healthcheck OK ✓"
  docker image prune -f >/dev/null 2>&1 || true
  log "=== Déploiement terminé ✓ ==="
  exit 0
fi

# --- Mode normal : pull depuis GHCR ---

# 1. Backup pré-déploiement
log "1/7 — backup pré-déploiement..."
docker exec ecolemiriam-pgbackrest pgbackrest --stanza=ecolemiriam --type=incr backup 2>/dev/null || warn "Backup a échoué — continuer"

# 2. Login GHCR
log "2/7 — login GHCR..."
if [ -f ~/.config/ghcr-token ]; then
  cat ~/.config/ghcr-token | docker login ghcr.io -u wilsan007 --password-stdin
else
  err "Token GHCR manquant (~/.config/ghcr-token). Lancer : docker/scripts/setup-vps-ghcr.sh"
fi

# 3. Pull nouvelle image
log "3/7 — pull de la nouvelle image depuis GHCR..."
docker pull "${GHCR_IMAGE}"

# 4. Sauvegarder l'image actuelle
if docker image inspect "${GHCR_IMAGE}" &>/dev/null; then
  docker tag "${GHCR_IMAGE}" ecolemiriam-app:previous
  log "  → image actuelle sauvegardée comme ecolemiriam-app:previous"
fi

# 5. Déployer
# --no-deps : ne pas toucher aux dépendances (postgres, pgbouncer déjà en cours)
# --pull never : l'image a déjà été pull à l'étape 3, ne pas re-télécharger
log "4/7 — déploiement..."
docker compose -f "$COMPOSE_FILE" up -d --no-deps --pull never app

# 6. Healthcheck
log "5/7 — healthcheck (60s max)..."
HEALTH_OK=false
for i in $(seq 1 12); do
  if docker exec ecolemiriam-app curl -sf http://localhost:3000/api/health 2>/dev/null; then
    HEALTH_OK=true
    break
  fi
  sleep 5
done

if [ "$HEALTH_OK" = "false" ]; then
  err "Healthcheck échoué — ROLLBACK AUTOMATIQUE"
  docker tag ecolemiriam-app:previous "${GHCR_IMAGE}"
  docker compose -f "$COMPOSE_FILE" up -d --no-deps --pull never app
  warn "Rollback effectué."
  warn "Logs : docker logs ecolemiriam-app --tail 50"
  exit 1
fi

log "  → healthcheck OK ✓"

# 7. Nettoyage
log "6/7 — nettoyage..."
docker image prune -f >/dev/null 2>&1 || true

log "7/7 — terminé ✓"
log ""
log "=== Déploiement terminé ✓ ==="
log ""
log "Vérifications :"
log "  • App : docker exec ecolemiriam-app curl -f http://localhost:3000/api/health"
log "  • Logs : docker logs ecolemiriam-app --tail 20 -f"
log "  • Rollback : $0 --rollback"
log "  • Build local (fallback) : $0 --build"
