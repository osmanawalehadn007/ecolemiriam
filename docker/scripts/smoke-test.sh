#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# École Miriam — Smoke tests post-déploiement
# ============================================================
#
# Tests non-destructifs qui vérifient qu'un conteneur app est
# fonctionnel SANS modifier aucune donnée.
#
# À lancer contre le conteneur STAGING (avant promotion) ou
# contre le conteneur actif (post-déploiement).
#
# Usage :
#   ./docker/scripts/smoke-test.sh app-blue
#   ./docker/scripts/smoke-test.sh app-green
#   ./docker/scripts/smoke-test.sh app-staging
#
# Fiabilité (2026-09-27) — le même test pouvait échouer au 1er essai puis
# passer à la relance (un `caddy reload` laisse le proxy indisponible quelques
# secondes). Deux causes corrigées :
#   1. chaque commande est évaluée UNE SEULE fois (l'ancien `check` lançait
#      `eval` deux fois : statut puis `grep` — soit deux requêtes HTTP) ;
#   2. un échec transitoire est retenté (SMOKE_RETRIES, défaut 3).
# Les en-têtes de sécurité sont vérifiés DIRECTEMENT sur le conteneur app :
# `next.config.ts` les pose sur toutes les routes (`source: "/(.*)"`), donc
# dépendre de Caddy pour ce contrôle était inutilement fragile.
#
# Variables d'environnement :
#   SMOKE_RETRIES      tentatives par test (défaut : 3)
#   SMOKE_RETRY_DELAY  secondes entre deux tentatives (défaut : 2)
#   CADDY_CONTAINER    nom du conteneur Caddy (défaut : ecolemiriam-caddy)
#
# Sortie : code 0 = tout passe, code 1 = au moins un test échoue
# ============================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

CONTAINER="${1:-}"
if [ -z "$CONTAINER" ]; then
  echo -e "${RED}Usage: $0 <container-name>${NC}"
  echo "Exemple: $0 app-blue"
  exit 1
fi

if ! docker inspect "$CONTAINER" >/dev/null 2>&1; then
  echo -e "${RED}Conteneur introuvable : $CONTAINER${NC}"
  echo "Conteneurs connus : docker ps --format '{{.Names}}'"
  exit 1
fi

PASS=0
FAIL=0
SKIP=0
TOTAL=0
RETRIES="${SMOKE_RETRIES:-3}"
RETRY_DELAY="${SMOKE_RETRY_DELAY:-2}"
CADDY_CONTAINER="${CADDY_CONTAINER:-ecolemiriam-caddy}"

# check <nom> <commande> [motif attendu dans la sortie]
#   Évalue la commande UNE fois, retente en cas d'échec transitoire.
#   Ne retourne jamais un statut non nul : `set -e` interromprait le script
#   avant le résumé. Le code de sortie final dépend du compteur FAIL.
check() {
  local name="$1"
  local cmd="$2"
  local expected="${3:-}"
  local attempt=1
  local output=""
  TOTAL=$((TOTAL + 1))

  while [ "$attempt" -le "$RETRIES" ]; do
    if output="$(eval "$cmd" 2>&1)"; then
      if [ -z "$expected" ] || printf '%s' "$output" | grep -q "$expected"; then
        if [ "$attempt" -gt 1 ]; then
          echo -e "  ${GREEN}✓${NC} $name ${YELLOW}(tentative $attempt)${NC}"
        else
          echo -e "  ${GREEN}✓${NC} $name"
        fi
        PASS=$((PASS + 1))
        return 0
      fi
    fi
    [ "$attempt" -lt "$RETRIES" ] && sleep "$RETRY_DELAY"
    attempt=$((attempt + 1))
  done

  echo -e "  ${RED}✗${NC} $name (échec après $RETRIES tentative(s))"
  FAIL=$((FAIL + 1))
  return 0
}

# skip <nom> <raison>
skip() {
  TOTAL=$((TOTAL + 1))
  SKIP=$((SKIP + 1))
  echo -e "  ${YELLOW}○${NC} $1 (ignoré : $2)"
}

echo ""
echo "=== Smoke tests : $CONTAINER ==="
echo "Date : $(date -u +%Y-%m-%dT%H:%M:%SZ) — ${RETRIES} tentative(s) max par test"
echo ""

# --- 1. Health endpoint (DB vivante) ---
echo "[1/6] Health & base de données"
check "GET /api/health → 200 + {\"ok\":true}" \
  "docker exec $CONTAINER curl -sf http://localhost:3000/api/health" \
  '"ok":true'

