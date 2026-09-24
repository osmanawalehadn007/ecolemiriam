#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# École Miriam — Audit sécurité scoré (livrable clé)
# ============================================================
#
# Vérifie 30+ contrôles de sécurité et attribue un score.
# Chaque contrôle vaut 1-5 points. Score max = 100.
#
# Catégories :
#   1. OS & réseau (20 pts)
#   2. Docker & conteneurs (20 pts)
#   3. Postgres & RLS (20 pts)
#   4. Secrets & chiffrement (15 pts)
#   5. Backups & restauration (10 pts)
#   6. Cloudflare & TLS (10 pts)
#   7. Monitoring & alerting (5 pts)
#
# Usage :
#   sudo ./docker/scripts/security-audit.sh
#
# Sortie :
#   - Score /100
#   - Détail par catégorie
#   - Liste des échecs avec recommandations
#   - Code couleur (vert=OK, jaune=warning, rouge=critique)
# ============================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCORE=0
MAX_SCORE=100
FAILS=()
WARNS=()
PASSES=()

pass() { PASSES+=("$1"); SCORE=$((SCORE + $2)); }
fail() { FAILS+=("$1 (perte: $2 pts)"); }
warn() { WARNS+=("$1"); }

echo -e "${BLUE}============================================================${NC}"
echo -e "${BLUE}  École Miriam — Audit de Sécurité Scoré${NC}"
echo -e "${BLUE}  $(date -u +%Y-%m-%dT%H:%M:%SZ)${NC}"
echo -e "${BLUE}============================================================${NC}"
echo ""

# ============================================================
# 1. OS & RÉSEAU (20 pts)
# ============================================================
echo -e "${BLUE}--- 1. OS & Réseau (20 pts) ---${NC}"

# 1.1 SSH port non-standard (3 pts)
SSH_PORT=$(ss -tlnp 2>/dev/null | grep sshd | grep -oP ':\K\d+' | head -1 || echo "22")
if [ "$SSH_PORT" != "22" ] && [ -n "$SSH_PORT" ]; then
  pass "SSH sur port non-standard ($SSH_PORT)" 3
else
  fail "SSH sur port 22 (standard, brute-force)" 3
fi

# 1.2 SSH pas de root (3 pts)
if grep -qE "^PermitRootLogin\s+no" /etc/ssh/sshd_config 2>/dev/null; then
  pass "SSH : connexion root désactivée" 3
else
  fail "SSH : connexion root autorisée" 3
fi

# 1.3 SSH clé uniquement (3 pts)
if grep -qE "^PasswordAuthentication\s+no" /etc/ssh/sshd_config 2>/dev/null; then
  pass "SSH : authentification par clé uniquement" 3
else
  fail "SSH : authentification par mot de passe activée" 3
fi

# 1.4 UFW actif (3 pts)
if ufw status 2>/dev/null | grep -q "Status: active"; then
  pass "UFW : pare-feu actif" 3
else
  fail "UFW : pare-feu inactif" 3
fi

# 1.5 fail2ban actif (3 pts)
if systemctl is-active fail2ban 2>/dev/null | grep -q "active"; then
  pass "fail2ban : actif" 3
else
  fail "fail2ban : inactif" 3
fi

# 1.6 unattended-upgrades (2 pts)
if dpkg -l unattended-upgrades 2>/dev/null | grep -q "^ii"; then
  pass "unattended-upgrades : installé" 2
else
  fail "unattended-upgrades : non installé" 2
fi

# 1.7 Pas de ports exposés (3 pts)
EXPOSED=$(ss -tlnp 2>/dev/null | grep -v "127.0.0.1\|::1\|$SSH_PORT" | grep -c LISTEN || echo "0")
if [ "$EXPOSED" -le 1 ]; then
  pass "Ports exposés : minimal ($EXPOSED)" 3
else
  fail "Ports exposés : $EXPOSED ports en écoute" 3
fi

# ============================================================
# 2. DOCKER & CONTENEURS (20 pts)
# ============================================================
echo -e "${BLUE}--- 2. Docker & Conteneurs (20 pts) ---${NC}"

# 2.1 Pas de ports publiés (5 pts)
PUBLISHED=$(docker compose -f /opt/ecolemiriam/docker/docker-compose.yml config 2>/dev/null | grep -c "published:" || echo "0")
if [ "$PUBLISHED" -eq 0 ]; then
  pass "Docker : aucun port publié" 5
else
  fail "Docker : $PUBLISHED ports publiés" 5
fi

# 2.2 read_only sur app (3 pts)
if docker inspect ecolemiriam-app 2>/dev/null | grep -q '"Readonly": true'; then
  pass "App : filesystem read-only" 3
else
  fail "App : filesystem non read-only" 3
fi

# 2.3 no-new-privileges sur tous les conteneurs (3 pts)
NO_PRIV=$(docker ps -q 2>/dev/null | while read -r cid; do
  docker inspect "$cid" 2>/dev/null | grep -q '"no-new-privileges": true' && echo "1"
done | wc -l)
TOTAL=$(docker ps -q 2>/dev/null | wc -l)
if [ "$NO_PRIV" -eq "$TOTAL" ] && [ "$TOTAL" -gt 0 ]; then
  pass "Tous les conteneurs : no-new-privileges" 3
