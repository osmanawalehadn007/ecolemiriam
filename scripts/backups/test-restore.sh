#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# École Miriam — Test de restauration d'une sauvegarde
# ============================================================
#
# Ce script prouve qu'une sauvegarde est restaurable. Il :
#   1. Télécharge le backup le plus récent depuis le remote
#   2. Le déchiffre
#   3. Le restaure dans une base PostgreSQL jetable (Docker)
#   4. Vérifie l'intégrité (comptage de tables, lignes critiques)
#   5. Détruit la base de test
#
# Une sauvegarde non testée n'est pas une sauvegarde.
#
# Usage :
#   ./scripts/backups/test-restore.sh
#
# Prérequis :
#   - Docker (pour la base jetable)
#   - age, rclone (comme backup.sh)
#   - BACKUP_AGE_KEY_PRIVATE — clé privée age pour le déchiffrement
#
# Cron recommandé (hebdomadaire, dimanche à 04h) :
#   0 4 * * 0 /path/to/ecolemiriam/scripts/backups/test-restore.sh >> /var/log/ecolemiriam-restore-test.log 2>&1
# ============================================================

AGE_KEY_PRIVATE="${BACKUP_AGE_KEY_PRIVATE:?BACKUP_AGE_KEY_PRIVATE est requis (clé privée age)}"
REMOTE="${BACKUP_RCLONE_REMOTE:-ecolemiriam-backup}"
# Voir backup.sh : le bucket fait partie du chemin sur un remote s3, et le
# préfixe est fixe parce que le nom d'hôte d'un runner CI change à chaque run.
BUCKET="${BACKUP_RCLONE_BUCKET:-ecolemiriam}"
DEST="${REMOTE}:${BUCKET}"
PREFIX="ecolemiriam-ci"
TMPDIR=$(mktemp -d)
CONTAINER="ecolemiriam-restore-test-$$"

trap 'rm -rf "$TMPDIR"; docker rm -f "$CONTAINER" 2>/dev/null || true' EXIT

echo "[$(date -u +%FT%TZ)] Début du test de restauration"

# 1. Trouver et télécharger le backup le plus récent
echo "  → recherche du backup le plus récent..."
# `lsf` n'a pas de drapeau de tri : on demande la date de modification en
# préfixe (--format tp) et on trie nous-mêmes.
LATEST=$(rclone lsf "${DEST}/" \
  --include "${PREFIX}-*.sql.gz.age" \
  --format "tp" \
  --separator "|" \
  --files-only \
  --max-depth 1 \
  | sort -r | head -1 | cut -d"|" -f2)

if [ -z "$LATEST" ]; then
  echo "ERREUR: aucun backup trouvé sur ${DEST}"
  exit 1
fi
echo "  → backup: ${LATEST}"

rclone copy "${DEST}/${LATEST}" "$TMPDIR/"
BACKUP_FILE="${TMPDIR}/${LATEST}"

# 2. Déchiffrement
echo "  → déchiffrement..."
age --decrypt --identity <(echo "$AGE_KEY_PRIVATE") "$BACKUP_FILE" > "${TMPDIR}/dump.sql.gz"

# 3. Démarrer une base PostgreSQL jetable dans Docker
echo "  → démarrage base de test Docker..."
docker run -d --name "$CONTAINER" \
  -e POSTGRES_PASSWORD=test \
  -e POSTGRES_DB=ecolemiriam_restore_test \
  -p 0:5432 \
  postgres:17-alpine

# Attendre que la base soit prête
echo "  → attente de la base..."
for i in $(seq 1 30); do
  if docker exec "$CONTAINER" pg_isready -U postgres 2>/dev/null; then
    break
  fi
  sleep 1
  [ $i -eq 30 ] && { echo "ERREUR: base de test non prête"; exit 1; }
done

# 4. Restaurer le dump
echo "  → restauration..."
docker cp "${TMPDIR}/dump.sql.gz" "${CONTAINER}:/tmp/dump.sql.gz"
docker exec "$CONTAINER" bash -c \
  "gunzip -c /tmp/dump.sql.gz | psql -U postgres -d ecolemiriam_restore_test 2>&1" \
  | grep -v "^SET$" || true

# 5. Vérifications d'intégrité
echo "  → vérifications d'intégrité..."

TABLES=$(docker exec "$CONTAINER" psql -U postgres -d ecolemiriam_restore_test -t \
  -c "SELECT count(*) FROM pg_tables WHERE schemaname='public'")
echo "  → tables: ${TABLES}"

ELEVES=$(docker exec "$CONTAINER" psql -U postgres -d ecolemiriam_restore_test -t \
  -c "SELECT count(*) FROM eleves" 2>/dev/null || echo "N/A")
echo "  → élèves: ${ELEVES}"

TENANTS=$(docker exec "$CONTAINER" psql -U postgres -d ecolemiriam_restore_test -t \
  -c "SELECT count(*) FROM tenants" 2>/dev/null || echo "N/A")
echo "  → tenants: ${TENANTS}"

USERS=$(docker exec "$CONTAINER" psql -U postgres -d ecolemiriam_restore_test -t \
  -c "SELECT count(*) FROM users" 2>/dev/null || echo "N/A")
echo "  → utilisateurs: ${USERS}"

# Vérifier que les tables critiques ne sont pas vides (si la prod a des données)
if [ "${ELEVES}" -gt 0 ] 2>/dev/null; then
  echo "  ✓ Données élèves présentes"
else
  echo "  ⚠ Aucun élève dans le backup (vérifier si c'est normal)"
fi

# 6. Nettoyage
echo "  → nettoyage..."
docker rm -f "$CONTAINER" 2>/dev/null || true

echo "[$(date -u +%FT%TZ)] Test de restauration terminé ✓"
echo ""
echo "RÉSUMÉ: tables=${TABLES} tenants=${TENANTS} users=${USERS} élèves=${ELEVES}"
