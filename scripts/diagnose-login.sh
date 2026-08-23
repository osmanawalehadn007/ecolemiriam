#!/usr/bin/env bash
# ============================================================
# École Miriam — Diagnostic de la connexion (VPS)
# ============================================================
# Usage :  bash scripts/diagnose-login.sh [email-de-test]
# À lancer SUR LE VPS, depuis la racine du dépôt.
# ============================================================
set -uo pipefail

SLOT="${SLOT:-ecolemiriam-app-blue}"
EMAIL="${1:-}"
OK="\033[32m✔\033[0m"
KO="\033[31m✘\033[0m"
WARN="\033[33m!\033[0m"

echo "════════ 1. Variables d'environnement du conteneur ════════"
ENVDUMP=$(docker exec "$SLOT" env 2>/dev/null)
if [ -z "$ENVDUMP" ]; then
  echo -e "$KO Conteneur $SLOT injoignable. Essayer SLOT=ecolemiriam-app-green"
  exit 1
fi

check_var() {
  local name="$1" expect="$2"
  local val
  val=$(echo "$ENVDUMP" | grep "^${name}=" | cut -d= -f2-)
  if [ -z "$val" ]; then
    echo -e "$KO ${name} absente — ${expect}"
  elif [[ "$val" == *"localhost"* ]] || [[ "$val" == *"supabase"* ]]; then
    echo -e "$KO ${name}=${val}"
    echo "   → valeur héritée de l'ancienne configuration. ${expect}"
  else
    echo -e "$OK ${name}=${val}"
  fi
}

check_var AUTH_URL "doit valoir https://ecolemiriam.com"
check_var NEXT_PUBLIC_APP_URL "doit valoir https://ecolemiriam.com"

if echo "$ENVDUMP" | grep -q "^AUTH_TRUST_HOST=true"; then
  echo -e "$OK AUTH_TRUST_HOST=true"
else
  echo -e "$KO AUTH_TRUST_HOST absente → Auth.js lèvera UntrustedHost (500)"
fi

if echo "$ENVDUMP" | grep -q "^AUTH_SECRET="; then
  echo -e "$OK AUTH_SECRET définie"
else
  echo -e "$KO AUTH_SECRET absente → aucun JWT ne peut être signé"
fi

DBURL=$(echo "$ENVDUMP" | grep "^DATABASE_URL=" | cut -d= -f2-)
if [[ "$DBURL" == *"pgbouncer:6432"* ]]; then
  echo -e "$OK DATABASE_URL pointe sur PgBouncer"
  [[ "$DBURL" == *"pgbouncer=true"* ]] \
    && echo -e "$OK paramètre pgbouncer=true présent" \
    || echo -e "$KO pgbouncer=true manquant → « prepared statement s0 already exists »"
else
  echo -e "$KO DATABASE_URL ne vise pas pgbouncer:6432 → ${DBURL%%@*}@…"
fi

echo "$ENVDUMP" | grep -q "^DIRECT_URL=" \
  && echo -e "$OK DIRECT_URL définie" \
  || echo -e "$KO DIRECT_URL absente → prisma migrate échouera"

echo "$ENVDUMP" | grep -qi "SUPABASE" \
  && echo -e "$WARN Variables SUPABASE encore présentes — à retirer" \
  || echo -e "$OK aucune variable Supabase résiduelle"

echo
echo "════════ 2. Chaîne applicative ════════"
docker exec "$SLOT" curl -sf http://localhost:3000/api/health >/dev/null 2>&1 \
  && echo -e "$OK /api/health répond (app + DB joignables)" \
  || echo -e "$KO /api/health en échec → voir les logs ci-dessous"

echo
echo "════════ 3. Endpoint d'authentification ════════"
CODE=$(docker exec "$SLOT" curl -s -o /dev/null -w "%{http_code}" \
  http://localhost:3000/api/auth/providers 2>/dev/null)
case "$CODE" in
  200) echo -e "$OK /api/auth/providers → 200" ;;
  500) echo -e "$KO /api/auth/providers → 500 (UntrustedHost ou AUTH_SECRET)" ;;
  *)   echo -e "$WARN /api/auth/providers → $CODE" ;;
esac

echo
echo "════════ 4. État du compte ════════"
if [ -n "$EMAIL" ]; then
  docker exec -i ecolemiriam-postgres psql -U ecolemiriam_app -d ecolemiriam -c \
    "SELECT email, \"isActive\", \"emailVerified\" IS NOT NULL AS email_verifie,
            password IS NOT NULL AS a_mot_de_passe
     FROM users WHERE email = '${EMAIL}';" 2>&1 | sed 's/^/   /'
  echo "   Rappel : emailVerified NULL bloque tout compte non SUPER_ADMIN"
  echo "   (src/lib/auth.ts l.154)."
else
  echo "   (passer un email en argument pour vérifier un compte)"
fi

echo
echo "════════ 5. 30 dernières lignes de log ════════"
docker logs "$SLOT" --tail 30 2>&1 | sed 's/^/   /'
