#!/usr/bin/env bash
# Exécute une commande sur la VM via le tunnel IAP, en réessayant uniquement
# les échecs de ssh lui-même.
#
# gcloud renvoie 255 quand c'est ssh qui échoue — authentification ou tunnel —
# et non la commande distante. OS Login refuse parfois la clé de façon
# intermittente : observé le 2026-08-31 avec deux connexions réussies suivies
# d'un « Permission denied (publickey) » quatre secondes plus tard, sur la même
# clé et le même job. Cause racine non élucidée.
#
# Tout autre code de sortie vient du script distant et remonte tel quel : ni
# ci-deploy-gcp.sh ni la bascule blue-green ne sont idempotents, les réessayer
# serait plus dangereux que l'échec.
set -uo pipefail

: "${GCP_INSTANCE:?}" "${GCP_ZONE:?}" "${GCP_PROJECT:?}"
REMOTE_COMMAND="${1:?usage: ssh-retry.sh <commande distante>}"

for attempt in 1 2 3; do
  rc=0
  gcloud compute ssh "$GCP_INSTANCE" \
    --zone="$GCP_ZONE" \
    --project="$GCP_PROJECT" \
    --tunnel-through-iap \
    --command="$REMOTE_COMMAND" || rc=$?

  if [ "$rc" -ne 255 ]; then
    exit "$rc"
  fi

  echo "ssh a échoué (code 255) — tentative $attempt/3, nouvel essai dans 20 s."
  sleep 20
done

echo "ssh indisponible après 3 tentatives."
exit 255
