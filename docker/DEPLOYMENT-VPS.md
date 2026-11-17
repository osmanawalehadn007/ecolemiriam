# École Miriam — Guide de Déploiement VPS

## Vue d'ensemble

Ce document décrit le déploiement complet d'École Miriam sur un VPS avec Docker, Cloudflare Tunnel, et une architecture de sécurité zero-trust.

> Pour un déploiement sur **Google Cloud Compute Engine**, voir [DEPLOYMENT-GCP.md](./DEPLOYMENT-GCP.md) :
> seules les étapes 0 (création du serveur) et 8 (firewall) diffèrent, le reste de ce guide s'applique tel quel.

## Architecture

```
Internet → Cloudflare (WAF/DDoS/TLS) → Cloudflare Tunnel → VPS
                                                           ↓
                                                         Caddy (TLS interne, rate limit, headers)
                                                           ↓
                                                         App (Next.js standalone, non-root, read-only)
                                                           ↓
                                                         PgBouncer (pool, mode transaction)
                                                           ↓
                                                         Postgres 17 (RLS, pgaudit, pgBackRest)
```

## Composants

| Service | Image | Rôle |
|---|---|---|
| postgres | Custom (pgaudit + pgBackRest) | Base de données avec RLS, audit |
| pgbouncer | edoburu/pgbouncer | Pool de connexions (mode transaction) |
| app | Custom (Next.js standalone) | Application non-root, read-only |
| caddy | Custom (xcaddy + rate limit) | Reverse proxy, TLS interne, headers |
| cloudflared | cloudflare/cloudflared | Tunnel zero-trust, aucun port entrant |
| docker-socket-proxy | tecnativa/docker-socket-proxy | Proxy sécurisé pour Ofelia |
| ofelia | mcuadros/ofelia | Cron jobs (3 app + backup + audit + restore) |
| pgbackrest | pgbackrest/pgbackrest | Sauvegardes PITR incrémentales |
| monitoring | uptime-kuma | Monitoring + alertes Telegram |

## Étapes de déploiement

### 0. Créer le VPS sur Vultr (Dubaï)

1. Aller sur https://www.vultr.com → Products → Deploy New Server
2. Choisir **Cloud Compute** → **Dubai (United Arab Emirates)** region
3. Image : **Ubuntu 24.04 LTS x64**
4. Plan : **2 vCPU, 4 Go RAM, 80 Go SSD** (~$24/mois) ou **2 vCPU, 8 Go RAM, 120 Go SSD** (~$48/mois)
5. Activer **Auto Backup** ($2,40/mois supplémentaire)
6. SSH Keys : ajouter votre clé publique SSH
7. Hostname : `ecolemiriam-prod`
8. Firewall : bloquer tous les ports entrants sauf SSH (22) depuis votre IP uniquement
   - **Aucun port HTTP/HTTPS ouvert** — Cloudflare Tunnel gère tout en sortant
9. Deploy et noter l'IP publique

### 1. Préparer le VPS
```bash
ssh root@<VPS-IP>
apt update && apt upgrade -y
# Installer Docker
curl -fsSL https://get.docker.com | sh
# Cloner le projet
git clone https://github.com/osmanawalehadn007/ecolemiriam.git /opt/ecolemiriam
cd /opt/ecolemiriam
# Durcir l'OS
sudo bash docker/scripts/harden-os.sh
```

### 2. Configurer Cloudflare (déjà fait)

La configuration Cloudflare est **déjà en place** :
- Zone : `ecolemiriam.com` (active)
- Tunnel : `Ecolemiriam` (ID: `4d0ebccb-dbaf-433c-9acd-0bb986827599`)
- DNS CNAME : `app.ecolemiriam.com` et `status.ecolemiriam.com` → tunnel
- SSL/TLS : Full (strict), Always Use HTTPS, HSTS, TLS 1.2 minimum
- Ingress rules : configurées dans `docker/cloudflared/config.yml`
- Tunnel token : stocké dans `docker/secrets/cloudflare_tunnel_token.txt`

### 2b. Automatiser la configuration Cloudflare via API (optionnel)
```bash
# La configuration est déjà faite, mais pour reconfigurer :
cp .cf-token.env.example .cf-token.env
# Éditer .cf-token.env avec CF_API_TOKEN, CF_TUNNEL_ID, etc.
make cf-setup
```

