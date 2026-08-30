#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# École Miriam — Déploiement Blue-Green GCP (zero downtime)
# ============================================================
#
# Version GCP de blue-green-deploy.sh. Différences avec la version VPS :
#   - Utilise docker-compose.gcp.yml (sans postgres/pgbouncer/pgbackrest)
#   - Pas de backup pgBackRest (DB sur Supabase, backups via R2)
#   - Pas de apply-rls.sh (RLS sur Supabase via migration_rls_supabase.sql)
#   - DB sur Supabase, pas de conteneur postgres local
#
# Architecture :
#   - app-blue et app-green : deux conteneurs, un seul actif
#   - Caddy pointe vers le slot actif via caddy/upstream.conf
#   - Le slot INACTIF sert de staging : on y déploie, on teste,
#     puis on bascule Caddy vers ce slot.
#
# Phases :
#   1. Déterminer le slot actif et le slot inactif (staging)
#   2. Pull de la nouvelle image depuis GHCR
#   3. Démarrer le conteneur inactif avec la nouvelle image
#   4. Healthcheck sur le conteneur inactif (staging)
#   5. Smoke tests sur le conteneur inactif
#   6. Si tout passe → basculer Caddy vers le nouveau slot
#   7. Healthcheck post-bascule (via Caddy)
#   8. Arrêter l'ancien conteneur après grâce
#   9. Si échec à n'importe quelle étape → rollback automatique
#
# Usage :
#   ./docker/scripts/blue-green-deploy-gcp.sh              # déploiement complet
#   ./docker/scripts/blue-green-deploy-gcp.sh --rollback   # rollback manuel
#   ./docker/scripts/blue-green-deploy-gcp.sh --status     # voir le statut
#   ./docker/scripts/blue-green-deploy-gcp.sh --build      # build local (fallback)
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
COMPOSE_FILE="${DOCKER_DIR}/docker-compose.gcp.yml"
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

# Bootstrap des fichiers upstream si absents (bug Docker mount)
# Docker crée des répertoires parasites si les fichiers manquent au mount.
# On s'assure qu'ils existent en tant que fichiers réguliers.
ensure_upstream_files() {
  local files=("upstream.conf" "upstream-simple.conf")
  for f in "${files[@]}"; do
    local path="${DOCKER_DIR}/caddy/${f}"
    local example="${path}.example"
    if [ ! -f "$path" ]; then
      if [ -d "$path" ]; then
        warn "Suppression du répertoire parasite ${f} (bug Docker mount)"
        rm -rf "$path"
      fi
      if [ -f "$example" ]; then
        warn "Création de ${f} depuis ${f}.example"
        cp "$example" "$path"
      else
        warn "Création de ${f} avec défaut blue"
        echo "reverse_proxy app-blue:3000" > "$path"
      fi
    fi
  done
}

# Valide la configuration Caddy avant tout reload.
# Vérifie :
#   1. Absence de marqueurs de conflit Git dans les fichiers de config
#   2. `caddy validate` passe (syntaxe Caddyfile correcte)
# Retourne 0 si OK, 1 si invalide (et affiche l'erreur).
# IMPORTANT : utilise echo + return 1 (PAS err()) pour que l'appelant
# puisse afficher son propre message et que les logs de debug ci-dessous
# soient effectivement imprimés.
validate_caddy() {
  local caddyfile="${DOCKER_DIR}/caddy/Caddyfile"
  local upstream_simple="${DOCKER_DIR}/caddy/upstream-simple.conf"

  # 1. Vérifier l'absence de marqueurs de conflit Git
  for f in "$caddyfile" "$UPSTREAM_FILE" "$upstream_simple"; do
    [ -f "$f" ] || continue
    if grep -nE '^<{7} |^>{7} |^={7}$' "$f" 2>/dev/null | grep -q .; then
      echo -e "${RED}[ERREUR]${NC} Configuration Caddy corrompue : marqueurs de conflit Git dans $f"
      echo -e "${RED}[ERREUR]${NC} Lancer : git status && git diff pour résoudre, puis recommencer le déploiement."
      return 1
    fi
  done

  # 2. Valider la syntaxe via caddy validate
  # Les bind mounts :ro ne reflètent pas les changements après git pull
  # (inodes différents). On recharge la config Caddy (zero downtime),
  # et seulement si ça échoue, on fait un docker restart (fallback).
  docker exec ecolemiriam-caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile 2>&1 || docker restart ecolemiriam-caddy

  # Attendre que le conteneur soit prêt à accepter des docker exec
  # (au lieu d'un sleep 3 fixe qui peut être insuffisant sur un VPS chargé)
  local wait_caddy=0
  while [ "$wait_caddy" -lt 30 ]; do
    if docker exec ecolemiriam-caddy true 2>/dev/null; then
      break
    fi
    sleep 1
    wait_caddy=$((wait_caddy + 1))
  done
  if [ "$wait_caddy" -ge 30 ]; then
    echo -e "${RED}[ERREUR]${NC} Conteneur Caddy non prêt après 30s (docker exec échoue)"
    echo "Logs : docker logs ecolemiriam-caddy --tail 20"
    return 1
  fi

  # Lancer caddy validate et capturer la sortie complète
  local validate_output
  validate_output=$(docker exec ecolemiriam-caddy caddy validate --config /etc/caddy/Caddyfile 2>&1) || true

  if echo "$validate_output" | grep -q "Valid configuration"; then
    return 0
  fi

  # Échec — afficher la sortie complète pour le debug
  echo -e "${RED}[ERREUR]${NC} Configuration Caddy invalide (caddy validate a échoué)"
  echo "=== Sortie caddy validate ==="
  echo "$validate_output" | tail -20
  echo "============================="
  return 1
}

