#!/usr/bin/env bash
# ============================================================
# École Miriam — Installation des hooks Git
# ============================================================
# Copie les hooks versionnés depuis scripts/git-hooks/ vers .git/hooks/
# pour qu'ils soient actifs localement.
#
# Les hooks ne peuvent pas être versionnés directement dans .git/hooks/
# (Git ignore ce dossier), donc on les garde dans le dépôt et on les
# installe via ce script.
#
# Usage : ./scripts/install-git-hooks.sh
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOKS_SRC="${SCRIPT_DIR}/git-hooks"
HOOKS_DST="$(cd "$SCRIPT_DIR/.." && pwd)/.git/hooks"

if [ ! -d "$HOOKS_SRC" ]; then
  echo "Erreur: $HOOKS_SRC n'existe pas" >&2
  exit 1
fi

if [ ! -d "$HOOKS_DST" ]; then
  echo "Erreur: $HOOKS_DST n'existe pas — êtes-vous dans un dépôt Git ?" >&2
  exit 1
fi

for hook in "$HOOKS_SRC"/*; do
  [ -f "$hook" ] || continue
  name=$(basename "$hook")
  dst="${HOOKS_DST}/${name}"
  cp "$hook" "$dst"
  chmod +x "$dst"
  echo "  [OK] ${name} installé"
done

echo ""
echo "Hooks Git installés. Ils s'exécuteront automatiquement à chaque commit."
