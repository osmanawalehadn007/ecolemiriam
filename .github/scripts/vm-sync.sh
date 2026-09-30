#!/usr/bin/env bash
# Synchronise le dépôt de la VM avec le commit déployé, SANS AUCUN JETON GIT.
# ============================================================
# Pourquoi ce script existe
# -------------------------
# La synchronisation se faisait par un `git fetch origin main` exécuté SUR la
# VM, authentifié par un PAT fine-grained stocké dans
# /etc/ecolemiriam/git-credentials. Un PAT fine-grained a une expiration
# obligatoire : celui installé le 30/08/2026 a expiré le 30/09/2026, la VM n'a
# plus pu récupérer le dépôt, et TOUS les déploiements se sont arrêtés au
# staging — sans qu'une seule ligne de code soit en cause. Un secret qui expire
# est une panne programmée.
#
# Ici, le runner fabrique un `git bundle` du commit qu'il déploie et le
# transfère par le tunnel IAP déjà utilisé. La VM n'a donc plus besoin de
# parler à GitHub : plus de jeton, plus de rotation, plus d'expiration. Les
# sémantiques git sont conservées : stash des modifications locales,
# `--ff-only`, vraies références dans /opt/ecolemiriam.
#
# Le bundle est vérifié DES DEUX CÔTÉS (`git bundle verify`). Une troncature de
# transfert échoue donc bruyamment au lieu de laisser un dépôt incohérent.
#
# Prérequis : le checkout du job doit être COMPLET (`fetch-depth: 0`). Un clone
# superficiel ne peut pas produire un bundle utilisable par le dépôt de la VM,
# qui n'est pas superficiel — le script le refuse explicitement.
#
# Variables attendues (posées par le workflow) : GCP_INSTANCE, GCP_ZONE,
# GCP_PROJECT. `ssh-retry.sh` doit se trouver à côté de ce script.
set -euo pipefail

: "${GCP_INSTANCE:?}" "${GCP_ZONE:?}" "${GCP_PROJECT:?}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REF="ci-deploy"
SHA="$(git rev-parse --short HEAD)"
BUNDLE="${RUNNER_TEMP:-/tmp}/vm-sync-$SHA.bundle"

if [ "$(git rev-parse --is-shallow-repository)" = "true" ]; then
  cat >&2 <<'MSG'
ERREUR : ce job a fait un checkout superficiel.
Un `git bundle` produit depuis un clone superficiel est inexploitable par le
dépôt de la VM (qui possède, lui, un historique complet) : le fetch distant
échouerait. Déclarer `fetch-depth: 0` sur le checkout du job.
MSG
  exit 1
fi

# `git bundle` n'accepte que des références : on fige celle à transmettre.
git branch -f "$REF" HEAD
git bundle create "$BUNDLE" "$REF" >/dev/null
git bundle verify "$BUNDLE"

echo "Bundle $SHA ($(du -h "$BUNDLE" | cut -f1)) — transfert vers $GCP_INSTANCE via IAP…"

# Commande exécutée sur la VM :
#   1. le bundle arrive par stdin (le tunnel IAP le transporte tel quel) ;
#   2. il est vérifié AVANT d'être utilisé ;
#   3. les modifications locales éventuelles sont stashées, comme avant ;
#   4. `git fetch <bundle>` n'a besoin d'aucun réseau ni d'aucun identifiant ;
#   5. `--ff-only` refuse toute divergence, et le stash est restauré dans tous
#      les cas (le pop est lui-même testé : un conflit le signale).
# Pas de `set -e` à distance : on veut restaurer le stash même si la mise à
# jour échoue, et remonter le code d'erreur réel.
REMOTE_COMMAND='
cd /opt/ecolemiriam || exit 2
T=$(mktemp) || exit 2
trap "rm -f $T" EXIT
cat > "$T"
git bundle verify "$T" >/dev/null || { echo "Bundle invalide (transfert tronqué ?)"; exit 3; }
S=0
{ git diff --quiet && git diff --cached --quiet; } || { git stash push -m ci-sync >/dev/null && S=1; }
FAIL=0
git fetch "$T" '"$REF"':refs/remotes/origin/main || FAIL=$?
if [ "$FAIL" = 0 ]; then git merge --ff-only origin/main || FAIL=$?; fi
[ "$S" = 0 ] || git stash pop || FAIL=$?
echo "HEAD sur la VM : $(git rev-parse --short HEAD)"
exit $FAIL
'

"$SCRIPT_DIR/ssh-retry.sh" "$REMOTE_COMMAND" < "$BUNDLE"