# Met à jour les fichiers upstream de Caddy et recharge
switch_caddy() {
  local new_color="$1"
  local new_service
  new_service=$(get_service "$new_color")
  local upstream_simple="${DOCKER_DIR}/caddy/upstream-simple.conf"

  info "Bascule Caddy → $new_service"

  # Écrire le fichier upstream complet (pour le handler par défaut)
  # Le health check actif vit ICI uniquement — un seul checker pour tout
  # le Caddyfile. upstream-simple.conf (importé 4× par les handlers
  # rate-limited) n'en a PAS : sinon 5 checkers interrogent /api/health
  # toutes les 30s, et dès qu'une requête lourde (login bcrypt + SQL)
  # bloque l'event loop Node.js > 5s, les 5 checkers timeoutent
  # simultanément, Caddy marque l'upstream "down" → 503 pour tout.
  cat > "$UPSTREAM_FILE" <<EOF
# Auto-généré par blue-green-deploy.sh — ne pas éditer manuellement
# Slot actif : $new_color ($(date -u +%Y-%m-%dT%H:%M:%SZ))
reverse_proxy $new_service:3000 {
    health_uri /api/health
    health_interval 30s
    health_timeout 15s
    health_status 2xx
    transport http {
        read_timeout 60s
        write_timeout 60s
        dial_timeout 5s
    }
    header_up Host {host}
    header_up X-Real-IP {remote_host}
    header_up X-Forwarded-For {remote_host}
    header_up X-Forwarded-Proto https
}
EOF

  # Écrire le fichier upstream simple (pour les handlers rate-limited)
  # PAS de health_uri ici : le handler par défaut (upstream.conf) porte
  # l'unique health checker. Si on en met un ici, il est dupliqué 4×
  # (une fois par handler qui importe ce fichier) → 5 checkers total.
  cat > "$upstream_simple" <<EOF
# Auto-généré par blue-green-deploy.sh — ne pas éditer manuellement
# Slot actif : $new_color ($(date -u +%Y-%m-%dT%H:%M:%SZ))
# Pas de health check ici — géré par upstream.conf (handler par défaut)
reverse_proxy $new_service:3000 {
    transport http {
        read_timeout 60s
        write_timeout 60s
        dial_timeout 5s
    }
    header_up Host {host}
    header_up X-Real-IP {remote_host}
    header_up X-Forwarded-For {remote_host}
    header_up X-Forwarded-Proto https
}
EOF

  # ── Mettre à jour le config.ini d'Ofelia avec le nouveau conteneur actif ──
  # Les crons applicatifs (job-exec) doivent pointer vers le slot actif
  # pour que curl s'exécute dans le conteneur qui a CRON_SECRET.
  local ofelia_config="${DOCKER_DIR}/ofelia/config.ini"
  local new_container
  new_container=$(get_container "$new_color")
  if [ -f "$ofelia_config" ]; then
    info "Mise à jour Ofelia → $new_container"
    sed -i.bak "s/container = \"ecolemiriam-app-blue\"/container = \"ecolemiriam-app-green\"/g; s/container = \"ecolemiriam-app-green\"/container = \"ecolemiriam-app-blue\"/g" "$ofelia_config" 2>/dev/null || true
    # sed double-substitution ci-dessus est fragile — on utilise une approche robuste :
    # 1. Sauvegarder, 2. Remplacer toutes les lignes container= par le nouveau conteneur
    cp "$ofelia_config" "${ofelia_config}.bak"
    sed "s/^container = \"ecolemiriam-app-[a-z]*\"/container = \"$new_container\"/" "${ofelia_config}.bak" > "$ofelia_config"
    rm -f "${ofelia_config}.bak"
    # Recharger Ofelia pour prendre en compte le nouveau config
    docker restart ecolemiriam-ofelia 2>/dev/null || warn "Ofelia non redémarré (conteneur absent ?)"
  fi

  # ── Redémarrer Caddy pour recharger les bind mounts ──────────
  # Les bind mounts :ro de Docker ne reflètent PAS les changements
  # écrits par `cat >` sur l'hôte (inodes différents avec overlay2).
  # docker restart force la relecture des fichiers au démarrage.
  # Downtime < 1s (Caddy démarre rapidement).
  info "Redémarrage Caddy pour recharger la config..."
  docker restart ecolemiriam-caddy 2>/dev/null

  # Attendre que Caddy soit prêt
  local caddy_wait=0
  while [ "$caddy_wait" -lt 15 ]; do
    if docker exec ecolemiriam-caddy wget -qO- http://localhost:8080/health 2>/dev/null | grep -q "OK"; then
      break
    fi
    sleep 1
    caddy_wait=$((caddy_wait + 1))
  done

  if [ "$caddy_wait" -ge 15 ]; then
    err "Caddy n'a pas redémarré dans les 15s"
    err "Logs : docker logs ecolemiriam-caddy --tail 20"
    return 1
  fi

  # Vérifier que Caddy sert correctement la nouvelle config
  # (le health check ci-dessus prouve déjà que Caddy répond, on vérifie
  # juste que l'upstream pointe vers le bon slot)
  if ! docker exec ecolemiriam-caddy grep -q "$new_service" /etc/caddy/upstream.conf 2>/dev/null; then
    err "Caddy ne pointe pas vers $new_service après redémarrage"
    err "Config : docker exec ecolemiriam-caddy cat /etc/caddy/upstream.conf"
    return 1
  fi

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
  # ── Pré-check : valider la config Caddy avant de commencer ──
  # Si le Caddyfile est corrompu (marqueurs de conflit, syntaxe invalide),
  # on refuse de démarrer le déploiement — même si on ne touche pas à
  # Caddy dans cette phase, la promotion échouerait ensuite.
  ensure_upstream_files

  log "0/5 — Validation de la configuration Caddy..."
  if ! validate_caddy; then
    err "Configuration Caddy invalide. Déploiement annulé. Production intacte."
    exit 1
  fi
  log "  → Configuration Caddy valide ✓"

  log "=== Phase STAGING — déploiement sur le slot inactif ==="
  info "Slot actif    : $ACTIVE ($ACTIVE_CTR) — NON MODIFIÉ"
  info "Slot staging  : $INACTIVE ($INACTIVE_CTR) — reçoit la nouvelle image"
  echo ""

  # Phase 1 : Backup — GCP : pas de pgBackRest (DB sur Supabase, backups R2)
  log "1/5 — Skip backup pgBackRest (DB sur Supabase, backups via R2)"

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

  # ── Pré-check : s'assurer que les fichiers upstream existent ──
  ensure_upstream_files

  # Vérifier que le staging tourne encore
  if ! docker ps --format '{{.Names}}' | grep -q "^${INACTIVE_CTR}$"; then
    err "Le conteneur staging ($INACTIVE_CTR) n'est plus en cours d'exécution."
    err "Lancer d'abord : $0 --staging-only"
    exit 1
  fi

  # Vérifier que le staging est toujours sain
  log "1/5 — Vérification santé du staging..."
  if ! healthcheck_container "$INACTIVE_CTR" 30; then
    err "Le staging ($INACTIVE_CTR) ne répond pas. Promotion annulée."
    exit 1
  fi

  # Application des policies RLS — GCP : RLS sur Supabase, pas de apply-rls.sh
  # Les policies RLS sont appliquées via prisma/migration_rls_supabase.sql
  # directement sur Supabase, pas via un conteneur postgres local.
  log "2/5 — Skip apply-rls.sh (RLS sur Supabase via migration_rls_supabase.sql)"

  # Bascule Caddy
  log "3/5 — Bascule Caddy vers $INACTIVE..."
  switch_caddy "$INACTIVE"
  sleep 2

  # Healthcheck post-bascule
  log "4/5 — Healthcheck post-bascule..."
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
  log "5/5 — Grace period (10s) puis arrêt de l'ancien ($ACTIVE_CTR)..."
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
