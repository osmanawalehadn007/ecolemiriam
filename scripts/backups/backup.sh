#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# École Miriam — Sauvegarde PostgreSQL chiffrée + upload off-site
# ============================================================
#
# Usage :
#   ./scripts/backups/backup.sh
#
# Prérequis :
#   - pg_dump (libpq-client) installé
#   - age (chiffrement) : brew install age  /  apt install age
#   - rclone (upload) configuré pour un remote (R2, S3, Backblaze…)
#     → rclone config  (nommer le remote "ecolemiriam-backup")
#
# Variables d'environnement (à définir dans .env ou CI) :
#   DIRECT_URL      — URL Postgres directe (rôle propriétaire)
#   BACKUP_AGE_KEY  — clé publique age pour le chiffrement
#   BACKUP_RCLONE_REMOTE — nom du remote rclone (défaut: ecolemiriam-backup)
#   BACKUP_RETENTION_DAYS — rétention off-site (défaut: 30)
#
# Cron recommandé (quotidien à 02h) :
#   0 2 * * * /path/to/ecolemiriam/scripts/backups/backup.sh >> /var/log/ecolemiriam-backup.log 2>&1
# ============================================================

DIRECT_URL="${DIRECT_URL:?DIRECT_URL est requis (URL Postgres directe)}"
AGE_KEY="${BACKUP_AGE_KEY:?BACKUP_AGE_KEY est requis (clé publique age)}"
REMOTE="${BACKUP_RCLONE_REMOTE:-ecolemiriam-backup}"
# Le remote rclone est de type s3 (Cloudflare R2) : le bucket fait partie du
# chemin, il n'est pas dans la configuration du remote. Sans lui, rclone prend
# le nom du fichier pour un bucket et échoue en « Key must not be empty ».
BUCKET="${BACKUP_RCLONE_BUCKET:-ecolemiriam}"
DEST="${REMOTE}:${BUCKET}"
RETENTION="${BACKUP_RETENTION_DAYS:-30}"

TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
# Préfixe fixe, et non le nom d'hôte : sur un runner CI il change à chaque
# exécution, ce qui rendait la rétention et le test de restauration incapables
# de retrouver les sauvegardes précédentes.
PREFIX="ecolemiriam-ci"
FILENAME="${PREFIX}-${TIMESTAMP}.sql.gz.age"
TMPDIR=$(mktemp -d)
TMPFILE="${TMPDIR}/dump.sql.gz"

trap 'rm -rf "$TMPDIR"' EXIT

echo "[$(date -u +%FT%TZ)] Début de la sauvegarde → ${FILENAME}"

# 1. pg_dump (format custom, compression native, parallèle si possible)
#    On utilise --no-owner pour que le restore fonctionne sur un autre serveur.
#    --no-privileges évite les conflits de rôles lors du restore.
echo "  → pg_dump..."
pg_dump "$DIRECT_URL" \
  --no-owner \
  --no-privileges \
  --format=custom \
  --compress=9 \
  --file="$TMPFILE"

# Vérifier que le dump n'est pas vide
SIZE=$(stat -f%z "$TMPFILE" 2>/dev/null || stat -c%s "$TMPFILE" 2>/dev/null)
if [ "$SIZE" -lt 1024 ]; then
  echo "ERREUR: dump trop petit ($SIZE octets) — abandon"
  exit 1
fi
echo "  → dump: $(du -h "$TMPFILE" | cut -f1)"

# 2. Chiffrement avec age (clé publique, pas de secret à stocker côté backup)
echo "  → chiffrement age..."
age --encrypt --recipient "$AGE_KEY" "$TMPFILE" > "${TMPFILE}.age"

# 3. Upload off-site via rclone
echo "  → upload rclone → ${DEST}/${FILENAME}"
rclone copy "${TMPFILE}.age" "${DEST}/" \
  --no-traverse \
  --transfers 1 \
  --retries 3

# 4. Vérification : lister le fichier distant et comparer la taille
REMOTE_SIZE=$(rclone size "${DEST}/${FILENAME}" --json 2>/dev/null \
  | grep -o '"bytes":[0-9]*' | grep -o '[0-9]*' || echo 0)
LOCAL_SIZE=$(stat -f%z "${TMPFILE}.age" 2>/dev/null || stat -c%s "${TMPFILE}.age" 2>/dev/null)

if [ "$REMOTE_SIZE" != "$LOCAL_SIZE" ]; then
  echo "ERREUR: taille distante ($REMOTE_SIZE) ≠ locale ($LOCAL_SIZE)"
  exit 1
fi
echo "  → upload vérifié: $LOCAL_SIZE octets"

# 5. Nettoyage off-site : supprimer les backups > RETENTION_DAYS
echo "  → nettoyage off-site (rétention ${RETENTION} jours)..."
rclone delete "${DEST}/" \
  --include "${PREFIX}-*.sql.gz.age" \
  --min-age "${RETENTION}d" \
  --rmdirs=false

echo "[$(date -u +%FT%TZ)] Sauvegarde terminée ✓"
