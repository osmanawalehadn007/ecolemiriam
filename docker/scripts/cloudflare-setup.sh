#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# École Miriam — Configuration Cloudflare via API
# ============================================================
#
# Automatise la configuration Cloudflare pour le VPS :
#   1. Vérifie le token API et récupère le Zone ID
#   2. Configure SSL/TLS (Full strict) + TLS 1.2 minimum
#   3. Active Always Use HTTPS + HSTS
#   4. Configure les enregistrements DNS (CNAME vers tunnel)
#   5. Active Bot Fight Mode
#   6. Crée les règles de rate limiting
#   7. Configure les ingress rules du tunnel
#   8. Vérifie la configuration finale
#
# Prérequis :
#   - curl, jq installés
#   - Token API Cloudflare avec permissions :
#       Zone:Read, Zone:Edit, DNS:Edit, SSL:Edit, WAF:Edit
#   - Tunnel déjà créé dans le dashboard Cloudflare Zero Trust
#
# Usage :
#   ./docker/scripts/cloudflare-setup.sh
#
# Variables requises (dans .cf-token.env ou environnement) :
#   CF_API_TOKEN       — token API Cloudflare
#   CF_DOMAIN          — domaine principal (ex: ecolemiriam.com)
#   CF_TUNNEL_ID       — ID du tunnel Cloudflare
#   CF_ACCOUNT_ID      — ID du compte Cloudflare (optionnel, auto-détecté)
#   CF_ZONE_ID         — ID de la zone (optionnel, auto-détecté)
# ============================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${GREEN}[$(date -u +%H:%M:%S)]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()  { echo -e "${RED}[ERREUR]${NC} $1"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_DIR="$(cd "$DOCKER_DIR/.." && pwd)"

# --- Charger .cf-token.env si présent ---
CF_TOKEN_ENV="${PROJECT_DIR}/.cf-token.env"
if [ -f "$CF_TOKEN_ENV" ]; then
  set -a
  # shellcheck source=/dev/null
  source "$CF_TOKEN_ENV"
  set +a
  log "Configuration chargée depuis .cf-token.env"
else
  warn ".cf-token.env non trouvé — utilisation des variables d'environnement"
fi

# --- Vérifier les dépendances ---
command -v curl >/dev/null 2>&1 || err "curl non installé"
command -v jq >/dev/null 2>&1 || err "jq non installé. Installer : apt install jq (ou brew install jq)"

# --- Vérifier les variables requises ---
[ -n "${CF_API_TOKEN:-}" ] || err "CF_API_TOKEN manquant. Voir .cf-token.env"
[ -n "${CF_DOMAIN:-}" ] || err "CF_DOMAIN manquant. Définir dans .cf-token.env (ex: ecolemiriam.com)"
[ -n "${CF_TUNNEL_ID:-}" ] || err "CF_TUNNEL_ID manquant. Définir dans .cf-token.env"

API_TOKEN="$CF_API_TOKEN"
DOMAIN="$CF_DOMAIN"
TUNNEL_ID="$CF_TUNNEL_ID"

API_BASE="https://api.cloudflare.com/client/v4"
AUTH_HEADER="Authorization: Bearer ${API_TOKEN}"
CONTENT_TYPE="Content-Type: application/json"

# --- Fonctions utilitaires ---
cf_api() {
  local method="$1"
  local endpoint="$2"
  local data="${3:-}"
  if [ -n "$data" ]; then
    curl -s -X "$method" "${API_BASE}${endpoint}" \
      -H "$AUTH_HEADER" -H "$CONTENT_TYPE" \
      -d "$data"
  else
    curl -s -X "$method" "${API_BASE}${endpoint}" \
      -H "$AUTH_HEADER" -H "$CONTENT_TYPE"
  fi
}

cf_check_success() {
  local response="$1"
  local success
  success=$(echo "$response" | jq -r '.success' 2>/dev/null || echo "false")
  if [ "$success" != "true" ]; then
    echo "$response" | jq -r '.errors[]?.message // "Erreur inconnue"' 2>/dev/null
    return 1
  fi
  return 0
}

# ============================================================
echo -e "${BLUE}============================================================${NC}"
echo -e "${BLUE}  École Miriam — Configuration Cloudflare pour ${DOMAIN}${NC}"
echo -e "${BLUE}============================================================${NC}"
echo ""

# ============================================================
# 1. Vérifier le token API et récupérer Zone ID + Account ID
# ============================================================
log "1/8 — Vérification du token API..."

VERIFY_RESP=$(cf_api GET "/user/tokens/verify")
if ! cf_check_success "$VERIFY_RESP"; then
  err "Token API invalide ou expiré"
fi
log "  → Token API valide ✓"

# Récupérer le Zone ID si non fourni
if [ -z "${CF_ZONE_ID:-}" ]; then
  log "  Récupération automatique du Zone ID..."
  ZONE_RESP=$(cf_api GET "/zones?name=${DOMAIN}")
  ZONE_ID=$(echo "$ZONE_RESP" | jq -r '.result[0].id // empty' 2>/dev/null)
  if [ -z "$ZONE_ID" ]; then
    err "Zone ${DOMAIN} introuvable. Vérifier que le domaine est ajouté à Cloudflare."
  fi
  log "  → Zone ID : ${ZONE_ID}"
