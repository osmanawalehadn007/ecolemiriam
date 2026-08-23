#!/usr/bin/env bash
# ============================================================
# École Miriam — Vérification de drift VPS vs dépôt Git
# ============================================================
# Compare les fichiers de configuration critiques sur le VPS
# avec leur version dans le dépôt Git local. Détecte :
#   - Les marqueurs de conflit Git (<<<<<<< ======= >>>>>>>)
#   - Les divergences entre le dépôt et la production
#   - Les fichiers manquants sur le VPS
#
# Ce script prévient le problème du 22/08/2026 : un Caddyfile
# modifié manuellement sur le VPS (conflit Git non résolu) a
# causé une indisponibilité de plusieurs heures.
#
# Usage :
#   ./scripts/check-vps-drift.sh              # vérifier
#   ./scripts/check-vps-drift.sh --fix        # synchroniser (scp)
#   ./scripts/check-vps-drift.sh --status     # état rapide
# ============================================================
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

VPS_HOST="root@169.58.208.217"
VPS_BASE="/opt/ecolemiriam"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DOCKER_DIR="${PROJECT_DIR}/docker"

# Fichiers critiques à vérifier (relatif au dépôt → relatif au VPS)
# Format : "chemin_local|chemin_vps|auto_gen"
#   auto_gen=0 : le fichier doit être identique (alerte si divergence)
#   auto_gen=1 : le fichier est auto-généré par blue-green-deploy.sh
#               (on vérifie seulement les marqueurs de conflit, pas le contenu)
CRITICAL_FILES=(
  "docker/caddy/Caddyfile|${VPS_BASE}/docker/caddy/Caddyfile|0"
  "docker/caddy/upstream.conf|${VPS_BASE}/docker/caddy/upstream.conf|1"
  "docker/caddy/upstream-simple.conf|${VPS_BASE}/docker/caddy/upstream-simple.conf|1"
  "docker/docker-compose.yml|${VPS_BASE}/docker/docker-compose.yml|0"
  "docker/cloudflared/config.yml|${VPS_BASE}/docker/cloudflared/config.yml|0"
  "docker/scripts/blue-green-deploy.sh|${VPS_BASE}/docker/scripts/blue-green-deploy.sh|0"
)

# ── Mode --status : vérification rapide (HTTP + marqueurs) ───
if [ "${1:-}" = "--status" ]; then
  echo ""
  echo "=== État rapide du VPS ==="
  echo ""

  # HTTP status
  for url in "https://ecolemiriam.com" "https://app.ecolemiriam.com"; do
    code=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || echo "000")
    if [ "$code" = "200" ] || [ "$code" = "307" ] || [ "$code" = "302" ]; then
      echo -e "  ${url}: ${GREEN}${code}${NC}"
    else
      echo -e "  ${url}: ${RED}${code}${NC} ⚠"
    fi
  done
  echo ""

  # Marqueurs de conflit dans les fichiers critiques
  CONFLICTS=$(ssh "$VPS_HOST" "
    for f in ${VPS_BASE}/docker/caddy/Caddyfile ${VPS_BASE}/docker/caddy/upstream.conf ${VPS_BASE}/docker/caddy/upstream-simple.conf; do
      [ -f \"\$f\" ] && grep -lE '^<{7} |^>{7} |^={7}$' \"\$f\" 2>/dev/null
    done
  " 2>/dev/null || true)

  if [ -n "$CONFLICTS" ]; then
    echo -e "  ${RED}Marqueurs de conflit détectés :${NC}"
    echo "$CONFLICTS" | while read -r f; do echo "    - $f"; done
  else
    echo -e "  ${GREEN}Aucun marqueur de conflit dans les fichiers Caddy${NC}"
  fi
  echo ""
  exit 0
fi

# ── Mode normal ou --fix : comparaison complète ──────────────
echo ""
echo "=== Vérification de drift VPS ↔ dépôt Git ==="
echo "  VPS  : $VPS_HOST:$VPS_BASE"
echo "  Dépôt: $PROJECT_DIR"
echo ""

HAS_DRIFT=false
HAS_CONFLICT=false

for entry in "${CRITICAL_FILES[@]}"; do
  local_path=$(echo "$entry" | cut -d'|' -f1)
  vps_path=$(echo "$entry" | cut -d'|' -f2)
  auto_gen=$(echo "$entry" | cut -d'|' -f3)
  local_full="${PROJECT_DIR}/${local_path}"

  # Vérifier que le fichier local existe
  if [ ! -f "$local_full" ]; then
    echo -e "  ${RED}[MANQUANT LOCAL]${NC} $local_path"
    HAS_DRIFT=true
    continue
  fi

  # Récupérer le fichier VPS et comparer
  vps_content=$(ssh "$VPS_HOST" "cat '$vps_path' 2>/dev/null" || true)
  local_content=$(cat "$local_full")

  if [ -z "$vps_content" ]; then
    echo -e "  ${RED}[MANQUANT VPS]${NC} $local_path"
    HAS_DRIFT=true
    continue
  fi

  # Vérifier les marqueurs de conflit sur le VPS (toujours, même auto-générés)
  if echo "$vps_content" | grep -qE '^<{7} |^>{7} |^={7}$'; then
    echo -e "  ${RED}[CONFLIT GIT]${NC} $local_path — marqueurs <<<<<<< ======= >>>>>>> sur le VPS"
    HAS_CONFLICT=true
    continue
  fi

  # Les fichiers auto-générés : on ne compare pas le contenu
  # (blue-green-deploy.sh les régénère à chaque déploiement)
  if [ "$auto_gen" = "1" ]; then
    echo -e "  ${GREEN}[OK]${NC} $local_path ${YELLOW}(auto-généré, contenu non comparé)${NC}"
    continue
  fi

  # Comparer le contenu
  if [ "$vps_content" = "$local_content" ]; then
    echo -e "  ${GREEN}[OK]${NC} $local_path"
  else
    echo -e "  ${YELLOW}[DIVERGENT]${NC} $local_path"
    HAS_DRIFT=true
    # En mode --fix, on resynchronise
    if [ "${1:-}" = "--fix" ]; then
      scp "$local_full" "$VPS_HOST:$vps_path" 2>/dev/null && \
        echo -e "    ${GREEN}→ synchronisé${NC}" || \
        echo -e "    ${RED}→ échec scp${NC}"
    else
      # Afficher un diff court
      diff <(echo "$local_content") <(echo "$vps_content") | head -10 | while IFS= read -r line; do
        echo "    $line"
      done
      echo "    (utiliser --fix pour resynchroniser)"
    fi
  fi
done

echo ""

# ── Résumé ───────────────────────────────────────────────────
if [ "$HAS_CONFLICT" = "true" ]; then
  echo -e "${RED}⚠  CONFLIT GIT détecté sur le VPS !${NC}"
  echo "   Des fichiers contiennent des marqueurs <<<<<<< ======= >>>>>>>."
  echo "   Lancer : ./scripts/check-vps-drift.sh --fix"
  echo ""
  exit 1
fi

if [ "$HAS_DRIFT" = "true" ] && [ "${1:-}" != "--fix" ]; then
  echo -e "${YELLOW}⚠  Divergence détectée entre le dépôt et le VPS.${NC}"
  echo "   Lancer : ./scripts/check-vps-drift.sh --fix"
  echo ""
  exit 1
fi

if [ "$HAS_DRIFT" = "false" ] && [ "$HAS_CONFLICT" = "false" ]; then
  echo -e "${GREEN}✓  Aucune divergence — le VPS est synchronisé avec le dépôt.${NC}"
fi

echo ""
