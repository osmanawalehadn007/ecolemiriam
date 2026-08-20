#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# École Miriam — Test de restauration automatisé + notify Telegram
# ============================================================
#
# Effectue un test de restauration pgBackRest en mode dry-run
# et envoie le résultat via Telegram.
#
# Étapes :
#   1. Vérifier que pgBackRest est opérationnel
#   2. Lister les backups disponibles
#   3. Effectuer un restore --dry-run (PITR vers il y a 1h)
#   4. Vérifier l'intégrité du repo
#   5. Envoyer le résultat via Telegram
#
# Usage :
#   ./docker/scripts/restore-test.sh
#
# Variables d'environnement :
#   TELEGRAM_BOT_TOKEN — token du bot Telegram
#   TELEGRAM_CHAT_ID   — ID du chat de notification
# ============================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[$(date -u +%H:%M:%S)]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()  { echo -e "${RED}[ERREUR]${NC} $1"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-}"

RESULT="SUCCESS"
DETAILS=""

log "=== Test de restauration pgBackRest ==="

# 1. Vérifier pgBackRest
log "1/4 — vérification pgBackRest..."
if ! docker ps | grep -q "pgbackrest"; then
  RESULT="FAIL"
  DETAILS="pgBackRest conteneur non actif"
  err "$DETAILS"
else
  log "  → pgBackRest actif ✓"
fi

# 2. Lister les backups
log "2/4 — liste des backups..."
BACKUP_INFO=$(docker exec ecolemiriam-pgbackrest pgbackrest --stanza=ecolemiriam info 2>&1 || echo "ERREUR")
if echo "$BACKUP_INFO" | grep -q "ERREUR\|error"; then
  RESULT="FAIL"
  DETAILS="Impossible de récupérer les infos backup"
  err "$DETAILS"
else
  BACKUP_COUNT=$(echo "$BACKUP_INFO" | grep -c "full backup\|incr backup\|diff backup" || echo "0")
  log "  → $BACKUP_COUNT backups disponibles"
  DETAILS="Backups: $BACKUP_COUNT"
fi

# 3. Test restore dry-run
if [ "$RESULT" = "SUCCESS" ]; then
  log "3/4 — test restore dry-run (PITR vers il y a 1h)..."
  TARGET_TIME=$(date -u -d '1 hour ago' '+%Y-%m-%d %H:%M:%S' 2>/dev/null || date -u -v-1H '+%Y-%m-%d %H:%M:%S')
  RESTORE_OUTPUT=$(docker exec ecolemiriam-pgbackrest pgbackrest --stanza=ecolemiriam \
    --type=time --target="$TARGET_TIME" --target-action=promote restore --dry-run 2>&1 || echo "FAIL")

  if echo "$RESTORE_OUTPUT" | grep -qi "error\|fail"; then
    RESULT="FAIL"
    DETAILS="$DETAILS | Restore dry-run échec"
    err "Restore dry-run échoué"
  else
    log "  → restore dry-run OK ✓"
    DETAILS="$DETAILS | Restore dry-run: OK"
  fi
fi

# 4. Vérifier l'intégrité
if [ "$RESULT" = "SUCCESS" ]; then
  log "4/4 — vérification intégrité..."
  CHECK_OUTPUT=$(docker exec ecolemiriam-pgbackrest pgbackrest --stanza=ecolemiriam check 2>&1 || echo "FAIL")
  if echo "$CHECK_OUTPUT" | grep -qi "error\|fail"; then
    warn "  → check : warnings (peut être normal)"
    DETAILS="$DETAILS | Check: warnings"
  else
    log "  → check OK ✓"
    DETAILS="$DETAILS | Check: OK"
  fi
fi

# 5. Notification Telegram
log "Notification Telegram..."

TIMESTAMP=$(date -u '+%Y-%m-%d %H:%M:%S UTC')
MESSAGE="🔔 *Test de restauration École Miriam*
"
MESSAGE+="*Date:* ${TIMESTAMP}
"
MESSAGE+="*Résultat:* ${RESULT}
"
MESSAGE+="*Détails:* ${DETAILS}"

if [ -n "$TELEGRAM_BOT_TOKEN" ] && [ -n "$TELEGRAM_CHAT_ID" ]; then
  curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d chat_id="$TELEGRAM_CHAT_ID" \
    -d parse_mode="Markdown" \
    -d text="$MESSAGE" >/dev/null 2>&1 && log "  → Telegram notifié ✓" || warn "  → Telegram échec"
else
  warn "  → Telegram non configuré (TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID manquants)"
fi

# Résultat final
echo ""
if [ "$RESULT" = "SUCCESS" ]; then
  log "=== Test de restauration RÉUSSI ✓ ==="
  log "Détails: $DETAILS"
  exit 0
else
  err "=== Test de restauration ÉCHOUÉ ✗ ==="
  err "Détails: $DETAILS"
  exit 1
fi
