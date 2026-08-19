# EcolPro — Runbook VPS

## 1. PRÉREQUIS VPS

### 1.1 Spécifications recommandées
- **VPS** : 4 vCPU, 8 Go RAM, 80 Go NVMe (Hetzner CX32 ~10 €/mois)
- **OS** : Ubuntu 24.04 LTS ou Debian 12
- **Région** : Falkenstein (fsn1) ou Helsinki (hel1)

### 1.2 Domaine & DNS
- Domaine : `ecloemiriam.com` (acheté sur Cloudflare)
- Nameservers : Cloudflare
- Sous-domaines :
  - `app.ecloemiriam.com` → application principale
  - `status.ecloemiriam.com` → Uptime Kuma (accès restreint)

---

## 2. DURCISSEMENT OS (une fois, à l'installation)

```bash
ssh root@vps-ip
git clone <repo> /opt/ecolpro
cd /opt/ecolpro
sudo bash docker/scripts/harden-os.sh
```

**Actions :**
- SSH : port 22022, clé uniquement, pas de root
- UFW : deny all, allow 22022/tcp
- fail2ban : 3 tentatives → ban 2h
- sysctl : 18 paramètres durcis
- Docker : userns-remap, no-new-privileges
- AIDE : intrusion detection
- unattended-upgrades : security patches

**⚠ NE JAMAIS fermer la session SSH avant d'avoir testé :**
```bash
ssh -p 22022 user@vps-ip
```

---

## 3. CONFIGURATION CLOUDFLARE TUNNEL

### 3.1 Créer le tunnel
1. https://one.dash.cloudflare.com → Networks → Tunnels → Create tunnel
2. Nommer `ecolpro`
3. Copier le token

### 3.2 Ingress rules
| Sous-domaine | Service | Access Policy |
|---|---|---|
| `app.ecloemiriam.com` | `http://caddy:8080` | Public (WAF + Bot Fight) |
| `status.ecloemiriam.com` | `http://caddy:8081` | Email whitelist (admin) |

### 3.3 Sécurité Cloudflare
- SSL/TLS : Full (strict)
- Always Use HTTPS : activé
- HSTS : 1 an, includeSubDomains, preload
- WAF : OWASP + custom rules
- Bot Fight Mode : activé
- Rate Limiting : 100 req/min par IP

### 3.4 Stocker le token
```bash
echo "TOKEN" > docker/secrets/cloudflare_tunnel_token.txt
chmod 600 docker/secrets/cloudflare_tunnel_token.txt
```

---

## 4. SECRETS (SOPS + age)

```bash
cd /opt/ecolpro
bash docker/scripts/secrets-init.sh
```

Génère :
- `docker/keys/age-key.txt` — clé age (SENSIBLE, à sauvegarder hors VPS)
- `docker/secrets/*.txt` — secrets en clair (pour Docker)
- `docker/secrets/secrets.yaml` — secrets chiffrés SOPS (commitable)

### Éditer les secrets
```bash
bash docker/scripts/secrets-edit.sh
```

### Roter les secrets
```bash
bash docker/scripts/secrets-rotate.sh
```

---

## 5. .env.production

```bash
cp .env.example .env.production
```

Remplir avec :
- `AUTH_SECRET` → valeur de `secrets/auth_secret.txt`
- `CRON_SECRET` → valeur de `secrets/cron_secret.txt`
- `NEXT_PUBLIC_APP_URL` → `https://app.ecloemiriam.com`
- `AUTH_URL` → `https://app.ecloemiriam.com`
- `RLS_ACTIVE` → `true`
- Clés externes (Resend, Telegram, Africa's Talking, etc.)

---

## 6. MIGRATION SUPABASE → VPS

### 6.1 Démarrer Postgres
```bash
cd /opt/ecolpro/docker
docker compose up -d postgres pgbouncer
```

### 6.2 Créer .env.local
```bash
cat > .env.local <<EOF
SUPABASE_DB_URL="postgresql://postgres:PASSWORD@db.hyejtirvtdhxseambzyg.supabase.co:5432/postgres"
VPS_DB_URL="postgresql://ecolpro_owner:PASSWORD@localhost:5432/ecolpro"
EOF
```

### 6.3 Exécuter
```bash
bash docker/scripts/migrate-from-supabase.sh
```

### 6.4 Démarrer la stack complète
```bash
docker compose up -d
```

---

## 7. DÉPLOIEMENT QUOTIDIEN

```bash
cd /opt/ecolpro
git pull origin main
make deploy
# ou
bash docker/scripts/deploy.sh
```

### Rollback
```bash
make rollback
# ou
bash docker/scripts/deploy.sh --rollback
```

---

## 8. OPÉRATIONS COURANTES (via Makefile)

```bash
make logs        # logs app
make logs-db     # logs Postgres
make ps          # conteneurs
make health      # healthcheck
make shell       # shell dans app
make shell-db    # psql
make backup      # backup manuel
make audit       # audit sécurité scoré
```

---

## 9. BACKUPS & RESTAURATION

### Backup manuel
```bash
make backup
```

### Vérifier les backups
```bash
docker exec ecolpro-pgbackrest pgbackrest --stanza=ecolpro info
```

### Test de restauration
```bash
make restore-test
```

### Restauration PITR réelle
```bash
docker compose stop app
docker exec ecolpro-pgbackrest pgbackrest --stanza=ecolpro \
  --type=time --target="2026-08-19 14:30:00" --target-action=promote restore
docker compose start postgres app
```

---

## 10. AUDIT SÉCURITÉ

```bash
make audit
```

Score sur 100 points, 7 catégories :
1. OS & réseau (20 pts)
2. Docker & conteneurs (20 pts)
3. Postgres & RLS (20 pts)
4. Secrets & chiffrement (15 pts)
5. Backups & restauration (10 pts)
6. Cloudflare & TLS (10 pts)
7. Monitoring & alerting (5 pts)

---

## 11. PLAN DE ROLLBACK (VPS → Supabase)

1. Cloudflare DNS → pointer vers Vercel
2. Vercel env → remettre `DATABASE_URL` Supabase
3. Exporter données du VPS vers Supabase

Temps estimé : 15-30 min

---

## 12. CHECKLIST POST-DÉPLOIEMENT

- [ ] SSH : `ss -tlnp | grep 22022`
- [ ] UFW : `ufw status`
- [ ] Postgres non exposé : `ss -tlnp | grep 5432` (rien)
- [ ] RLS : `SELECT rolbypassrls FROM pg_roles WHERE rolname='ecolpro_app'` → `f`
- [ ] Tunnel : `docker logs ecolpro-cloudflared`
- [ ] TLS : `curl -vI https://app.ecloemiriam.com 2>&1 | grep SSL`
- [ ] Headers : `curl -sI https://app.ecloemiriam.com | grep -i security`
- [ ] Healthcheck : `curl -f https://app.ecloemiriam.com/api/health`
- [ ] Backup : `docker exec ecolpro-pgbackrest pgbackrest --stanza=ecolpro check`
- [ ] Audit : `make audit` → score ≥ 75
