# Déploiement CI/CD — GitHub Actions + GHCR + VPS Blue-Green

## Architecture

```
Push sur main / workflow_dispatch
     │
     ▼
┌─────────────────────────────────────────────────────────┐
│  JOB 1 : CI Gate (lint + typecheck + tests unitaires)   │
│  ❌ Si échec → STOP, pas de build, pas de déploiement   │
└─────────────────────────────────────────────────────────┘
     │ ✅ Passe
     ▼
┌─────────────────────────────────────────────────────────┐
│  JOB 2 : Build Docker + push vers GHCR                  │
│  (runner 4 vCPU, 16 Go RAM, cache BuildKit)             │
└─────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────┐
│  JOB 3 : Déploiement STAGING (slot inactif)             │
│  → Pull image sur le slot INACTIF du VPS                │
│  → Healthcheck sur le conteneur staging                 │
│  → Smoke tests (login, API, DB, assets, headers)        │
│  ❌ Si échec → STOP, production INTACTE                 │
└─────────────────────────────────────────────────────────┘
     │ ✅ Tous les tests passent
     ▼
┌─────────────────────────────────────────────────────────┐
│  JOB 4 : ⏸️  APPROBATION MANUELLE                       │
│  → Un humain doit cliquer "Review deployments"          │
│  → sur GitHub (environment: production)                 │
│  → Le staging reste en attente jusqu'à approbation      │
└─────────────────────────────────────────────────────────┘
     │ ✅ Approuvé
     ▼
┌─────────────────────────────────────────────────────────┐
│  JOB 5 : PROMOTION — Blue-Green Switch                  │
│  → Bascule Caddy du slot actif → slot staging           │
│  → caddy reload (zero downtime)                         │
│  → Healthcheck post-bascule                             │
│  → ❌ Si échec → ROLLBACK AUTOMATIQUE                   │
│  → Grace period (10s) + arrêt ancien conteneur          │
└─────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────┐
│  JOB 6 : E2E Tests post-déploiement (Playwright)        │
│  → Tests contre la production                           │
│  → Non-bloquant (notification seulement)                │
└─────────────────────────────────────────────────────────┘
```

## Blue-Green Architecture

```
                    ┌──────────────────┐
                    │    Caddy (8080)  │
                    │   import upstream │
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │  upstream.conf   │
                    │  (swappable)     │
                    └────────┬─────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
     ┌────────▼───────┐    ┌─▼────────────┐
     │  app-blue:3000 │    │ app-green:3000│
     │  (slot BLUE)   │    │ (slot GREEN)  │
     └────────────────┘    └──────────────┘
              │
     Un seul slot est ACTIF à la fois.
     L'autre sert de STAGING pendant le déploiement.
```

- **Slot actif** : reçoit le trafic via Caddy (définit dans `upstream.conf`)
- **Slot inactif** : sert de staging (nouvelle image déployée ici, testée, puis promue)
- **Bascule** : `blue-green-deploy.sh` réécrit `upstream.conf` + `caddy reload` (zero downtime)
- **Rollback** : `make rollback` bascule instantanément vers l'ancien slot (s'il tourne encore)
- **Resource-efficient** : en fonctionnement normal, seul le slot actif tourne

## Sécurité

- **CI Gate** : lint + typecheck + tests doivent passer avant tout build
- **Staging** : la nouvelle image est testée sur le slot inactif SANS toucher la prod
- **Approbation manuelle** : un humain doit valider avant la mise en production
- **Blue-Green** : zero downtime, rollback instantané
- **Rollback automatique** : si le healthcheck post-bascule échoue, Caddy revient au slot précédent
- **Backup pré-déploiement** : pgBackRest avant chaque déploiement
- **SBOM + Provenance** : traçabilité de la chaîne de build
- **SSH restreint** : la clé de déploiement ne peut exécuter que `ci-deploy.sh`

## Setup initial (à faire une seule fois)

### 1. Sur le VPS

```bash
cd /opt/ecolemiriam
git pull origin main
bash docker/scripts/setup-vps-ghcr.sh
```

### 2. Sur GitHub (Settings → Secrets and variables → Actions)

