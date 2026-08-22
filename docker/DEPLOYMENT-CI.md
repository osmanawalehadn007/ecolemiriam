# Déploiement CI/CD — GitHub Actions + GHCR + VPS

## Architecture

```
Push sur main
     │
     ▼
GitHub Actions (runner 4 vCPU, 16 Go RAM)
     │
     ├─ 1. Build image Docker (Dockerfile optimisé, cache BuildKit)
     ├─ 2. Push vers GHCR (ghcr.io/wilsan007/ecolemiriam-app:latest)
     └─ 3. SSH vers VPS
              │
              ├─ docker pull (image pré-construite)
              ├─ docker compose up -d app
              └─ healthcheck (rollback auto si échec)
```

**Avant** : Build sur le VPS (~10-15 min) → déploiement lent
**Après** : Build sur GitHub Actions (~3-5 min) + pull sur VPS (~30s) → déploiement rapide

## Sécurité

- L'image est construite sur GitHub Actions (pas de secrets baked dans l'image)
- GHCR : image privée, accessible uniquement avec un PAT
- SSH : clé dédiée `deploy_ed25519`, restreinte à `deploy.sh` (pas de shell arbitraire)
- Rollback automatique si healthcheck échoue
- `concurrency: deploy-vps` : évite deux déploiements simultanés
- SBOM (Software Bill of Materials) généré à chaque build
- `provenance: true` : traçabilité de la chaîne de build

## Setup initial (à faire une seule fois)

### 1. Sur le VPS

```bash
cd /opt/ecolemiriam
git pull origin main
bash docker/scripts/setup-vps-ghcr.sh
```

Ce script va :
- Créer un token GHCR (`~/.config/ghcr-token`) pour pull les images
- Générer une clé SSH dédiée (`~/.ssh/deploy_ed25519`)
- Ajouter la clé publique dans `authorized_keys` (restreinte à `deploy.sh`)

### 2. Sur GitHub (Settings → Secrets and variables → Actions)

Configurer ces secrets :

| Secret | Valeur | Description |
|---|---|---|
| `VPS_HOST` | `169.58.208.217` | IP ou hostname du VPS |
| `VPS_USER` | `root` | Utilisateur SSH sur le VPS |
| `VPS_SSH_PORT` | `22` | Port SSH (ou votre port custom) |
| `VPS_SSH_PRIVATE_KEY` | *(contenu de `~/.ssh/deploy_ed25519`)* | Clé privée SSH de déploiement |

**Note** : `GITHUB_TOKEN` est automatique (pas besoin de le configurer manuellement).
Il est utilisé pour push l'image vers GHCR.

### 3. (Optionnel) Protection rule sur l'environnement `production`

GitHub → Settings → Environments → `production` → Required reviewers

Cela ajoute une étape d'approbation manuelle avant le déploiement,
tout en gardant le build automatique.

## Utilisation

### Déploiement automatique

Chaque push sur `main` déclenche :
1. Build + push de l'image vers GHCR
2. Déploiement automatique sur le VPS

### Déploiement manuel

GitHub → Actions → "Build & Deploy" → Run workflow

### Rollback manuel (sur le VPS)

```bash
cd /opt/ecolemiriam
bash docker/scripts/deploy.sh --rollback
```

### Build local (fallback, lent)

Si GitHub Actions est indisponible :

```bash
cd /opt/ecolemiriam
bash docker/scripts/deploy.sh --build
```

## Workflow GitHub Actions

Le workflow `.github/workflows/deploy.yml` contient deux jobs :

1. **build-and-push** : Build Docker + push GHCR (avec cache distant)
2. **deploy** : SSH vers VPS, pull image, restart, healthcheck

Le workflow `.github/workflows/ci.yml` (lint + typecheck + tests) reste
inchangé et s'exécute en parallèle sur les PRs.

## Optimisations apportées au Dockerfile

| Avant | Après | Gain |
|---|---|---|
| `npm install --legacy-peer-deps` | `npm ci --legacy-peer-deps` | Reproductible + plus rapide |
| `prisma generate` exécuté 2 fois | 1 seule fois (dans `npm run build`) | ~10-15s économisés |
| Pas de cache BuildKit | `--mount=type=cache` pour npm + .next | Builds incrémentaux ~2-3x plus rapides |
| Build sur VPS (1-2 vCPU) | Build sur GitHub Actions (4 vCPU) | ~3x plus rapide |
| Image rebuild à chaque deploy | Pull image pré-construite | ~30s au lieu de ~10min |

## Monitoring

- Logs GitHub Actions : onglet Actions sur GitHub
- Logs VPS : `docker logs ecolemiriam-app --tail 50 -f`
- Santé : `docker exec ecolemiriam-app curl -f http://localhost:3000/api/health`
- Images GHCR : https://github.com/wilsan007/EcolPro/pkgs/container/ecolemiriam-app
