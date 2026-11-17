# Logiciel EcolPro — Règles du projet

## Déploiement — lire avant de toucher à la CI ou à l'infra

**Procédure de référence : [docs/DEPLOIEMENT.md](docs/DEPLOIEMENT.md)**, qui
fait autorité sur `docker/DEPLOYMENT-GCP.md`, `docker/DEPLOYMENT-CI.md` et
`docker/RUNBOOK.md` — dont certaines parties sont périmées.

L'essentiel : **un push sur `main` ne déploie pas en production**, il s'arrête
au slot staging. La promotion est manuelle. Cette séparation repose sur une
seule condition dans `.github/workflows/deploy-gcp.yml` (`approve.if`). Ne la
retire pas : `.github/scripts/check-deploy-gate.sh` la vérifie au `pre-push`,
en CI et en statut requis sur les PR.

**`main` est protégée : le push direct est refusé.** Passe par une branche et
une pull request (`gh pr create --fill`, puis `gh pr merge --squash
--delete-branch`).

## État des bases de données (vérifié 2026-09-27)

**Il y a DEUX bases. Seule la première est utilisée par l'application :**

| | Base **live** | Vestige |
|---|---|---|
| Projet | Supabase `hyejtirvtdhxseambzyg` (`aws-0-eu-west-1`) | Postgres du VPS (`ecolemiriam-postgres`, Hetzner) |
| Utilisée par | le conteneur applicatif (`ecolemiam-app-blue`) | **personne** depuis la migration du 26/09 |
| Vérifié le 27/09 | 74 tables, `invitations` + `mustChangePassword` présents, **36 users**, 1 tenant, **692 élèves**, activité le jour même | 71 tables, 34 users, données figées au 23/08 |
| Rôle | `postgres.hyejtirvtdhxseambzyg` (RLS non applicable) | `ecolemiriam_owner` / `ecolemiriam_app` + PgBouncer (RLS forcé) |

**Ne JAMAIS supposer qu'une base est vide, et ne jamais présumer laquelle est
live : la vérifier.** Outil dédié (lecture seule) :

```bash
export DIRECT_URL="$(grep '^DIRECT_URL=' .env | cut -d= -f2- | tr -d '\"')"
node scripts/diagnostic-db.mjs
```

Le Postgres du VPS reste utile comme **copie de secours** (données au 23/08 :
880 élèves, 29 classes, 3 sites) et via le tunnel SSH
(`./scripts/start-vps-tunnel.sh`, ports 15432/16432) — mais il ne faut pas y
écrire : ce serait écrire dans une base morte.

### Version réellement déployée (vérifié 2026-09-28)