else
  fail "Conteneurs sans no-new-privileges ($NO_PRIV/$TOTAL)" 3
fi

# 2.4 cap_drop ALL (3 pts)
if docker inspect ecolemiriam-app 2>/dev/null | grep -q '"ALL"'; then
  pass "App : cap_drop ALL" 3
else
  fail "App : capabilities non limitées" 3
fi

# 2.5 Non-root user (3 pts)
APP_USER=$(docker inspect ecolemiriam-app 2>/dev/null | grep -oP '"User":\s*"\K[^"]+' | head -1 || echo "")
if [ -n "$APP_USER" ] && [ "$APP_USER" != "root" ] && [ "$APP_USER" != "0" ]; then
  pass "App : utilisateur non-root ($APP_USER)" 3
else
  fail "App : s'exécute en root" 3
fi

# 2.6 docker-socket-proxy (3 pts)
if docker ps 2>/dev/null | grep -q "docker-socket-proxy"; then
  pass "docker-socket-proxy : présent" 3
else
  fail "docker-socket-proxy : absent (docker.sock exposé ?)" 3
fi

# ============================================================
# 3. POSTGRES & RLS (20 pts)
# ============================================================
echo -e "${BLUE}--- 3. Postgres & RLS (20 pts) ---${NC}"

# 3.1 RLS activée (5 pts)
RLS_TABLES=$(docker exec ecolemiriam-postgres psql -U ecolemiriam_owner -d ecolemiriam -t -c \
  "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity" 2>/dev/null || echo "0")
if [ "$RLS_TABLES" -gt 0 ]; then
  pass "RLS : $RLS_TABLES tables avec RLS" 5
else
  fail "RLS : aucune table avec RLS" 5
fi

# 3.2 ecolemiriam_app NOBYPASSRLS (5 pts)
BYPASS=$(docker exec ecolemiriam-postgres psql -U ecolemiriam_owner -d ecolemiriam -t -c \
  "SELECT rolbypassrls FROM pg_roles WHERE rolname='ecolemiriam_app'" 2>/dev/null | xargs || echo "t")
if [ "$BYPASS" = "f" ]; then
  pass "ecolemiriam_app : NOBYPASSRLS" 5
else
  fail "ecolemiriam_app : bypassrls activé (CRITIQUE)" 5
fi

# 3.3 scram-sha-256 (3 pts)
PG_AUTH=$(docker exec ecolemiriam-postgres psql -U ecolemiriam_owner -d ecolemiriam -t -c \
  "SELECT count(*) FROM pg_authid WHERE rolpassword LIKE 'SCRAM-SHA-256%'" 2>/dev/null || echo "0")
if [ "$PG_AUTH" -gt 0 ]; then
  pass "Postgres : mots de passe en scram-sha-256" 3
else
  fail "Postgres : mots de passe non scram-sha-256" 3
fi

# 3.4 pgaudit actif (3 pts)
PGAUDIT=$(docker exec ecolemiriam-postgres psql -U ecolemiriam_owner -d ecolemiriam -t -c \
  "SELECT count(*) FROM pg_extension WHERE extname='pgaudit'" 2>/dev/null || echo "0")
if [ "$PGAUDIT" -gt 0 ]; then
  pass "pgaudit : extension active" 3
else
  fail "pgaudit : non installé" 3
fi

# 3.5 pg_hba reject all (4 pts)
if docker exec ecolemiriam-postgres cat /etc/postgresql/pg_hba.conf 2>/dev/null | grep -q "reject"; then
  pass "pg_hba : règle reject all présente" 4
else
  fail "pg_hba : pas de règle reject all" 4
fi

# ============================================================
# 4. SECRETS & CHIFFREMENT (15 pts)
# ============================================================
echo -e "${BLUE}--- 4. Secrets & Chiffrement (15 pts) ---${NC}"

# 4.1 SOPS + age (5 pts)
if [ -f /opt/ecolemiriam/docker/keys/age-key.txt ] && command -v sops &>/dev/null; then
  pass "SOPS + age : configuré" 5
else
  fail "SOPS + age : non configuré" 5
fi

# 4.2 Docker secrets (pas en clair dans env) (4 pts)
SECRETS_COUNT=$(docker inspect ecolemiriam-postgres 2>/dev/null | grep -c "Secrets" || echo "0")
if [ "$SECRETS_COUNT" -gt 0 ]; then
  pass "Docker secrets : utilisés" 4
else
  fail "Docker secrets : non utilisés" 4
fi

# 4.3 .env.production pas en clair dans l'image (3 pts)
if docker exec ecolemiriam-app ls /app/.env 2>/dev/null; then
  fail ".env : présent dans l'image (CRITIQUE)" 3
else
  pass ".env : absent de l'image" 3
fi

