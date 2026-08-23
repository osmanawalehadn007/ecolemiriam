# Logiciel EcolPro — Règles du projet

## État de la base de données VPS (vérifié 2026-08-23)

**IMPORTANT:** La base de données VPS contient TOUTES les données métier. Ne JAMAIS supposer que la DB est vide sans vérifier via le rôle owner (DIRECT_URL, port 15432).

- **880 élèves** (791 actifs + 89 supprimés logiquement)
- **29 classes**, **3 sites**, **28 factures**, **9 users**, **1 tenant**
- Distribution par site: Campus Central (504 élèves), Annexe Warabaleh (191), ANNEXE PK12 (96)
- Backups R2: bucket `ecolemiriam`, 34 fichiers du 2026-08-22 au 2026-08-23 (tous valides, 880 élèves)

### Piège RLS / PgBouncer

- RLS est **actif et forcé** sur `eleves`, `sites`, `classes`, `factures`
- Le rôle `ecolemiriam_app` (via PgBouncer, port 16432) retourne **0 lignes** sans contexte RLS
- Le rôle `ecolemiriam_owner` (via port 15432, DIRECT_URL) contourne RLS → voit toutes les données
- Pour voir les données via le rôle app, il faut définir: `SET app.tenant_id = 'cms8kt0b40001zbi3o63y7c5v'; SET app.is_super_admin = 'true';`
- **PgBouncer en mode transaction pooling** peut ne pas persister les `SET app.*` entre transactions — cause probable des échecs E2E

### Connexions DB

- `DIRECT_URL` (port 15432): rôle owner, contourne RLS, pour migrations/admin
- `DATABASE_URL` (port 16432): rôle app via PgBouncer, filtré par RLS, pour l'application
- Tunnel SSH: `./scripts/start-vps-tunnel.sh` (VPS: root@169.58.208.217)

## Infrastructure

- **VPS:** Hetzner CX32, Ubuntu 24.04, Postgres 17 + PgBouncer
- **Domaine:** ecolemiriam.com sur Cloudflare avec tunnel
- **Caddy:** Reverse proxy Docker sur le VPS (`ecolemiriam-caddy` container, port 8080)
  - Blue-green: `upstream.conf` et `upstream-simple.conf` pointent vers `app-green:3000` ou `app-blue:3000`
  - **Bug connu:** si ces fichiers n'existent pas au mount Docker, Docker crée des répertoires → erreur 127 au démarrage. Fix: `rm -rf upstream.conf upstream-simple.conf` puis recréer en fichiers.
  - Caddyfile: `/opt/ecolemiriam/docker/caddy/Caddyfile`
  - docker-compose: `/opt/ecolemiriam/docker/docker-compose.yml`
- **Cloudflare:** Token account-owned dans `.cf-token.env` — ne peut PAS gérer les Page Rules (erreur 1011). Pour Page Rules: utiliser le dashboard ou créer un token user-owned.
- **Backups:** Script `scripts/backups/backup.sh` → R2 via rclone (remote: `ecolemiriam-backup`, bucket: `ecolemiriam`)

## Incidents résolus (2026-08-23)

- **Caddy down (502):** Conteneur `ecolemiriam-caddy` en Exited(127) — `upstream.conf` et `upstream-simple.conf` étaient des répertoires au lieu de fichiers (Docker auto-créé quand le fichier manque au mount). Fix: supprimer les répertoires, recréer en fichiers pointant vers `app-green:3000`, `docker start ecolemiriam-caddy`.
- **Page Rule 301:** Règle `ecolemiriam.com/*` → `https://app.ecolemiriam.com/$1` créée le 23/08/2026 08:22 UTC via API par zdouce.zz@gmail.com. ID: `db9d7706b9561c8ff23c17562da22761`. **À supprimer manuellement dans le dashboard Cloudflare** (le token account-owned ne peut pas).
