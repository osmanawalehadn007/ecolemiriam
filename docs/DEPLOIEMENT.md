# Déploiement — procédure de référence

> **Ce document fait autorité.** En cas de contradiction avec
> `docker/DEPLOYMENT-GCP.md`, `docker/DEPLOYMENT-CI.md` ou `docker/RUNBOOK.md`,
> c'est celui-ci qui s'applique. Vérifié en conditions réelles le 2026-08-31.

## En un paragraphe

Un push sur `main` construit l'image, la déploie sur le slot **inactif** de la
VM et y passe les smoke tests. **Il ne touche pas à la production.** La bascule
vers la production est une action manuelle et séparée. Cette séparation est la
seule barrière existante : le dépôt est privé sur un plan GitHub gratuit, où ni
les règles de protection de branche, ni les rulesets, ni les reviewers requis ne
sont disponibles (`403 Upgrade to GitHub Pro`).

## Déployer

`main` est protégée : le push direct est refusé. Tout passe par une pull
request, y compris les commits d'un agent.

```bash
git checkout -b mon-changement
git push -u origin mon-changement
gh pr create --fill
gh pr merge --squash --delete-branch
```

La PR doit voir passer le contrôle **Porte de promotion intacte** avant de
pouvoir être fusionnée. Aucune approbation humaine n'est exigée — la règle
existe pour forcer le passage du garde-fou, pas pour imposer un relecteur.

Le workflow enchaîne `ci-gate` → `build-and-push` → `staging`, puis **s'arrête**.
Les jobs `approve` et `promote` apparaissent en `skipped` : c'est le
comportement attendu, pas une anomalie.

Surveiller :

```bash
gh run watch $(gh run list --workflow=deploy-gcp.yml --limit 1 --json databaseId --jq '.[0].databaseId')
```

## Promouvoir en production

Décision humaine, jamais automatique.

```bash
gh workflow run deploy-gcp.yml -R wilsan007/EcolPro -f promote=true
```

Ou dans l'interface : *Actions* → *Build & Deploy (GCP)* → *Run workflow* →
cocher **Promouvoir le slot staging en production**.

Vérifier ensuite :

```bash
curl -sL -o /dev/null -w '%{url_effective} %{http_code}\n' https://app.ecolemiriam.com/
curl -s https://app.ecolemiriam.com/api/health
```

Attendu : redirection vers `/login` en `200`, et `{"ok":true}`.

## Revenir en arrière

La bascule blue-green est réversible : l'ancien slot existe toujours.

```bash
gcloud compute ssh ecolpro-prod --zone=us-central1-a --project=ecole-miriam \
  --tunnel-through-iap \
  --command='/opt/ecolemiriam/docker/scripts/blue-green-deploy-gcp.sh --rollback'
```

État courant à tout moment :

```bash
gcloud compute ssh ecolpro-prod --zone=us-central1-a --project=ecole-miriam \
  --tunnel-through-iap \
  --command='/opt/ecolemiriam/docker/scripts/blue-green-deploy-gcp.sh --status'
```

## Règles

Elles existent parce que chacune correspond à une panne réellement survenue.

**Ne pas retirer la condition du job `approve`** dans
`.github/workflows/deploy-gcp.yml`. Elle seule empêche un push d'atteindre la
production. `.github/scripts/check-deploy-gate.sh` le vérifie dans la CI et au
`pre-push` ; si tu dois la changer, adapte aussi ce contrôle et dis-le dans le
message de commit.

**Ne pas remettre de `git pull` dans `ci-deploy-gcp.sh`** pour le chemin CI. Ce
script vit dans `/opt/ecolemiriam` : un `git pull` lancé depuis lui réécrit le
fichier que bash est en train de lire, et l'exécution en cours termine sur
l'ancienne logique. La synchronisation est une étape distincte du workflow, et
le script la saute via `CI_SKIP_GIT_SYNC=1`.

