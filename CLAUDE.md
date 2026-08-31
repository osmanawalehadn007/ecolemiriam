# Logiciel EcolPro

## Déploiement — à lire avant toute modification de la CI ou de l'infra

**Procédure de référence : [docs/DEPLOIEMENT.md](docs/DEPLOIEMENT.md).** Elle
fait autorité sur `docker/DEPLOYMENT-GCP.md`, `docker/DEPLOYMENT-CI.md` et
`docker/RUNBOOK.md`, dont certaines parties sont périmées.

Le point à retenir si tu ne lis rien d'autre : **un push sur `main` ne déploie
pas en production.** Il s'arrête au slot staging. La promotion est une action
manuelle (`gh workflow run deploy-gcp.yml -R wilsan007/EcolPro -f promote=true`).

Cette séparation tient à une seule condition dans
`.github/workflows/deploy-gcp.yml` :

```yaml
  approve:
    if: github.event_name == 'workflow_dispatch' && inputs.promote
```

Le dépôt est privé sur un plan GitHub gratuit : ni règle de protection de
branche, ni ruleset, ni reviewer requis n'y sont disponibles. Cette ligne est
donc la **seule** chose qui empêche un push d'atteindre la production. Ne la
retire pas, et ne retire pas le `needs: approve` du job `promote`.
`.github/scripts/check-deploy-gate.sh` le vérifie en CI et au `pre-push`.

Les quatre autres règles — pas de `git pull` dans `ci-deploy-gcp.sh` côté CI,
pas de `~` dans un chemin de credential, pas de token dans une URL de remote,
pas de réessai automatique d'un déploiement — sont expliquées dans
[docs/DEPLOIEMENT.md](docs/DEPLOIEMENT.md#règles), avec la panne qui a motivé
chacune.

## Hooks

Les hooks git sont versionnés dans `.githooks/` et activés par
`git config core.hooksPath .githooks`, ce que fait `npm install` via le script
`prepare`. Après un nouveau clone, lance `npm install` avant de committer.

## Le reste du projet

Voir [AGENTS.md](AGENTS.md) : état de la base, pièges RLS / PgBouncer,
infrastructure, conventions.
