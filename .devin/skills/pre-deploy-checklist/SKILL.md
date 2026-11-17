# Pre-Deploy Checklist — EcolPro

## Quand invoquer ce skill

**TOUJOURS** avant de pousser du code sur `origin/main` ou de déployer sur le VPS.
Ce skill reproduit le workflow GitHub Actions localement pour garantir que
le déploiement ne va pas échouer en CI/CD.

## Checklist obligatoire (18 étapes)

### Phase 1 — CI Gate local (JOB 1 du workflow)

1. `npm run lint` — 0 erreur requise (warnings OK)
2. `npx tsc --noEmit` — 0 erreur de type
3. `npm run test` — tests unitaires (continue-on-error en CI)
4. `npm run build` — build production (173 pages, exit 0)

### Phase 2 — Scripts de déploiement

5. `bash -n docker/scripts/blue-green-deploy.sh` — syntaxe OK
6. `bash -n docker/scripts/ci-deploy.sh` — syntaxe OK
7. `bash -n docker/scripts/apply-rls.sh` — syntaxe OK
8. `bash -n docker/scripts/smoke-test.sh` — syntaxe OK

### Phase 3 — Docker

9. Dockerfile valide (prisma generate + next build + standalone)
10. .dockerignore exclut .env, .git, node_modules, .next

### Phase 4 — Caddy / Blue-Green

11. upstream.conf et upstream-simple.conf sont des FICHIERS (pas répertoires)
12. ensure_upstream_files() appelé dans deploy_staging() et promote_to_production()
13. apply-rls.sh est dans promote_to_production() (PAS dans deploy_staging())
14. validate_caddy() utilise caddy reload (zero downtime) avec fallback docker restart

### Phase 5 — GitHub

15. Required reviewers sur environment "production" (GitHub UI)
16. Secrets GitHub présents (gh secret list)

### Phase 6 — Sécurité (bugs connus)

17. Aucun filtre `classeId` sur `prisma.classe.*` (confusion FK/PK)
18. `eleveScopeFilter` appliqué sur toutes les pages accessibles à PARENT/STUDENT

## Règles d'or

1. **Jamais push sans build local vert**
2. **Jamais de filtre where réutilisé entre modèles Prisma différents**
3. **Toujours eleveScopeFilter pour PARENT/STUDENT**
4. **apply-rls.sh dans promote, pas dans staging**
5. **caddy reload avant docker restart**
6. **ensure_upstream_files() avant toute opération Caddy**
7. **Vérifier Required reviewers GitHub**

## Si une étape échoue

- **STOP** — ne pas push
- Corriger l'erreur
- Re-exécuter la checklist complète
- Push uniquement quand tout est vert

## Après le push

- Monitorer https://github.com/osmanawalehadn007/ecolemiriam/actions
- Attendre l'approbation manuelle (JOB 4)
- Vérifier le healthcheck post-promotion (JOB 5)
