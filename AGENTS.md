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

## ════════════════════════════════════════════════════════════════
## CHECKLIST OBLIGATOIRE AVANT CHAQUE DÉPLOIEMENT
## ════════════════════════════════════════════════════════════════
##
## ⚠️  RÈGLE ABSOLUE : NE JAMAIS push sur main sans avoir exécuté
##     cette checklist EN ENTIER. Le workflow GitHub Actions reproduit
##     ces étapes, mais elles DOIVENT passer localement d'abord.
##     Si UNE seule étape échoue → corriger avant de push.
## ════════════════════════════════════════════════════════════════

### Phase 1 — CI Gate local (reproduit le JOB 1 du workflow)

```bash
cd "/Users/awalehosman/Documents/logiciel EcolPro"

# 1. Lint (0 erreur requise, warnings OK)
npm run lint

# 2. Type-check (0 erreur requise)
npx tsc --noEmit

# 3. Tests unitaires (continue-on-error dans CI, mais vérifier localement)
npm run test

# 4. Build production (173 pages attendues, exit 0)
npm run build
```

### Phase 2 — Vérification des scripts de déploiement

```bash
# 5. Syntaxe bash des scripts de déploiement
bash -n docker/scripts/blue-green-deploy.sh
bash -n docker/scripts/ci-deploy.sh
bash -n docker/scripts/apply-rls.sh
bash -n docker/scripts/smoke-test.sh
```

### Phase 3 — Vérification Docker

```bash
# 6. Dockerfile valide (analyse statique si Docker non disponible)
#    - Vérifier que prisma generate + next build sont dans le script build
#    - Vérifier que output: "standalone" est dans next.config.ts
#    - Vérifier que .dockerignore exclut .env, .git, node_modules

# 7. .dockerignore : les fichiers sensibles sont exclus
#    - .env → exclu
#    - .git → exclu
#    - node_modules → exclu
#    - .next → exclu
```

### Phase 4 — Vérification Caddy / Blue-Green

```bash
# 8. Caddyfile cohérent avec les upstreams
#    - docker/caddy/Caddyfile importe upstream.conf et upstream-simple.conf
#    - upstream.conf et upstream-simple.conf sont des FICHIERS (pas répertoires)
#    - ensure_upstream_files() est appelé dans deploy_staging() et promote_to_production()

# 9. apply-rls.sh est dans promote_to_production() (PAS dans deploy_staging())
#    - Les slots blue/green partagent la même DB
#    - Appliquer RLS pendant le staging modifie la DB de prod

# 10. validate_caddy() utilise caddy reload (zero downtime) avec fallback docker restart
```

### Phase 5 — Vérification GitHub

```bash
# 11. Required reviewers sur environment "production"
#     GitHub → Settings → Environments → production → Required reviewers
#     Si non configuré → le gate d'approbation est inefficace

# 12. Secrets GitHub présents
#     gh secret list -R wilsan007/EcolPro
#     Requis: VPS_HOST, VPS_USER, VPS_SSH_PRIVATE_KEY, VPS_SSH_PORT,
#             DATABASE_URL, DIRECT_URL, AUTH_SECRET, AUTH_URL, NEXT_PUBLIC_APP_URL
```

### Phase 6 — Vérification sécurité (patterns de bugs connus)

```bash
# 13. Aucun filtre classeId sur prisma.classe.* (bug FK/PK)
#     grep -r "prisma.classe.*classeId" src/ → doit retourner 0 résultat

# 14. eleveScopeFilter appliqué sur toutes les pages accessibles à PARENT/STUDENT
#     Pages concernées: /absences, /notes, /notes/bulletins, /emploi-du-temps,
#     /eleves/[id], et toutes les API /api/eleves, /api/notes, /api/absences, etc.
#     siteFilterForModel retourne {} pour PARENT/STUDENT → eleveScopeFilter OBLIGATOIRE

# 15. Aucun siteFilterForModel avec un mauvais nom de modèle
#     Vérifier que chaque appel siteFilterForModel("model", ...) correspond
#     à un modèle déclaré dans SITE_PATHS dans src/lib/site-scope.ts
```

### Phase 7 — Push et monitoring

