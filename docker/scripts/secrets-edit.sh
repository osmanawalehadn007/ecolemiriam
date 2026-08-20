#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# École Miriam — Édition des secrets SOPS
# ============================================================
#
# Déchiffre, ouvre dans $EDITOR, rechiffre automatiquement.
#
# Usage :
#   ./docker/scripts/secrets-edit.sh
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SECRETS_YAML="${DOCKER_DIR}/secrets/secrets.yaml"
AGE_KEY_FILE="${DOCKER_DIR}/keys/age-key.txt"

[ -f "$SECRETS_YAML" ] || { echo "Erreur: $SECRETS_YAML introuvable"; exit 1; }
[ -f "$AGE_KEY_FILE" ] || { echo "Erreur: $AGE_KEY_FILE introuvable"; exit 1; }

echo "[secrets] Ouverture de $SECRETS_YAML dans ${EDITOR:-vi}..."
SOPS_AGE_KEY_FILE="$AGE_KEY_FILE" sops "$SECRETS_YAML"
echo "[secrets] Modifications enregistrées et rechiffrées ✓"
