#!/usr/bin/env bash
# ============================================================
# Configure un dépôt GitHub pour le déploiement d'EcolPro :
#   1. secrets Actions (valeurs lues dans un fichier local ou saisies au clavier)
#   2. environnements `staging` (libre) et `production` (relecteur obligatoire,
#      branche main uniquement)
#   3. règle de protection de main (« Protection main », contrôle requis :
#      « Porte de promotion intacte »)
#
# Pourquoi un script local et pas un workflow GitHub : le GITHUB_TOKEN d'un
# workflow ne peut ni écrire de secrets ni créer d'environnements, et les valeurs
# saisies comme paramètres d'un workflow apparaissent dans l'interface et les
# journaux. Ce script n'affiche, ne journalise et ne stocke aucune valeur : elles
# vont de votre fichier vers GitHub (chiffrées par `gh`), c'est tout.
#
# Prérequis :
#   - `gh` connecté avec le compte PROPRIÉTAIRE du dépôt (droit admin) : gh auth login
#   - un fichier de secrets rempli : cp scripts/github/secrets.env.modele .github-secrets.env
#
# Usage :
#   bash scripts/github/configurer-depot.sh [--dry-run] [--sans-secrets] [--sans-environnements]
#                                           [--sans-regle] [depot]
#   (depot par défaut : osmanawalehadn007/ecolemiriam)
# Rejouable : un secret ou un environnement existant est mis à jour, jamais dupliqué.
# Les environnements avec relecteur obligatoire et les règles sur un dépôt PRIVÉ
# exigent un plan GitHub payant ; sur un dépôt public, ils sont gratuits.
# ============================================================
set -euo pipefail

REPO="osmanawalehadn007/ecolemiriam"
DRY=0; DO_SECRETS=1; DO_ENVS=1; DO_RULE=1
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY=1 ;;
    --sans-secrets) DO_SECRETS=0 ;;
    --sans-environnements) DO_ENVS=0 ;;
    --sans-regle) DO_RULE=0 ;;
    -h|--help) sed -n '2,29p' "$0"; exit 0 ;;
    -*) echo "Option inconnue : $arg" >&2; exit 2 ;;
    *) REPO="$arg" ;;
  esac
done

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SECRETS_FILE="${SECRETS_FILE:-.github-secrets.env}"
REQUIS=(AUTH_SECRET AUTH_URL APP_URL NEXT_PUBLIC_APP_URL DATABASE_URL DIRECT_URL RLS_ACTIVE CRON_SECRET VPS_HOST VPS_USER VPS_SSH_PORT VPS_SSH_PRIVATE_KEY)
OPTIONNELS=(BACKUP_AGE_KEY BACKUP_AGE_KEY_PRIVATE BACKUP_RCLONE_CONFIG SEMGREP_APP_TOKEN NEXT_PUBLIC_TURNSTILE_SITE_KEY)

log() { printf '\033[1m==> %s\033[0m\n' "$*"; }
fail() { printf '\033[31mErreur : %s\033[0m\n' "$*" >&2; exit 1; }

command -v gh >/dev/null || fail "gh (GitHub CLI) est introuvable."
gh auth status >/dev/null 2>&1 || fail "gh n'est pas connecté : lancez « gh auth login »."

COMPTE="$(gh api user --jq .login)"
ADMIN="$(gh api "repos/$REPO" --jq .permissions.admin 2>/dev/null || echo false)"
log "Dépôt : $REPO — connecté en tant que $COMPTE (admin : $ADMIN)"
if [ "$ADMIN" != "true" ]; then
  [ "$DRY" = 1 ] && echo "  (dry-run : le droit admin manque, une exécution réelle échouerait)" \
    || fail "il faut le droit admin sur $REPO (compte propriétaire)."
fi
VISIBILITE="$(gh api "repos/$REPO" --jq .visibility 2>/dev/null || echo inconnue)"
[ "$VISIBILITE" = "public" ] && printf '\033[33mAttention : le dépôt est PUBLIC (historique git lisible par tous).\033[0m\n'