- **La production tourne sur GCP** (instance `ecolpro-prod`, `us-central1-a`) :
  `deploy-gcp.yml` construit l'image, la déploie dans le slot de staging, puis
  bascule Caddy (« Bascule Caddy → app-blue ») après approbation manuelle. Le
  `10f8b3a` (audit + invitations + facturation) y est en ligne ; vérifié :
  `/api/health` = 200, `accept-invitation` = 200 et CSP avec *nonce*
  (absente de l'ancienne image).
- Le **stack Hetzner/VPS est un vestige** : `ecolemiam-app-blue` y tourne encore
  l'image du **07/09/2026** (Next 15, sans les invitations) et ne reçoit plus le
  trafic du domaine. Ne pas y déployer, ne pas s'y fier pour vérifier la
  production.
- Le garde-fou RLS « fail-closed » (23/08) est dans toutes les versions
  postérieures : toute action serveur sans contexte tenant lève une erreur
  (c'est le bug `/register` corrigé par la PR #26).

### Piège RLS / PgBouncer (stack du VPS uniquement)

- RLS est **actif et forcé** sur `eleves`, `sites`, `classes`, `factures`
- Le rôle `ecolemiriam_app` (via PgBouncer, port 16432) retourne **0 lignes** sans contexte RLS
- Le rôle `ecolemiriam_owner` (via port 15432, DIRECT_URL) contourne RLS → voit toutes les données
- Pour voir les données via le rôle app, il faut définir: `SET app.tenant_id = 'cms8kt0b40001zbi3o63y7c5v'; SET app.is_super_admin = 'true';`
- **PgBouncer en mode transaction pooling** peut ne pas persister les `SET app.*` entre transactions
- **Corrigé le 29/09/2026 :** en production, le conteneur applicatif se connecte à
  Supabase avec **`ecolemiriam_app`** (pooler, port 6543) : la RLS **s'applique**.
  Seul `DIRECT_URL` (rôle `postgres`) la contourne. Un script de diagnostic
  lancé avec `DIRECT_URL` peut donc réussir là où l'application échoue.
- Piège : sous RLS, une relation Prisma **obligatoire** (ex. `affectation.classe`)
  vers une ligne masquée (classe d'un autre site quand `app.site_id` est posé)
  fait échouer **toute** la requête (« Field classe is required to return data,
  got null »). Filtrer l'include : `where: { classe: { tenantId } }`.

### Connexions DB

- `DIRECT_URL`: connexion directe (hors pooler) — migrations, admin, diagnostic
- `DATABASE_URL`: connexion applicative (pooler / PgBouncer), filtrée par RLS
- Tunnel SSH vers le **VPS** (base vestige): `./scripts/start-vps-tunnel.sh` (VPS: root@169.58.208.217)

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
#     gh secret list -R osmanawalehadn007/ecolemiriam
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
#     https://github.com/osmanawalehadn007/ecolemiriam/actions
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

### Règles de facturation (décisions du 27/09/2026)

Référence complète : **[docs/DECISIONS-FACTURATION.md](docs/DECISIONS-FACTURATION.md)**.

17. **Résolution tarifaire canonique** — Le tarif se résout uniquement via
    `src/lib/tarifs.ts` (`cleNiveau` + `choisirTarif`). « 1ère », « 1er »,
    « 1ère année » → `an1` ; « Première » (lycée) reste `premiere` : ce sont
    deux tarifs différents (7 000 vs 15 000 DJF). Le tarif du site de l'élève
    prime sur le tarif global ; celui d'un autre site n'est jamais utilisé.
    **Niveau non résolu ⇒ on ne facture pas** (`sansTarif`) — jamais de montant
    deviné.
18. **Mensualités idempotentes** — Un seul cœur
    (`src/lib/factures/mensualites.ts`) alimente le cron
    `/api/cron/facturation-mensuelle` (`CRON_SECRET`, ordonnancé par
    `.github/workflows/cron-facturation.yml`), le CLI
    `scripts/generer-mensualites.ts` (aperçu par défaut, `--apply` pour écrire)
    **et le bouton « Générer » de l'écran Facturation** (`genererMensualites` /
    `genererFacturesAnnuelles` délèguent au cœur, bornés à
    `siteFilterForModel("eleve", …)`). Le second moteur qui cohabitait a été
    supprimé le 29/09/2026 : il comparaît les niveaux en chaîne brute (« 2 »
    ne rencontrait pas « 2ème » → 191 élèves ignorés en silence) et ajoutait
    les frais de réinscription à la mensualité de septembre, produisant un
    montant différent de celui du cron pour le même mois.
    L'unicité `(tenantId, eleveId, type=MENSUALITE, mois)` est garantie par
    l'**index partiel en base** `factures_unicite_mensuelle` (une facture
    annulée libère le mois). Ne JAMAIS remplacer ce verrou par un simple test
    applicatif : deux exécutions simultanées le perdraient.
    Conséquence de l'alignement : les options **cantine** et **transport** ne
    facturent que ce que la grille déclare (`fraisCantine` / `fraisTransport`).
    Aucun forfait codé en dur — renseignez ces colonnes dans Paramètres →
    Tarifs avant de cocher l'option.
    **Septembre est manuel** : les frais d'inscription / de réinscription ne
    sont ajoutés que si l'appelant les demande (`inclureFraisInscription`,
    `inclureFraisRenouvellement` — écran Facturation, `?inscription=1` du cron,
    `--inscription` du CLI) et **seulement** pour `mois = 9`. Par défaut,
    septembre est facturé comme les autres mois. Le dédoublonnage compte aussi
    l'`INSCRIPTION` du mois : le flux d'admission écrit « Frais d'inscription +
    Scolarité Septembre » dans une seule facture, la recréer comme mensualité
    double-facturerait la famille.
19. **Prérequis de déploiement** — La CI ne joue pas les migrations.
    `migration_facture_mensualite_unicite.sql` doit être appliqué sur la base
    cible (idempotent), et `select count(*) from factures_mensualites_doublons`
    doit renvoyer **0** avant d'activer la génération.
20. **Portail famille** — `/mes-factures` est accessible à PARENT/STUDENT : le
    périmètre vient obligatoirement de `eleveScopeFilter(user, "eleve")`
    (`siteFilterForModel` renvoie `{}` pour ces rôles). Un parent ne doit jamais
    voir la facture d'un autre élève — c'est vérifié par
    `tests/e2e/mes-factures-isolation.spec.ts`.