else
  ZONE_ID="$CF_ZONE_ID"
  log "  → Zone ID (from env) : ${ZONE_ID}"
fi

# Récupérer le Account ID si non fourni
if [ -z "${CF_ACCOUNT_ID:-}" ]; then
  log "  Récupération automatique du Account ID..."
  ACCT_RESP=$(cf_api GET "/zones/${ZONE_ID}")
  ACCOUNT_ID=$(echo "$ACCT_RESP" | jq -r '.result.account.id // empty' 2>/dev/null)
  if [ -z "$ACCOUNT_ID" ]; then
    err "Account ID introuvable pour la zone ${DOMAIN}"
  fi
  log "  → Account ID : ${ACCOUNT_ID}"
else
  ACCOUNT_ID="$CF_ACCOUNT_ID"
  log "  → Account ID (from env) : ${ACCOUNT_ID}"
fi

# ============================================================
# 2. Configurer SSL/TLS — Full (strict) + TLS 1.2 minimum
# ============================================================
log "2/8 — Configuration SSL/TLS (Full strict)..."

SSL_RESP=$(cf_api PATCH "/zones/${ZONE_ID}/settings/ssl" \
  '{"value":"strict"}')
if cf_check_success "$SSL_RESP"; then
  log "  → SSL/TLS : Full (strict) ✓"
else
  warn "  → SSL/TLS : échec (peut-être déjà configuré)"
fi

TLS_VER_RESP=$(cf_api PATCH "/zones/${ZONE_ID}/settings/min_tls_version" \
  '{"value":"1.2"}')
if cf_check_success "$TLS_VER_RESP"; then
  log "  → TLS minimum : 1.2 ✓"
else
  warn "  → TLS minimum : échec"
fi

# ============================================================
# 3. Activer Always Use HTTPS + HSTS
# ============================================================
log "3/8 — Activation Always Use HTTPS + HSTS..."

HTTPS_RESP=$(cf_api PATCH "/zones/${ZONE_ID}/settings/always_use_https" \
  '{"value":"on"}')
if cf_check_success "$HTTPS_RESP"; then
  log "  → Always Use HTTPS : activé ✓"
else
  warn "  → Always Use HTTPS : échec"
fi

HSTS_RESP=$(cf_api PATCH "/zones/${ZONE_ID}/settings/security_header" \
  '{"strict_transport_security":{"enabled":true,"max_age":31536000,"include_subdomains":true,"preload":true,"nosniff":false}}')
if cf_check_success "$HSTS_RESP"; then
  log "  → HSTS : activé (1 an, includeSubDomains, preload) ✓"
else
  warn "  → HSTS : échec"
fi

# ============================================================
# 4. Configurer les enregistrements DNS (CNAME vers tunnel)
# ============================================================
log "4/8 — Configuration DNS..."

TUNNEL_CNAME="${TUNNEL_ID}.cfargotunnel.com"

# Fonction pour créer ou mettre à jour un enregistrement DNS CNAME
setup_dns_record() {
  local subdomain="$1"
  local proxied="${2:-true}"
  local full_domain record_name

  # "@" (ou vide) = apex. Cloudflare attend alors le domaine nu comme `name`.
  # Le CNAME à l'apex est légal ici grâce au CNAME flattening de Cloudflare.
  if [ -z "$subdomain" ] || [ "$subdomain" = "@" ]; then
    full_domain="${DOMAIN}"
    record_name="${DOMAIN}"
  else
    full_domain="${subdomain}.${DOMAIN}"
    record_name="${subdomain}"
  fi

  # Vérifier si l'enregistrement existe déjà
  EXISTING_RESP=$(cf_api GET "/zones/${ZONE_ID}/dns_records?name=${full_domain}&type=CNAME")
  EXISTING_ID=$(echo "$EXISTING_RESP" | jq -r '.result[0].id // empty' 2>/dev/null)

  local data
  data=$(jq -n --arg name "$record_name" --arg content "$TUNNEL_CNAME" --argjson proxied "$proxied" \
    '{type:"CNAME",name:$name,content:$content,proxied:$proxied}')

  if [ -n "$EXISTING_ID" ]; then
    # Mettre à jour
    UPDATE_RESP=$(cf_api PUT "/zones/${ZONE_ID}/dns_records/${EXISTING_ID}" "$data")
    if cf_check_success "$UPDATE_RESP"; then
      log "  → ${full_domain} : CNAME mis à jour → ${TUNNEL_CNAME} ✓"
    else
      warn "  → ${full_domain} : échec mise à jour"
    fi
  else
    # Créer
    CREATE_RESP=$(cf_api POST "/zones/${ZONE_ID}/dns_records" "$data")
    if cf_check_success "$CREATE_RESP"; then
      log "  → ${full_domain} : CNAME créé → ${TUNNEL_CNAME} ✓"
    else
      warn "  → ${full_domain} : échec création"
    fi
  fi
}