# --- 2. Page de login (rendu SSR) ---
echo "[2/6] Pages publiques"
check "GET /login → 200 (page de connexion)" \
  "docker exec $CONTAINER curl -sf -o /dev/null -w '%{http_code}' http://localhost:3000/login | grep -q 200"

check "GET / → 200 ou 307 (redirect vers login)" \
  "docker exec $CONTAINER curl -sf -o /dev/null -w '%{http_code}' http://localhost:3000/ | grep -qE '200|307'"

# --- 3. API endpoints critiques (sans auth = 401/403, pas 500) ---
echo "[3/6] API — réponses attendues (401/403 = normal sans auth)"
# Note : curl -s SANS -f pour accepter les codes non-2xx (401/403/405)
check "GET /api/auth/2fa/check-required → pas 500" \
  "docker exec $CONTAINER curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api/auth/2fa/check-required | grep -qvE '500|502|503'"

check "GET /api/eleves → 401/403 (protégé, pas 500)" \
  "docker exec $CONTAINER curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api/eleves | grep -qE '401|403'"

check "GET /api/parametres → pas 500 (protégé)" \
  "docker exec $CONTAINER curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api/parametres | grep -qvE '500|502|503'"

# --- 4. Assets statiques (Next.js) ---
echo "[4/6] Assets statiques"
# /_next/static/ sans nom de fichier → 404 normal (pas d'index directory)
# On vérifie juste que le dossier existe via un fichier connu ou 404 acceptable
check "GET /_next/static → pas 500 (assets Next.js)" \
  "docker exec $CONTAINER curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/_next/static/ | grep -qvE '500|502|503'"

# --- 5. Headers de sécurité ---
echo "[5/6] Headers de sécurité"
# Les en-têtes sont posés par `next.config.ts` (source "/(.*)") ET par Caddy.
# On les vérifie sur le conteneur app : contrôle déterministe, indépendant de
# l'état du proxy au moment du test.
check "X-Frame-Options: DENY (conteneur app)" \
  "docker exec $CONTAINER curl -sI http://localhost:3000/api/health | tr -d '\r' | grep -qi '^x-frame-options: DENY'"

check "X-Content-Type-Options: nosniff (conteneur app)" \
  "docker exec $CONTAINER curl -sI http://localhost:3000/api/health | tr -d '\r' | grep -qi '^x-content-type-options: nosniff'"

check "Content-Security-Policy présente (conteneur app)" \
  "docker exec $CONTAINER curl -sI http://localhost:3000/login | tr -d '\r' | grep -qi '^content-security-policy:'"

# Caddy relaie ces en-têtes : vérifié seulement s'il tourne, sinon ignoré.
if docker inspect "$CADDY_CONTAINER" >/dev/null 2>&1; then
  check "Caddy relaie X-Frame-Options" \
    "docker exec $CADDY_CONTAINER wget -qS -O /dev/null http://localhost:8080/api/health 2>&1 | grep -qi 'X-Frame-Options'"
else
  skip "Caddy relaie X-Frame-Options" "conteneur $CADDY_CONTAINER absent"
fi

# --- 6. Process & mémoire ---
echo "[6/6] Process & ressources"
check "Process Next.js actif (node)" \
  "docker exec $CONTAINER pgrep -x node >/dev/null 2>&1 || docker exec $CONTAINER ps aux | grep -q '[n]ext'"

# Empreinte mémoire réelle du conteneur (cgroup v2, puis v1).
MEM_BYTES="$(docker exec "$CONTAINER" cat /sys/fs/cgroup/memory.current 2>/dev/null \
  || docker exec "$CONTAINER" cat /sys/fs/cgroup/memory/memory.usage_in_bytes 2>/dev/null \
  || echo "")"
MEM_DIGITS="${MEM_BYTES//[!0-9]/}"
if [ -n "$MEM_DIGITS" ] && [ "$MEM_DIGITS" -gt 0 ] 2>/dev/null; then
  MEM_MIB=$(( MEM_DIGITS / 1048576 ))
  check "Mémoire < 1 GiB (${MEM_MIB} MiB utilisés)" "test $MEM_DIGITS -lt 1073741824"
else
  skip "Mémoire < 1 GiB" "cgroup illisible dans le conteneur"
fi

# --- Résumé ---
echo ""
echo "=== Résultat : $PASS/$TOTAL tests passés ($SKIP ignoré(s)) ==="
if [ "$FAIL" -gt 0 ]; then
  echo -e "${RED}$FAIL test(s) ont échoué.${NC}"
  echo ""
  echo "Logs : docker logs $CONTAINER --tail 50"
  exit 1
else
  echo -e "${GREEN}Tous les smoke tests sont passés ✓${NC}"
  exit 0
fi
