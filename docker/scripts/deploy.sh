#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# EcolPro — Déploiement automatisé sur le VPS
# ============================================================
#
# Étapes :
#   1. Backup de la base avant déploiement (safety net)
#   2. Build de la nouvelle image Docker
#   3. Sauvegarde de l'image actuelle comme "previous"
#   4. Déploiement de la nouvelle image
#   5. Healthcheck (rollback auto si échec)
#   6. Nettoyage
#
# Usage :
#   ./docker/scripts/deploy.sh              # déploiement normal
#   ./docker/scripts/deploy.sh --rollback   # rollback manuel
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

cd "$DOCKER_DIR"

# --- Mode rollback ---
if [ "${1:-}" = "--rollback" ]; then
  log "=== ROLLBACK ==="
  if docker image inspect ecolpro-app:previous &>/dev/null; then
    docker tag ecolpro-app:previous ecolpro-app:latest
    docker compose -f "$COMPOSE_FILE" up -d app
    log "Rollback terminé. Vérifier : docker exec ecolpro-app curl -f http://localhost:3000/api/health"
  else
    err "Aucune image précédente (ecolpro-app:previous) trouvée"
  fi
  exit 0
fi

# 1. Backup pré-déploiement
log "1/5 — backup pré-déploiement..."
docker exec ecolpro-pgbackrest pgbackrest --stanza=ecolpro --type=incr backup 2>/dev/null || warn "Backup a échoué — continuer"

# 2. Build
log "2/5 — build de l'image Next.js..."
docker build -t ecolpro-app:new "$PROJECT_DIR" -f "${DOCKER_DIR}/app/Dockerfile"

# 3. Sauvegarder l'image actuelle
if docker image inspect ecolpro-app:latest &>/dev/null; then
  docker tag ecolpro-app:latest ecolpro-app:previous
  log "  → image actuelle sauvegardée comme ecolpro-app:previous"
fi

# 4. Déployer
log "3/5 — déploiement..."
docker tag ecolpro-app:new ecolpro-app:latest
docker compose -f "$COMPOSE_FILE" up -d app

# 5. Healthcheck
log "4/5 — healthcheck (60s max)..."
HEALTH_OK=false
for i in $(seq 1 12); do
  if docker exec ecolpro-app curl -sf http://localhost:3000/api/health 2>/dev/null; then
    HEALTH_OK=true
    break
  fi
  sleep 5
done

if [ "$HEALTH_OK" = "false" ]; then
  err "Healthcheck échoué — ROLLBACK AUTOMATIQUE"
  docker tag ecolpro-app:previous ecolpro-app:latest
  docker compose -f "$COMPOSE_FILE" up -d app
  warn "Rollback effectué."
  warn "Logs : docker logs ecolpro-app --tail 50"
  exit 1
fi

log "  → healthcheck OK ✓"

# 6. Nettoyage
log "5/5 — nettoyage..."
docker image prune -f >/dev/null 2>&1 || true

log "=== Déploiement terminé ✓ ==="
log ""
log "Vérifications :"
log "  • App : docker exec ecolpro-app curl -f http://localhost:3000/api/health"
log "  • Logs : docker logs ecolpro-app --tail 20 -f"
log "  • Rollback : $0 --rollback"