# Domaine canonique servi à l'apex.
setup_dns_record "@" "true"
setup_dns_record "www" "true"
# Conservé le temps de la transition — supprimable après bascule.
setup_dns_record "app" "true"
setup_dns_record "status" "true"

# ============================================================
# 5. Activer Bot Fight Mode
# ============================================================
log "5/8 — Activation Bot Fight Mode..."

BOT_RESP=$(cf_api POST "/zones/${ZONE_ID}/bots/managed_config" \
  '{"enabled":true,"mode":"block"}')
if cf_check_success "$BOT_RESP"; then
  log "  → Bot Fight Mode : activé ✓"
else
  warn "  → Bot Fight Mode : échec (peut nécessiter un plan supérieur)"
fi

# ============================================================
# 6. Créer les règles de rate limiting
# ============================================================
log "6/8 — Configuration Rate Limiting..."

# Rate limit global : 100 req/min par IP
RL_DATA=$(jq -n --arg zone_id "$ZONE_ID" '{
  description: "École Miriam — Rate limit global 100req/min",
  rate_limit: {
    characteristics: ["ip.src"],
    period: 60,
    requests_per_period: 100,
    action: { type: "block" }
  },
  match: { request: {} },
  action: { type: "block" }
}')

RL_RESP=$(cf_api POST "/zones/${ZONE_ID}/rulesets/phases/http_ratelimit/entrypoint" "$RL_DATA")
if cf_check_success "$RL_RESP"; then
  log "  → Rate limiting : 100 req/min par IP ✓"
else
  warn "  → Rate limiting : échec (peut-être déjà configuré)"
fi

# ============================================================
# 7. Configurer les ingress rules du tunnel
# ============================================================
log "7/8 — Configuration des ingress rules du tunnel..."

INGRESS_DATA=$(jq -n '{
  config: {
    ingress: [
      {
        hostname: "app.'"$DOMAIN"'",
        service: "http://caddy:8080",
        originRequest: {
          noTLSVerify: false,
          connectTimeout: 10,
          keepAliveTimeout: 30,
          http2Origin: true
        }
      },
      {
        hostname: "status.'"$DOMAIN"'",
        service: "http://caddy:8081",
        originRequest: {
          noTLSVerify: false
        }
      },
      {
        service: "http_status:404"
      }
    ]
  }
}')

INGRESS_RESP=$(cf_api PUT "/accounts/${ACCOUNT_ID}/cfd_tunnel/${TUNNEL_ID}/configurations" "$INGRESS_DATA")
if cf_check_success "$INGRESS_RESP"; then
  log "  → Ingress rules : app.${DOMAIN} + status.${DOMAIN} ✓"
else
  warn "  → Ingress rules : échec (configurer manuellement dans le dashboard)"
fi

# ============================================================
# 8. Vérification finale
# ============================================================
log "8/8 — Vérification finale..."

# Vérifier SSL
SSL_CHECK=$(cf_api GET "/zones/${ZONE_ID}/settings/ssl" | jq -r '.result.value // ""')
if [ "$SSL_CHECK" = "strict" ]; then
  log "  → SSL/TLS : Full (strict) ✓"
else
  warn "  → SSL/TLS : valeur actuelle = ${SSL_CHECK}"
fi

# Vérifier DNS app
DNS_CHECK=$(cf_api GET "/zones/${ZONE_ID}/dns_records?name=app.${DOMAIN}" | jq -r '.result[0].content // ""')
if [ "$DNS_CHECK" = "$TUNNEL_CNAME" ]; then
  log "  → DNS app.${DOMAIN} : ${TUNNEL_CNAME} ✓"
else
  warn "  → DNS app.${DOMAIN} : non configuré"
fi

# Vérifier DNS status
DNS_STATUS_CHECK=$(cf_api GET "/zones/${ZONE_ID}/dns_records?name=status.${DOMAIN}" | jq -r '.result[0].content // ""')
if [ "$DNS_STATUS_CHECK" = "$TUNNEL_CNAME" ]; then
  log "  → DNS status.${DOMAIN} : ${TUNNEL_CNAME} ✓"
else
  warn "  → DNS status.${DOMAIN} : non configuré"
fi

echo ""
echo -e "${BLUE}============================================================${NC}"
log "=== Configuration Cloudflare terminée ✓ ==="
echo -e "${BLUE}============================================================${NC}"
echo ""
log "PROCHAINES ÉTAPES :"
log "  1. Stocker le token du tunnel dans docker/secrets/"
log "     echo \"TOKEN_TUNNEL\" > docker/secrets/cloudflare_tunnel_token.txt"
log "     chmod 600 docker/secrets/cloudflare_tunnel_token.txt"
log ""
log "  2. Démarrer la stack :"
log "     cd docker && docker compose up -d"
log ""
log "  3. Vérifier :"
log "     curl -f https://app.${DOMAIN}/api/health"
log "     curl -sI https://app.${DOMAIN} | grep -i security"
log ""
warn "⚠  Configurer également l'Access Policy pour status.${DOMAIN} :"
warn "   Dashboard Zero Trust → Access → Applications"
warn "   Créer une policy email whitelist pour les admins"
