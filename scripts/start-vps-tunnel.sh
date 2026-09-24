#!/usr/bin/env bash
# ============================================================
# École Miriam — Tunnel SSH vers le VPS Postgres
# ============================================================
#
# Permet au développement local (npm run dev) de se connecter
# au Postgres du VPS au lieu de Supabase.
#
# Prérequis :
#   - Clé SSH configurée sur le VPS (root@169.58.208.217)
#   - Ponts Docker actifs sur le VPS (pgb-bridge, pg-bridge)
#
# Usage :
#   ./scripts/start-vps-tunnel.sh        # Démarrer
#   ./scripts/start-vps-tunnel.sh stop   # Arrêter
#   ./scripts/start-vps-tunnel.sh status # Vérifier
# ============================================================

set -euo pipefail

VPS_HOST="root@169.58.208.217"
PGBOUNCER_PORT=16432   # Local → VPS pgbouncer:6432
POSTGRES_PORT=15432    # Local → VPS postgres:5432

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

start_tunnels() {
  # Vérifier si les tunnels sont déjà actifs
  if lsof -i :${PGBOUNCER_PORT} -t >/dev/null 2>&1; then
    echo -e "${YELLOW}[SKIP]${NC} Tunnel pgbouncer déjà actif (port ${PGBOUNCER_PORT})"
  else
    ssh -f -N -L ${PGBOUNCER_PORT}:127.0.0.1:${PGBOUNCER_PORT} ${VPS_HOST}
    echo -e "${GREEN}[OK]${NC} Tunnel pgbouncer: localhost:${PGBOUNCER_PORT} → VPS pgbouncer:6432"
  fi

  if lsof -i :${POSTGRES_PORT} -t >/dev/null 2>&1; then
    echo -e "${YELLOW}[SKIP]${NC} Tunnel postgres déjà actif (port ${POSTGRES_PORT})"
  else
    ssh -f -N -L ${POSTGRES_PORT}:127.0.0.1:${POSTGRES_PORT} ${VPS_HOST}
    echo -e "${GREEN}[OK]${NC} Tunnel postgres:  localhost:${POSTGRES_PORT} → VPS postgres:5432"
  fi

  echo ""
  echo "Tunnels actifs. L'application locale utilise maintenant le VPS."
  echo "Pour arrêter: $0 stop"
}

stop_tunnels() {
  # Tuer les processus SSH associés aux tunnels
  for port in ${PGBOUNCER_PORT} ${POSTGRES_PORT}; do
    local pids
    pids=$(lsof -i :${port} -t 2>/dev/null || true)
    if [ -n "$pids" ]; then
      kill $pids 2>/dev/null || true
      echo -e "${GREEN}[OK]${NC} Tunnel arrêté (port ${port}, PID $pids)"
    else
      echo -e "${YELLOW}[SKIP]${NC} Aucun tunnel sur le port ${port}"
    fi
  done
}

status_tunnels() {
  echo "État des tunnels SSH :"
  echo ""
  for port in ${PGBOUNCER_PORT} ${POSTGRES_PORT}; do
    if lsof -i :${port} -t >/dev/null 2>&1; then
      echo -e "  Port ${port}: ${GREEN}ACTIF${NC}"
    else
      echo -e "  Port ${port}: ${RED}INACTIF${NC}"
    fi
  done
}

case "${1:-start}" in
  start)  start_tunnels ;;
  stop)   stop_tunnels ;;
  status) status_tunnels ;;
  *)
    echo "Usage: $0 {start|stop|status}"
    exit 1
    ;;
esac