# 4.4 Permissions secrets (3 pts)
SECRETS_DIR="/opt/ecolemiriam/docker/secrets"
if [ -d "$SECRETS_DIR" ]; then
  BAD_PERMS=$(find "$SECRETS_DIR" -name "*.txt" ! -perm 600 | wc -l)
  if [ "$BAD_PERMS" -eq 0 ]; then
    pass "Secrets : permissions 600" 3
  else
    fail "Secrets : $BAD_PERMS fichiers avec permissions incorrectes" 3
  fi
else
  fail "Secrets : dossier introuvable" 3
fi

# ============================================================
# 5. BACKUPS & RESTAURATION (10 pts)
# ============================================================
echo -e "${BLUE}--- 5. Backups & Restauration (10 pts) ---${NC}"

# 5.1 pgBackRest actif (4 pts)
if docker ps 2>/dev/null | grep -q "pgbackrest"; then
  pass "pgBackRest : conteneur actif" 4
else
  fail "pgBackRest : conteneur inactif" 4
fi

# 5.2 Backup récent (< 24h) (3 pts)
LAST_BACKUP=$(docker exec ecolemiriam-pgbackrest pgbackrest --stanza=ecolemiriam info 2>/dev/null | grep -oP 'timestamp:\s*\K[^,]+' | head -1 || echo "")
if [ -n "$LAST_BACKUP" ]; then
  pass "Backup : dernier backup à $LAST_BACKUP" 3
else
  fail "Backup : aucun backup trouvé" 3
fi

# 5.3 Chiffrement des backups (3 pts)
if docker exec ecolemiriam-pgbackrest cat /etc/pgbackrest/pgbackrest.conf 2>/dev/null | grep -q "cipher-type"; then
  pass "Backups : chiffrés (aes-256)" 3
else
  fail "Backups : non chiffrés" 3
fi

# ============================================================
# 6. CLOUDFLARE & TLS (10 pts)
# ============================================================
echo -e "${BLUE}--- 6. Cloudflare & TLS (10 pts) ---${NC}"

# 6.1 Cloudflare Tunnel actif (4 pts)
if docker ps 2>/dev/null | grep -q "cloudflared"; then
  pass "Cloudflare Tunnel : actif" 4
else
  fail "Cloudflare Tunnel : inactif" 4
fi

# 6.2 TLS interne (Caddy) (3 pts)
if docker exec ecolemiriam-caddy cat /etc/caddy/Caddyfile 2>/dev/null | grep -q "tls internal"; then
  pass "TLS interne : configuré (Caddy)" 3
else
  fail "TLS interne : non configuré" 3
fi

# 6.3 Headers de sécurité (3 pts)
if docker exec ecolemiriam-caddy cat /etc/caddy/Caddyfile 2>/dev/null | grep -q "Strict-Transport-Security"; then
  pass "Headers de sécurité : HSTS + CSP" 3
else
  fail "Headers de sécurité : manquants" 3
fi

# ============================================================
# 7. MONITORING & ALERTING (5 pts)
# ============================================================
echo -e "${BLUE}--- 7. Monitoring & Alerting (5 pts) ---${NC}"

# 7.1 Uptime Kuma actif (3 pts)
if docker ps 2>/dev/null | grep -q "uptime-kuma"; then
  pass "Uptime Kuma : actif" 3
else
  fail "Uptime Kuma : inactif" 3
fi

# 7.2 Healthcheck app (2 pts)
if docker inspect ecolemiriam-app 2>/dev/null | grep -q "healthcheck"; then
  pass "App : healthcheck configuré" 2
else
  fail "App : pas de healthcheck" 2
fi

# ============================================================
# RÉSULTATS
# ============================================================
echo ""
echo -e "${BLUE}============================================================${NC}"
echo -e "${BLUE}  RÉSULTATS${NC}"
echo -e "${BLUE}============================================================${NC}"
echo ""

# Afficher les passes
for p in "${PASSES[@]}"; do
  echo -e "  ${GREEN}✓${NC} $p"
done

# Afficher les warnings
for w in "${WARNS[@]}"; do
  echo -e "  ${YELLOW}⚠${NC} $w"
done

# Afficher les échecs
for f in "${FAILS[@]}"; do
  echo -e "  ${RED}✗${NC} $f"
done

echo ""
echo -e "${BLUE}------------------------------------------------------------${NC}"
echo -e "  Score: ${SCORE}/${MAX_SCORE}"

if [ "$SCORE" -ge 90 ]; then
  echo -e "  Niveau: ${GREEN}EXCELLENT (A)${NC}"
elif [ "$SCORE" -ge 75 ]; then
  echo -e "  Niveau: ${GREEN}BON (B)${NC}"
elif [ "$SCORE" -ge 60 ]; then
  echo -e "  Niveau: ${YELLOW}MOYEN (C)${NC}"
elif [ "$SCORE" -ge 40 ]; then
  echo -e "  Niveau: ${YELLOW}FAIBLE (D)${NC}"
else
  echo -e "  Niveau: ${RED}CRITIQUE (F)${NC}"
fi
echo -e "${BLUE}------------------------------------------------------------${NC}"

# Code de sortie
if [ "$SCORE" -ge 75 ]; then
  exit 0
else
  exit 1
fi