```bash
# 16. Commit avec message descriptif
git add -A && git commit -m "fix/feat: description claire"

# 17. Push
git push origin main

# 18. Monitorer le workflow
#     https://github.com/wilsan007/EcolPro/actions
#     - JOB 1 (CI Gate) → doit passer
#     - JOB 2 (Build Docker) → doit passer
#     - JOB 3 (Staging) → doit passer (smoke tests)
#     - JOB 4 (Approval) → attendre approbation manuelle
#     - JOB 5 (Promote) → blue-green switch + healthcheck
#     - JOB 6 (E2E) → désactivé (if: false)
```

### Règles d'or (à ne jamais oublier)

1. **Jamais push sans build local vert** — `npm run build` doit passer
2. **Jamais de filtre where réutilisé entre modèles Prisma différents** — `classeId` est une FK sur `Eleve`, pas sur `Classe` (qui utilise `id`)
3. **Toujours eleveScopeFilter pour PARENT/STUDENT** — `siteFilterForModel` retourne `{}` pour ces rôles, l'isolation doit venir du filtre relationnel
4. **apply-rls.sh dans promote, pas dans staging** — les slots partagent la même DB
5. **caddy reload avant docker restart** — zero downtime en premier, fallback seulement
6. **ensure_upstream_files() avant toute opération Caddy** — prévient le bug répertoires Docker
7. **Vérifier Required reviewers GitHub** — sans ça, le gate humain est inefficace

### Règles d'import d'emploi du temps (système djiboutien)

**Système scolaire djiboutien :**
- Maternelle : Maternelle, PS, MS, GS
- Primaire : 1ère à 5ème année (niveaux "1ère" à "5ème")
- Collège : 6ème à 9ème année (niveaux "6ème" à "9ème")
- Lycée : Seconde, Première, Terminale

**Règles de parsing (import-parser.ts) :**

8. **Nettoyer les durées des noms de matières** — `cleanMatiereName()` supprime
   "40 min", "30 ou 40 min", "50 à 60 min" etc. avant le matching.
   "Lecture 40 min" → "Lecture", jamais "Lecture 40 min" en base.
9. **Préserver les numéros de séance** — "Lecture 1", "Lecture 2" sont des
   séances distinctes d'une même matière. Le matching cherche d'abord le nom
   complet ("Lecture 1"), puis le nom base ("Lecture") en fallback seulement.
10. **Snapping non-destructif (tolérance 5 min)** — `snapCreneauToGrid()` conserve
    l'heure originale si l'écart avec la grille est ≤ 5 min. 12:45 reste 12:45,
    n'est pas déformé en 12:50.
11. **Fuzzy matching strict pour l'import** — `fuzzyFindStrict()` exige ≥ 4 chars
    pour le needle et ≥ 5 chars de préfixe commun. "Graphisme" ne matche PAS
    "Écriture". "EM" ne matche PAS "EMT" ni "EMCI".
12. **"1ère" = Primaire, "Première" = Lycée** — ne JAMAIS confondre. Le système
    djiboutien utilise "1ère" pour "1ère année" (primaire) et "Première" pour
    la classe de Première (lycée). Ces deux chaînes sont distinctes en base.

### Règles d'affichage des matières

13. **Afficher le nom complet, jamais le code** — Dans la grille d'emploi du
    temps, `creneau.matiere.nom` est affiché en grand (ex: "Lecture", "Arabe",
    "Graphisme"). Le code ("G", "AE", "AS") n'est qu'un complément minuscule.
14. **Numéro suffixe = niveau** — Quand une matière a un numéro suffixe
    ("Lecture 1", "Lecture 2", "Graphisme 3"), ce numéro indique le NIVEAU
    (1-5 pour le primaire, 6-9 pour le collège, 10-12 pour le lycée).
    `parseMatiereNiveau()` sépare le nom ("Lecture") du niveau ("1").
    Le niveau va dans la colonne `niveau` de la matière, pas dans son nom.
15. **Couleurs obligatoires** — Chaque matière doit avoir une couleur (`couleur`)
    pour la distinction visuelle dans la grille. La palette étendue (15 couleurs)
    est dans `matiereColor()` du composant `EmploiDuTempsView`.
16. **Noms normalisés** — Les matières sont écrites en nom complet proprement :
    "Arabe" (pas "ARABE" ni "AE"), "Anglais" (pas "ANGLAIS" ni "AS"),
    "Poésie-Chant" (pas "POESIE/ CHANT"), "Graphisme" (pas "G").