### 3. Générer les secrets
```bash
bash docker/scripts/secrets-init.sh
# Le token Cloudflare Tunnel est déjà dans docker/secrets/cloudflare_tunnel_token.txt
# Le token API Cloudflare est dans .cf-token.env
```

### 4. Créer .env.production
```bash
cp .env.example .env.production
# Éditer avec les valeurs de production :
#   NEXT_PUBLIC_APP_URL=https://app.ecolemiriam.com
#   AUTH_URL=https://app.ecolemiriam.com
#   DATABASE_URL=postgresql://ecolemiriam_app:...@pgbouncer:6432/ecolemiriam?pgbouncer=true
#   AUTH_SECRET=<généré par secrets-init.sh>
#   CRON_SECRET=<généré par secrets-init.sh>
#   + clés externes (Resend, Stripe, Twilio, etc.)
```

### 5. Migrer les données (si migration depuis Supabase)
```bash
# Créer .env.local avec SUPABASE_DB_URL et VPS_DB_URL
bash docker/scripts/migrate-from-supabase.sh
```

### 6. Démarrer la stack
```bash
cd docker
make build
make up
```

### 7. Vérifier
```bash
make health    # app
make audit     # audit sécurité (score ≥ 75)
curl -f https://app.ecolemiriam.com/api/health
```

### 8. Configurer le firewall Vultr (important)

Dans le panel Vultr → Firewall → créer un groupe `ecolemiriam` :
| Protocol | Port | Source | Action |
|---|---|---|---|
| TCP | 22 | Votre IP uniquement | Allow |
| TCP | 1-65535 | All | **Deny** (défaut) |

**Aucun port HTTP/HTTPS n'est ouvert** — Cloudflare Tunnel établit une connexion sortante.

## Déploiements ultérieurs

```bash
cd /opt/ecolemiriam
git pull origin main
make deploy
```

Le script :
1. Backup pré-déploiement
2. Build nouvelle image
3. Sauvegarde image actuelle (previous)
4. Déploiement
5. Healthcheck (rollback auto si échec)

## Rollback

```bash
make rollback
```

## Monitoring

- Uptime Kuma : `https://status.ecolemiriam.com`
- Alertes Telegram configurées pour :
  - App down
  - Postgres down
  - Tunnel down
  - Backup manquant

## Sécurité

### Audit
```bash
make audit  # score /100
```

### Secrets
- SOPS + age pour le chiffrement
- Docker secrets pour le runtime
- Jamais de secrets dans les images
- `.env.production` non commité

### Backups
- pgBackRest : incrémental quotidien, full hebdomadaire
- PITR : restauration à un point précis dans le temps
- Offsite R2 optionnel (décommenter dans pgbackrest.conf)
- Test de restauration hebdomadaire avec notification Telegram

## Structure des fichiers

```
docker/
├── Makefile                    # Point d'entrée unique
├── docker-compose.yml          # Stack complète
├── RUNBOOK.md                  # Procédures opérationnelles
├── DEPLOYMENT-VPS.md           # Ce fichier
├── app/
│   └── Dockerfile              # Next.js standalone, non-root
├── postgres/
│   ├── Dockerfile              # PG17 + pgaudit + pgBackRest
│   ├── postgresql.conf         # Config durcie
│   ├── pg_hba.conf             # scram-sha-256, reject all
│   └── init/
│       └── 01-init-roles.sql   # Rôles, extensions, RLS
├── pgbouncer/
│   ├── pgbouncer.ini           # Mode transaction
│   └── userlist.txt            # Hashes scram-sha-256
├── caddy/
│   ├── Dockerfile              # xcaddy + rate limit
│   └── Caddyfile               # TLS interne, headers, rate limit
├── cloudflared/
│   └── config.yml              # Tunnel token-based
├── ofelia/
│   └── config.ini              # 3 crons + backup + audit + restore
├── pgbackrest/
│   └── pgbackrest.conf         # PITR + R2 optionnel
├── monitoring/
│   └── uptime-kuma-config.json # Monitors + alertes Telegram
└── scripts/
    ├── secrets-init.sh         # SOPS + age init
    ├── secrets-edit.sh         # Édition chiffrée
    ├── secrets-rotate.sh       # Rotation
    ├── security-audit.sh       # Audit scoré /100
    ├── harden-os.sh            # Durcissement OS
    ├── restore-test.sh         # Test restauration + Telegram
    ├── migrate-from-supabase.sh # Migration Supabase
    └── deploy.sh               # Déploiement + rollback auto
```