# ------------------------------------------------------------
# 1. Secrets
# ------------------------------------------------------------
if [ "$DO_SECRETS" = 1 ]; then
  log "Secrets Actions"
  if [ -f "$SECRETS_FILE" ]; then
    perm="$(stat -c '%a' "$SECRETS_FILE" 2>/dev/null || stat -f '%Lp' "$SECRETS_FILE")"
    [ "$perm" = "600" ] || echo "  conseil : chmod 600 $SECRETS_FILE (permissions actuelles : $perm)"
  else
    echo "  $SECRETS_FILE introuvable : toutes les valeurs seront demandées au clavier."
  fi

  # Valeur d'un secret dans le fichier. Lecture seule avec grep : le fichier n'est JAMAIS
  # exécuté (pas de `source`). Compatible bash 3.2 (macOS) : pas de tableau associatif.
  valeur_de() {
    [ -f "$SECRETS_FILE" ] || return 0
    grep -m1 "^$1=" "$SECRETS_FILE" | cut -d= -f2- | tr -d '\r' || true
  }

  poser() { # nom obligatoire(1/0)
    local nom="$1" requis="$2" val f
    val="$(valeur_de "$nom")"
    if [[ "$val" == @* ]]; then # valeur lue dans un fichier (clé SSH, config rclone…)
      f="${val#@}"; val=""
      if [ -n "$f" ]; then
        if [ -f "$f" ]; then val="$(cat "$f")"; else echo "  $nom : fichier « $f » introuvable"; fi
      fi
    fi
    if [ -z "$val" ] && [ "$DRY" = 0 ]; then
      read -rsp "  $nom ($([ "$requis" = 1 ] && echo obligatoire || echo optionnel) ; Entrée pour passer ; une valeur sur plusieurs lignes se donne par @fichier) : " val; echo
    fi
    if [ -z "$val" ]; then
      if [ "$DRY" = 1 ]; then echo "  [dry-run] $nom : aucune valeur dans le fichier (serait demandée au clavier)"
      elif [ "$requis" = 1 ]; then fail "$nom est obligatoire."
      else echo "  - $nom : ignoré"; fi
      return
    fi
    if [ "$DRY" = 1 ]; then echo "  [dry-run] gh secret set $nom"
    else printf '%s' "$val" | gh secret set "$nom" -R "$REPO" && echo "  ✓ $nom"; fi
  }
  for n in "${REQUIS[@]}"; do poser "$n" 1; done
  for n in "${OPTIONNELS[@]}"; do poser "$n" 0; done
fi

# ------------------------------------------------------------
# 2. Environnements
# ------------------------------------------------------------
if [ "$DO_ENVS" = 1 ]; then
  log "Environnements"
  ID="$(gh api user --jq .id)"
  # staging : aucune approbation requise.
  if [ "$DRY" = 1 ]; then echo "  [dry-run] PUT environments/staging"
  else gh api -X PUT "repos/$REPO/environments/staging" --silent && echo "  ✓ staging"; fi
  # production : le propriétaire doit approuver ; déploiement limité à main.
  # prevent_self_review=false : sinon un dépôt à un seul relecteur ne pourrait jamais déployer.
  CORPS="$(printf '{"reviewers":[{"type":"User","id":%s}],"prevent_self_review":false,"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}' "$ID")"
  if [ "$DRY" = 1 ]; then echo "  [dry-run] PUT environments/production (relecteur : $COMPTE, branche main)"
  else
    printf '%s' "$CORPS" | gh api -X PUT "repos/$REPO/environments/production" --input - --silent && echo "  ✓ production (relecteur : $COMPTE)"
    gh api -X POST "repos/$REPO/environments/production/deployment-branch-policies" -f name=main -f type=branch --silent 2>/dev/null \
      && echo "  ✓ production limité à la branche main" || echo "  = branche main déjà autorisée sur production"
  fi
fi

# ------------------------------------------------------------
# 3. Règle de protection de main
# ------------------------------------------------------------
if [ "$DO_RULE" = 1 ]; then
  log "Règle « Protection main »"
  EXISTANT="$(gh api "repos/$REPO/rulesets" --jq '.[] | select(.name=="Protection main") | .id' 2>/dev/null | head -1 || true)"
  if [ "$DRY" = 1 ]; then echo "  [dry-run] ${EXISTANT:+mise à jour}${EXISTANT:-création} de la règle depuis ruleset-protection-main.json"
  elif [ -n "$EXISTANT" ]; then
    gh api -X PUT "repos/$REPO/rulesets/$EXISTANT" --input "$DIR/ruleset-protection-main.json" --silent && echo "  ✓ règle mise à jour (id $EXISTANT)"
  else
    gh api -X POST "repos/$REPO/rulesets" --input "$DIR/ruleset-protection-main.json" --silent && echo "  ✓ règle créée"
  fi
  echo "  Rappel : le push direct sur main est désormais refusé ; tout passe par une PR qui doit voir passer « Porte de promotion intacte »."
fi

log "Terminé. Vérification : gh secret list -R $REPO"
