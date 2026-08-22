#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# École Miriam — Déploiement Blue-Green (zero downtime)
# ============================================================
#
# Architecture :
#   - app-blue et app-green : deux conteneurs, un seul actif
#   - Caddy pointe vers le slot actif via caddy/upstream.conf
#   - Le slot INACTIF sert de staging : on y déploie, on teste,
#     puis on bascule Caddy vers ce slot.
#
# Phases :
#   1. Backup pré-déploiement (pgBackRest)
#   2. Déterminer le slot actif et le slot inactif (staging)
#   3. Pull de la nouvelle image depuis GHCR
#   4. Démarrer le conteneur inactif avec la nouvelle image
#   5. Healthcheck sur le conteneur inactif (staging)
#   6. Smoke tests sur le conteneur inactif
#   7. Si tout passe → basculer Caddy vers le nouveau slot
#   8. Healthcheck post-bascule (via Caddy)
#   9. Arrêter l'ancien conteneur après grâce
#  10. Si échec à n'importe quelle étape → rollback automatique
#
# Usage :
#   ./docker/scripts/blue-green-deploy.sh              # déploiement complet
#   ./docker/scripts/blue-green-deploy.sh --rollback   # rollback manuel
#   ./docker/scripts/blue-green-deploy.sh --status     # voir le statut
#   ./docker/scripts/blue-green-deploy.sh --build      # build local (fallback)
# ============================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${GREEN}[$(date -u +%H:%M:%S)]${NC} $1"; }
info() { echo -e "${BLUE}[$(date -u +%H:%M:%S)]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()  { echo -e "${RED}[ERREUR]${NC} $1"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_DIR="$(cd "$DOCKER_DIR/.." && pwd)"
COMPOSE_FILE="${DOCKER_DIR}/docker-compose.yml"
UPSTREAM_FILE="${DOCKER_DIR}/caddy/upstream.conf"
STATE_FILE="${DOCKER_DIR}/.active-color"
SMOKE_TEST="${SCRIPT_DIR}/smoke-test.sh"

GHCR_IMAGE="ghcr.io/wilsan007/ecolemiriam-app:latest"

cd "$DOCKER_DIR"

# ============================================================
# Fonctions utilitaires
# ============================================================

# Retourne la couleur active (blue ou green)
get_active_color() {
  if [ -f "$STATE_FILE" ]; then
    cat "$STATE_FILE"
  else
    # Par défaut : blue est actif (premier déploiement)
    echo "blue"
  fi
}

# Retourne la couleur inactive (staging)
get_inactive_color() {
  local active
  active=$(get_active_color)
  if [ "$active" = "blue" ]; then
    echo "green"
  else
    echo "blue"
  fi
}

# Retourne le nom du conteneur pour une couleur
get_container() {
  echo "ecolemiriam-app-$1"
}

# Retourne le nom du service docker-compose pour une couleur
get_service() {
  echo "app-$1"
}

# Met à jour les fichiers upstream de Caddy et recharge
switch_caddy() {
  local new_color="$1"
  local new_service
  new_service=$(get_service "$new_color")
  local upstream_simple="${DOCKER_DIR}/caddy/upstream-simple.conf"

  info "Bascule Caddy → $new_service"

  # Écrire le fichier upstream complet (pour le handler par défaut)
  cat > "$UPSTREAM_FILE" <<EOF
# Auto-généré par blue-green-deploy.sh — ne pas éditer manuellement
# Slot actif : $new_color ($(date -u +%Y-%m-%dT%H:%M:%SZ))
reverse_proxy $new_service:3000 {
    health_uri /api/health
    health_interval 30s
    health_timeout 5s
    health_status 2xx
    transport http {
        read_timeout 60s
        write_timeout 60s
        dial_timeout 5s
    }
    header_up Host {host}
    header_up X-Real-IP {remote_host}
    header_up X-Forwarded-For {remote_host}
    header_up X-Forwarded-Proto {scheme}
}
EOF

  # Écrire le fichier upstream simple (pour les handlers rate-limited)
  cat > "$upstream_simple" <<EOF
# Auto-généré par blue-green-deploy.sh — ne pas éditer manuellement
# Slot actif : $new_color ($(date -u +%Y-%m-%dT%H:%M:%SZ))
reverse_proxy $new_service:3000
EOF

  # Recharger Caddy (zero downtime — Caddy reload est non-bloquant)
  docker exec ecolemiriam-caddy caddy reload --config /etc/caddy/Caddyfile 2>/dev/null || {
    warn "caddy reload a échoué, tentative de restart..."
    docker restart ecolemiriam-caddy
  }

  # Mettre à jour le state
  echo "$new_color" > "$STATE_FILE"
  log "  → Caddy basculé vers $new_color ✓"
}

# Healthcheck sur un conteneur (60s max)
healthcheck_container() {
  local container="$1"
  local max_wait="${2:-60}"
  local waited=0
  local interval=5

  info "Healthcheck sur $container (${max_wait}s max)..."
  while [ "$waited" -lt "$max_wait" ]; do
    if docker exec "$container" curl -sf http://localhost:3000/api/health 2>/dev/null | grep -q '"ok":true'; then
      log "  → $container est sain ✓ (${waited}s)"
      return 0
    fi
    sleep "$interval"
    waited=$((waited + interval))
    echo -n "."
  done
  echo ""
  return 1
}

# Login GHCR
ghcr_login() {
  if [ -f ~/.config/ghcr-token ]; then
    cat ~/.config/ghcr-token | docker login ghcr.io -u wilsan007 --password-stdin 2>/dev/null
  else
    err "Token GHCR manquant (~/.config/ghcr-token). Lancer : docker/scripts/setup-vps-ghcr.sh"
  fi
}

# ============================================================
# Mode --status : afficher l'état actuel
# ============================================================
if [ "${1:-}" = "--status" ]; then
  ACTIVE=$(get_active_color)
  INACTIVE=$(get_inactive_color)
  ACTIVE_CTR=$(get_container "$ACTIVE")
  INACTIVE_CTR=$(get_container "$INACTIVE")

  echo ""
  echo "=== Statut Blue-Green ==="
  echo "  Slot actif    : $ACTIVE"
  echo "  Conteneur     : $ACTIVE_CTR"
  if docker ps --format '{{.Names}}' | grep -q "^${ACTIVE_CTR}$"; then
    echo -e "  État          : ${GREEN}RUNNING${NC}"
  else
    echo -e "  État          : ${RED}STOPPED${NC}"
  fi
  echo ""
  echo "  Slot inactif  : $INACTIVE (staging)"
  echo "  Conteneur     : $INACTIVE_CTR"
  if docker ps --format '{{.Names}}' | grep -q "^${INACTIVE_CTR}$"; then
    echo -e "  État          : ${YELLOW}RUNNING (staging)${NC}"
  else
    echo "  État          : stopped"
  fi
  echo ""
  exit 0
fi

# ============================================================
# Mode --rollback : revenir au slot inactif (l'ancien actif)
# ============================================================
if [ "${1:-}" = "--rollback" ]; then
  log "=== ROLLBACK BLUE-GREEN ==="
  ACTIVE=$(get_active_color)
  INACTIVE=$(get_inactive_color)
  ACTIVE_CTR=$(get_container "$ACTIVE")
  INACTIVE_CTR=$(get_container "$INACTIVE")

  # Vérifier que le slot inactif tourne encore (grace period)
  if ! docker ps --format '{{.Names}}' | grep -q "^${INACTIVE_CTR}$"; then
    err "Le slot inactif ($INACTIVE_CTR) n'est plus en cours d'exécution. Rollback impossible."
  fi

  # Healthcheck sur l'ancien slot
  if ! healthcheck_container "$INACTIVE_CTR" 30; then
    err "L'ancien slot ($INACTIVE_CTR) ne répond pas au healthcheck. Rollback impossible."
  fi

  # Bascule Caddy vers l'ancien slot
  switch_caddy "$INACTIVE"

  # Arrêter le nouveau slot (qui était devenu actif)
  log "Arrêt de l'ancien conteneur actif ($ACTIVE_CTR)..."
  docker stop "$ACTIVE_CTR" 2>/dev/null || true

  log "=== Rollback terminé ✓ ==="
  log "Slot actif : $INACTIVE"
  log ""
  "$0" --status
  exit 0
fi

# ============================================================
# Fonction : déployer en staging (slot inactif) sans toucher à la prod
# ============================================================
deploy_staging() {
  log "=== Phase STAGING — déploiement sur le slot inactif ==="
  info "Slot actif    : $ACTIVE ($ACTIVE_CTR) — NON MODIFIÉ"
  info "Slot staging  : $INACTIVE ($INACTIVE_CTR) — reçoit la nouvelle image"
  echo ""

  # Phase 1 : Backup
  log "1/5 — Backup pré-déploiement (pgBackRest)..."
  docker exec ecolemiriam-pgbackrest pgbackrest --stanza=ecolemiriam --type=incr backup 2>/dev/null || warn "Backup a échoué — continuer"

  # Phase 2 : Pull
  if [ "${BUILD_ONLY:-false}" != "true" ]; then
    log "2/5 — Login GHCR + pull de la nouvelle image..."
    ghcr_login
    docker pull "${GHCR_IMAGE}"
  else
    log "2/5 — Image construite localement (skip pull)"
  fi

  # Phase 3 : Démarrer le conteneur inactif
  log "3/5 — Démarrage du conteneur staging ($INACTIVE_SVC)..."
  docker stop "$INACTIVE_CTR" 2>/dev/null || true
  docker rm "$INACTIVE_CTR" 2>/dev/null || true
  docker compose -f "$COMPOSE_FILE" up -d --no-deps --pull never "$INACTIVE_SVC"

  # Phase 4 : Healthcheck
  log "4/5 — Healthcheck sur le staging ($INACTIVE_CTR)..."
  if ! healthcheck_container "$INACTIVE_CTR" 90; then
    err "Healthcheck échoué sur le staging"
    log "Logs du staging :"
    docker logs "$INACTIVE_CTR" --tail 30 2>&1 || true
    docker stop "$INACTIVE_CTR" 2>/dev/null || true
    log "Le slot actif ($ACTIVE) n'a PAS été modifié. Production intacte."
    exit 1
  fi

  # Phase 5 : Smoke tests
  log "5/5 — Smoke tests sur le staging..."
  if ! bash "$SMOKE_TEST" "$INACTIVE_CTR"; then
    err "Smoke tests échoués sur le staging"
    log "Le conteneur staging reste disponible pour investigation :"
    log "  docker logs $INACTIVE_CTR --tail 50"
    log "  docker exec $INACTIVE_CTR sh"
    log ""
    log "Le slot actif ($ACTIVE) n'a PAS été modifié. Production intacte."
    exit 1
  fi

  log ""
  log "=== Staging déployé ✓ — en attente de promotion ==="
  log "Le slot $INACTIVE ($INACTIVE_CTR) est prêt et a passé tous les tests."
  log "La production reste sur $ACTIVE ($ACTIVE_CTR)."
  log ""
  log "Pour promouvoir en production : $0 --promote"
  log "Pour annuler : docker stop $INACTIVE_CTR"
}

# ============================================================
# Fonction : promouvoir le staging en production (bascule Caddy)
# ============================================================
promote_to_production() {
  log "=== Phase PROMOTION — bascule du trafic vers $INACTIVE ==="
  echo ""

  # Vérifier que le staging tourne encore
  if ! docker ps --format '{{.Names}}' | grep -q "^${INACTIVE_CTR}$"; then
    err "Le conteneur staging ($INACTIVE_CTR) n'est plus en cours d'exécution."
    err "Lancer d'abord : $0 --staging-only"
    exit 1
  fi

  # Vérifier que le staging est toujours sain
  log "1/4 — Vérification santé du staging..."
  if ! healthcheck_container "$INACTIVE_CTR" 30; then
    err "Le staging ($INACTIVE_CTR) ne répond pas. Promotion annulée."
    exit 1
  fi

  # Bascule Caddy
  log "2/4 — Bascule Caddy vers $INACTIVE..."
  switch_caddy "$INACTIVE"
  sleep 2

  # Healthcheck post-bascule
  log "3/4 — Healthcheck post-bascule..."
  POST_SWITCH_OK=false
  for i in $(seq 1 6); do
    if docker exec "$INACTIVE_CTR" curl -sf http://localhost:3000/api/health 2>/dev/null | grep -q '"ok":true'; then
      POST_SWITCH_OK=true
      break
    fi
    sleep 3
  done

  if [ "$POST_SWITCH_OK" = "false" ]; then
    err "Healthcheck post-bascule échoué — ROLLBACK AUTOMATIQUE"
    switch_caddy "$ACTIVE"
    warn "Rollback effectué. Production revenue sur $ACTIVE."
    exit 1
  fi
  log "  → Trafic basculé vers $INACTIVE ✓"

  # Grace period + arrêt de l'ancien
  log "4/4 — Grace period (10s) puis arrêt de l'ancien ($ACTIVE_CTR)..."
  sleep 10

  if ! docker exec "$INACTIVE_CTR" curl -sf http://localhost:3000/api/health 2>/dev/null | grep -q '"ok":true'; then
    err "Le nouveau slot est devenu instable — ROLLBACK"
    switch_caddy "$ACTIVE"
    docker stop "$INACTIVE_CTR" 2>/dev/null || true
    warn "Rollback effectué. Production revenue sur $ACTIVE."
    exit 1
  fi

  docker stop "$ACTIVE_CTR" 2>/dev/null || true
  docker image prune -f >/dev/null 2>&1 || true
  docker tag "${GHCR_IMAGE}" "ecolemiriam-app:previous" 2>/dev/null || true

  log ""
  log "=== Promotion terminée ✓ ==="
  log "Slot actif    : $INACTIVE ($INACTIVE_CTR)"
  log "Ancien slot   : $ACTIVE (arrêté, conservé pour rollback)"
  log ""
  log "Rollback : $0 --rollback"
}

# ============================================================
# Mode --build : build local (fallback si GHCR indisponible)
# ============================================================
if [ "${1:-}" = "--build" ]; then
  log "=== BUILD LOCAL (fallback) ==="
  log "Construction de l'image localement..."
  DOCKER_BUILDKIT=1 docker build -t "${GHCR_IMAGE}" "$PROJECT_DIR" -f "${DOCKER_DIR}/app/Dockerfile"
  BUILD_ONLY=true
  # Continue avec le déploiement complet ci-dessous
  set -- "--full"
fi

# ============================================================
# Variables communes (calculées une fois)
# ============================================================
ACTIVE=$(get_active_color)
INACTIVE=$(get_inactive_color)
ACTIVE_CTR=$(get_container "$ACTIVE")
INACTIVE_CTR=$(get_container "$INACTIVE")
INACTIVE_SVC=$(get_service "$INACTIVE")

# ============================================================
# Mode --staging-only : déployer sur le slot inactif sans basculer
# ============================================================
if [ "${1:-}" = "--staging-only" ]; then
  deploy_staging
  exit 0
fi

# ============================================================
# Mode --promote : basculer Caddy vers le slot inactif (staging → prod)
# ============================================================
if [ "${1:-}" = "--promote" ]; then
  promote_to_production
  exit 0
fi

# ============================================================
# Mode normal (--full ou sans argument) : staging + promotion en une fois
# ============================================================
if [ "${1:-}" = "--full" ] || [ "${#}" -eq 0 ] || [ -z "${1:-}" ]; then
  log "=== Déploiement Blue-Green complet (staging + promotion) ==="
  info "Slot actif    : $ACTIVE ($ACTIVE_CTR)"
  info "Slot staging  : $INACTIVE ($INACTIVE_CTR)"
  echo ""

  # 1. Déployer en staging
  deploy_staging

  # 2. Promouvoir en production
  echo ""
  promote_to_production

  exit 0
fi

# Si on arrive ici, l'argument n'est pas reconnu
err "Argument inconnu: ${1:-}. Usage: $0 [--full|--staging-only|--promote|--rollback|--status|--build]"