**Ne pas utiliser `~` pour un chemin de credential** dans les scripts de
déploiement. OS Login crée un utilisateur Linux par identité IAM : un humain se
connecte en `zdouce_zz_gmail_com`, le service account en
`sa_110635482925741543279`. Un `~` se résout donc différemment selon qui
déploie — c'est ce qui faisait marcher le déploiement manuel et échouer
l'automatique. Les secrets partagés vivent dans `/etc/ecolemiriam/`.

**Ne pas mettre de token dans une URL de remote git.** Le dépôt de la VM a
utilisé `https://user:TOKEN@github.com/...` : tout utilisateur de la machine
pouvait lire le PAT dans `.git/config`, et il apparaissait dans la sortie de
`git remote -v`. Les credentials passent par
`/etc/ecolemiriam/git-credential-ro.sh`.

**Ne pas réessayer un déploiement échoué automatiquement.** Ni
`ci-deploy-gcp.sh` ni la bascule blue-green ne sont idempotents.
`.github/scripts/ssh-retry.sh` ne réessaie que le code de sortie `255`, qui
signale un échec de `ssh` lui-même — la commande distante n'a alors pas démarré.

## En cas d'incident — désactiver la protection

Une barrière sans issue de secours devient un problème le jour où la
production est cassée à 2 h du matin. Pour reprendre le push direct :

*Settings* → *Rules* → *Rulesets* → **Protection main** → *Enforcement status*
sur **Disabled**. Ou en ligne de commande :

```bash
gh api -X PUT repos/wilsan007/EcolPro/rulesets/21158529 -f enforcement=disabled
```

Réactiver ensuite avec `-f enforcement=active`. Le ruleset n'a **aucun**
bypass_actor : c'est délibéré, la désactivation est un geste visible et
tracé, là où un contournement silencieux ne laisserait rien.

## Infrastructure (vérifiée le 2026-08-31)

| | |
|---|---|
| Projet GCP | `ecole-miriam` |
| VM | `ecolpro-prod`, zone `us-central1-a`, `e2-standard-2` |
| Accès SSH | IAP uniquement — `allow-ssh-iap`, source `35.235.240.0/20` |
| Service account | `github-actions-deploy@ecole-miriam.iam.gserviceaccount.com` |
| Utilisateur OS Login du SA | `sa_110635482925741543279` (groupes `docker`, `ecolpro`) |
| Authentification CI | Workload Identity Federation, aucune clé stockée |
| Image | `ghcr.io/wilsan007/ecolemiriam-app` |
| Code sur la VM | `/opt/ecolemiriam`, `2775 zdouce_zz_gmail_com:ecolpro` |

Secrets, en `640 root:ecolpro` dans `/etc/ecolemiriam/` :

| Fichier | Usage |
|---|---|
| `ghcr-token` | PAT classique, scope `read:packages` — `docker pull` |
| `git-credentials` | PAT fine-grained, Contents Read-only sur `EcolPro` — `git pull` |
| `git-credential-ro.sh` | helper git système ; ignore `store`/`erase` pour que le fichier ne soit jamais réécrit |

Se connecter à la VM :

```bash
gcloud compute ssh ecolpro-prod --zone=us-central1-a --project=ecole-miriam --tunnel-through-iap
```

Les commandes `gcloud` et `gh` se lancent depuis un poste de travail. Sur la VM,
le `gcloud` local utilise le compte de service par défaut de l'instance, aux
scopes volontairement restreints : il échoue en
`ACCESS_TOKEN_SCOPE_INSUFFICIENT`.

## Panne connue

`Permission denied (publickey)` sur `sa_110635482925741543279`, de façon
intermittente et sans cause identifiée. Observé avec deux connexions réussies
suivies d'un refus quatre secondes plus tard, sur la même clé et dans le même
job — ce n'est donc pas un délai de propagation OS Login.

`.github/scripts/ssh-retry.sh` l'atténue en réessayant jusqu'à trois fois. Si le
problème devient fréquent, la piste à creuser est le journal de l'agent invité
au moment d'un échec :

```bash
gcloud compute ssh ecolpro-prod --zone=us-central1-a --project=ecole-miriam \
  --tunnel-through-iap \
  --command='sudo journalctl -u google-guest-agent --since "1 hour ago" --no-pager | tail -60'
```