| Secret | Valeur | Description |
|---|---|---|
| `VPS_HOST` | `169.58.208.217` | IP ou hostname du VPS |
| `VPS_USER` | `root` | Utilisateur SSH sur le VPS |
| `VPS_SSH_PORT` | `22` | Port SSH |
| `VPS_SSH_PRIVATE_KEY` | *(contenu de `~/.ssh/deploy_ed25519`)* | Clé privée SSH de déploiement |
| `DATABASE_URL` | `postgresql://...` | URL DB pour Prisma (CI gate) |
| `DIRECT_URL` | `postgresql://...` | URL DB directe pour migrations |
| `AUTH_SECRET` | *(secret NextAuth)* | Secret pour JWT |
| `AUTH_URL` | `https://app.ecolemiriam.com` | URL de l'app |
| `NEXT_PUBLIC_APP_URL` | `https://app.ecolemiriam.com` | URL publique |

### 3. Configuration des environments GitHub

**GitHub → Settings → Environments**

1. **Créer `staging`** : pas de protection rule (déploiement automatique)
2. **Créer `production`** :
   - ✅ Required reviewers : ajouter les utilisateurs qui peuvent approuver
   - ⏳ Wait timer (optionnel) : ex. 2 minutes pour vérifier avant d'approuver

### 4. Premier déploiement (migration depuis l'ancienne stack)

L'ancienne stack utilisait un seul conteneur `ecolemiriam-app`. La nouvelle utilise
`ecolemiriam-app-blue` et `ecolemiriam-app-green`.

```bash
# Sur le VPS :
cd /opt/ecolemiriam
git pull origin main

# Arrêter l'ancien conteneur
docker stop ecolemiriam-app 2>/dev/null || true
docker rm ecolemiriam-app 2>/dev/null || true

# Initialiser le state blue-green (blue = actif par défaut)
echo "blue" > docker/.active-color

# Démarrer la nouvelle stack (app-blue démarre, app-green reste arrêté)
make up

# Vérifier
make health
make status
```

## Utilisation

### Déploiement automatique (push sur main)

Le workflow `deploy.yml` s'exécute automatiquement :
1. CI Gate (lint + typecheck + tests)
2. Build Docker + push GHCR
3. Staging + smoke tests
4. ⏸️ **Approbation manuelle** (GitHub → Actions → Review deployments)
5. Promotion blue-green
6. E2E tests post-déploiement

### Déploiement manuel

GitHub → Actions → "Build & Deploy" → Run workflow

### Commandes VPS (Makefile)

```bash
make status        # Voir quel slot est actif (blue/green)
make deploy        # Déploiement complet (staging + promotion)
make staging       # Déployer en staging seulement
make promote       # Promouvoir le staging en production
make rollback      # Rollback instantané vers l'ancien slot
make smoke         # Smoke tests sur le slot actif
make health        # Healthcheck sur le slot actif
make logs          # Logs du slot actif
make logs-staging  # Logs du slot staging
make ps            # Lister les conteneurs
```

### Rollback manuel (sur le VPS)

```bash
cd /opt/ecolemiriam
make rollback
# ou
bash docker/scripts/blue-green-deploy.sh --rollback
```

Le rollback bascule Caddy vers l'ancien slot (qui doit encore tourner).
C'est instantané (juste un `caddy reload`).

### Build local (fallback si GHCR indisponible)

```bash
cd /opt/ecolemiriam
make deploy-build
# ou
bash docker/scripts/blue-green-deploy.sh --build
```

## Fichiers clés

| Fichier | Rôle |
|---|---|
| `.github/workflows/deploy.yml` | Pipeline CI/CD complet (6 jobs) |
| `.github/workflows/ci.yml` | Tests sur PRs (lint + typecheck + E2E) |
| `docker/scripts/blue-green-deploy.sh` | Script blue-green (staging, promote, rollback) |
| `docker/scripts/smoke-test.sh` | Smoke tests post-déploiement |
| `docker/scripts/ci-deploy.sh` | Wrapper appelé par GitHub Actions via SSH |
| `docker/caddy/upstream.conf` | Upstream Caddy swappable (blue/green) |
| `docker/caddy/upstream-simple.conf` | Upstream simple pour handlers rate-limited |
| `docker/.active-color` | State file : `blue` ou `green` (slot actif) |

## Monitoring

- **Logs GitHub Actions** : onglet Actions sur GitHub
- **Statut blue-green** : `make status` sur le VPS
- **Logs VPS** : `make logs` (slot actif) ou `make logs-staging` (slot staging)
- **Santé** : `make health` sur le VPS
- **Images GHCR** : https://github.com/wilsan007/EcolPro/pkgs/container/ecolemiriam-app
