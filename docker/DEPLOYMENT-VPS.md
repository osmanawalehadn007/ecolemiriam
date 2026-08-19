# EcolPro — Guide de Déploiement VPS

## Vue d'ensemble

Ce document décrit le déploiement complet d'EcolPro sur un VPS avec Docker, Cloudflare Tunnel, et une architecture de sécurité zero-trust.

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

### 1. Préparer le VPS
```bash
ssh root@vps-ip
git clone https://github.com/wilsan007/EcolPro.git /opt/ecolpro
cd /opt/ecolpro
sudo bash docker/scripts/harden-os.sh
```

### 2. Configurer Cloudflare
1. Aller sur https://one.dash.cloudflare.com
2. Networks → Tunnels → Create tunnel → nommer `ecolpro`
3. Copier le token
4. Configurer les ingress rules :
   - `app.ecloemiriam.com` → `http://caddy:8080`
   - `status.ecloemiriam.com` → `http://caddy:8081`
5. DNS : les enregistrements sont créés automatiquement par Cloudflare

### 3. Générer les secrets
```bash
bash docker/scripts/secrets-init.sh
# Remplacer le token Cloudflare
echo "VOTRE_TOKEN" > docker/secrets/cloudflare_tunnel_token.txt
```

### 4. Créer .env.production
```bash
cp .env.example .env.production
# Éditer avec les valeurs des secrets + clés externes
```

### 5. Migrer les données (si migration depuis Supabase)
```bash
# Créer .env.local avec SUPABASE_DB_URL et VPS_DB_URL
bash docker/scripts/migrate-from-supabase.sh
```

### 6. Démarrer la stack
```bash
cd docker
docker compose up -d
```

### 7. Vérifier
```bash
make health    # app
make audit     # audit sécurité (score ≥ 75)
```

## Déploiements ultérieurs

```bash
cd /opt/ecolpro
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

- Uptime Kuma : `https://status.ecloemiriam.com`
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
