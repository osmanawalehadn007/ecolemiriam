# École Miriam — Runbook VPS

## 1. PRÉREQUIS VPS

### 1.1 Spécifications recommandées
- **VPS** : 4 vCPU, 8 Go RAM, 80 Go NVMe (Hetzner CX32 ~10 €/mois)
- **OS** : Ubuntu 24.04 LTS ou Debian 12
- **Région** : Falkenstein (fsn1) ou Helsinki (hel1)

### 1.2 Domaine & DNS
- Domaine : `ecolemiriam.com` (acheté sur Cloudflare)
- Nameservers : Cloudflare
- Sous-domaines :
  - `app.ecolemiriam.com` → application principale
  - `status.ecolemiriam.com` → Uptime Kuma (accès restreint)

---

## 2. DURCISSEMENT OS (une fois, à l'installation)

```bash
ssh root@vps-ip
git clone <repo> /opt/ecolemiriam
cd /opt/ecolemiriam
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
2. Nommer `ecolemiriam`
3. Copier le token

### 3.2 Ingress rules
| Sous-domaine | Service | Access Policy |
|---|---|---|
| `app.ecolemiriam.com` | `http://caddy:8080` | Public (WAF + Bot Fight) |
| `status.ecolemiriam.com` | `http://caddy:8081` | Email whitelist (admin) |

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

### 3.5 Configurer Cloudflare via API (automatisé)
```bash
# Copier le template et remplir
cp .cf-token.env.example .cf-token.env
# Éditer .cf-token.env avec CF_API_TOKEN, CF_TUNNEL_ID, etc.

# Lancer la configuration automatique
make cf-setup
# ou
bash docker/scripts/cloudflare-setup.sh
```
Le script configure automatiquement :
- SSL/TLS Full (strict) + TLS 1.2 minimum
- Always Use HTTPS + HSTS
- Enregistrements DNS (CNAME vers tunnel)
- Bot Fight Mode
- Rate limiting (100 req/min par IP)
- Ingress rules du tunnel

### 3.6 Access Policy pour status.ecolemiriam.com
Dashboard Zero Trust → Access → Applications → Create application :
- Domain : `status.ecolemiriam.com`
- Policy : Email whitelist (admin@ecolemiriam.com)
- Session duration : 12h

---

## 4. SECRETS (SOPS + age)

```bash
cd /opt/ecolemiriam
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
- `NEXT_PUBLIC_APP_URL` → `https://app.ecolemiriam.com`
- `AUTH_URL` → `https://app.ecolemiriam.com`
- `RLS_ACTIVE` → `true`
- Clés externes (Resend, Telegram, Africa's Talking, etc.)

---

## 6. MIGRATION SUPABASE → VPS

### 6.1 Démarrer Postgres
```bash
cd /opt/ecolemiriam/docker
docker compose up -d postgres pgbouncer
```

### 6.2 Créer .env.local
```bash
cat > .env.local <<EOF
SUPABASE_DB_URL="postgresql://postgres:PASSWORD@db.hyejtirvtdhxseambzyg.supabase.co:5432/postgres"
VPS_DB_URL="postgresql://ecolemiriam_owner:PASSWORD@localhost:5432/ecolemiriam"
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
cd /opt/ecolemiriam
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
docker exec ecolemiriam-pgbackrest pgbackrest --stanza=ecolemiriam info
```

### Test de restauration
```bash
make restore-test
```

### Restauration PITR réelle
```bash
docker compose stop app
docker exec ecolemiriam-pgbackrest pgbackrest --stanza=ecolemiriam \
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
- [ ] RLS : `SELECT rolbypassrls FROM pg_roles WHERE rolname='ecolemiriam_app'` → `f`
- [ ] Tunnel : `docker logs ecolemiriam-cloudflared`
- [ ] TLS : `curl -vI https://app.ecolemiriam.com 2>&1 | grep SSL`
- [ ] Headers : `curl -sI https://app.ecolemiriam.com | grep -i security`
- [ ] Healthcheck : `curl -f https://app.ecolemiriam.com/api/health`
- [ ] Backup : `docker exec ecolemiriam-pgbackrest pgbackrest --stanza=ecolemiriam check`
- [ ] Audit : `make audit` → score ≥ 75