21. **Une seule échelle de relance** — Les rappels d'impayés passent par
    `cron/relances-auto` (`Facture.relances.niveau`). Ne pas ajouter un second
    système d'alerte : deux moteurs enverraient deux relances au même parent.


### Règles d'administration des comptes

22. **Un compte créé par l'administration démarre non vérifié** — et
    `authorize()` refuse alors toute connexion (« Email non vérifié »). Pour
    débloquer un compte dont l'adresse est fiable, l'admin dispose de deux
    leviers dans **Paramètres → Utilisateurs** : « Renvoyer l'email de
    vérification » (par ligne) ou **« Marquer l'email comme vérifié »**
    (par ligne, ou globalement via le bandeau qui recense les comptes non
    vérifiés). L'action serveur `marquerEmailsVerifies` exige
    `parametres:write`, ne touche que les comptes du périmètre dont
    `emailVerified` est nul, et journalise `user:email:verify`.
    Ne JAMAIS court-circuiter ce contrôle par un `update` SQL manuel : le bouton
    existe précisément pour que l'opération soit permissionnée et tracée
    (parcours prouvé par `tests/e2e/verification-email-admin.spec.ts`).
    Pour un rattrapage massif (import de centaines de comptes) ou une base sans
    session d'admin, l'outil d'exploitation
    `scripts/marquer-emails-verifies.ts` applique la même règle et écrit la même
    trace d'audit (lecture seule par défaut, `--apply` pour écrire).

### Règles de nommage des niveaux (décisions du 29/09/2026)

23. **Le niveau est un référentiel FERMÉ** — `Classe.niveau` et
    `TarifNiveau.niveau` n'acceptent que les 13 valeurs de
    `NIVEAUX_CANONIQUES` (`src/lib/niveau.ts`) : Maternelle, 1ère → 5ème,
    6ème → 9ème, Seconde, Première, Terminale. Toute saisie passe par
    `normaliserNiveau()` (« 2 », « 2eme », « 2ème année », « classe de 6ème »,
    « PS/MS », « 2nde » → valeur officielle) et l'inclassable est **refusé**
    (`niveauOuErreur`), jamais deviné. La grille tarifaire est indexée sur ce
    libellé : une classe écrite « 2 » était **infacturable** (191 élèves de
    Campus Central invisibles du moteur le 28/09/2026). Ne jamais réintroduire
    de liste locale : les écrans (Classes, Tarifs) et l'import consomment le
    référentiel partagé.
    ⚠️ « 1ère » (1ère année, primaire) ≠ « Première » (lycée) : deux niveaux,
    deux tarifs (7 000 vs 15 000 DJF).
    ⚠️ `Matiere.niveau` est hors sujet : il porte un numéro (1-12) de suffixe
    (« Lecture 1 » → 1), cf. §14.
24. **Le verrou est en base** — `migration_niveaux_canoniques.sql` (idempotent)
    pose `classes_niveau_canonique` et `tarifs_niveau_canonique` (CHECK sur la
    liste). Application sans psql :
    `npx tsx scripts/appliquer-migration-niveaux.ts --apply` (vérifie d'abord
    qu'aucune donnée n'est hors référentiel, puis prouve qu'un « 2 » est
    refusé). Pour corriger des données existantes :
    `npx tsx scripts/harmoniser-niveaux-classes.ts` (audit, `--apply` pour
    écrire) — il signale aussi les noms de classe qui contredisent leur niveau.
    Une contrainte ne dispense pas de normaliser côté application : elle
    renvoie une erreur SQL brute, là où `normaliserNiveau` accepte la saisie.
25. **La promotion automatique dérive du référentiel** —
    `niveauSuivant()` (`src/lib/niveau-suivant.ts`) lit l'échelle
    `NIVEAUX_CANONIQUES` après normalisation : une classe historique « 2 » ou
    « 2ème année » trouve désormais son niveau suivant, au lieu d'être
    signalée « sans changement » et laissée à la main.
26. **Le périmètre de l'import s'arrête aux sites du demandeur** — `site` EST
    la table des sites : on borne sur `id` (`resolveSiteScope`), et un compte
    sans rattachement est refusé (fail-closed) avant même de constituer le
    plan. `POST /api/import/enseignants` revérifie chaque ligne avec
    `canAccessSite` et écrit User + Enseignant + rattachement site/matière +
    classe + affectation dans **une seule transaction RLS**
    (`runWithRlsBatch`) : plus de compte TEACHER orphelin, plus d'échec avalé
    par un `.catch(() => {})`, et l'année de la classe créée vient de
    `getAnneeCouranteLibelle` (jamais d'une constante).

