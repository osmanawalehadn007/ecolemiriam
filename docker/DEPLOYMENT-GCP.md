# École Miriam — Déploiement sur Google Cloud (Compute Engine)

Variante GCP de [DEPLOYMENT-VPS.md](./DEPLOYMENT-VPS.md). Seules les étapes
**0 (créer le serveur)** et **8 (firewall)** changent : à partir de l'étape 2
(Cloudflare), le guide VPS s'applique tel quel.

Projet cible : `ecole-miriam`

---

## Configuration retenue

| Élément | Valeur | Pourquoi |
|---|---|---|
| Machine | `e2-standard-2` — 2 vCPU, 8 Go RAM | 4 Go ne suffisent pas : `postgres` a un `mem_limit` de 4 Go et les deux slots app (1,5 Go chacun) tournent simultanément pendant une bascule blue/green |
| **Pas** `e2-medium` | — | Shared-core : 2 vCPU affichés mais 1 seul en baseline soutenu |
| Disque | 100 Go `pd-balanced` | Sur GCP les IOPS sont proportionnelles à la taille ; 100 Go ≈ 3 600 IOPS. Nécessaire pour `postgres-data` + `postgres-wal` + les 4 fulls pgBackRest |
| OS | Ubuntu 24.04 LTS | Ce que `harden-os.sh` et les scripts supposent |
| Région | `europe-west1` (Belgique) | Meilleur rapport latence/prix pour l'Afrique francophone. Alternatives : `europe-west9` (Paris, +10 %, meilleure latence Afrique de l'Ouest), `me-central1` (Doha, pour Djibouti) |
| Réseau | Aucun port entrant, IP éphémère sortante | Cloudflare Tunnel est sortant-only ; SSH via IAP |
| Swap | 4 Go | Absorbe le pic blue/green, inactif en régime normal |

### Budget mensuel estimé (europe-west1, USD — à revérifier sur le calculateur GCP)

| Poste | À la demande | Engagement 1 an |
|---|---|---|
| e2-standard-2 (730 h) | ~54 | ~34 |
| Disque 100 Go pd-balanced | ~11 | ~11 |
| IP externe (sortie) | ~4 | ~4 |
| Egress ~100 Go/mois | ~9 | ~9 |
| Snapshots hebdo incrémentaux | ~3 | ~3 |
| Cloudflare R2 (offsite, 30 Go) | ~1 | ~1 |
| **Total** | **~82 $/mois** | **~62 $/mois** |

Les 300 $ de crédit d'essai couvrent environ **3,5 mois**.
**Ne prendre l'engagement 1 an qu'après cette période**, une fois la charge réelle mesurée.

**Deux pièges de coût à éviter :**
- **Ne jamais activer Cloud NAT** (~32 $/mois). Une IP externe éphémère à 4 $ suffit pour le trafic sortant du tunnel.
- **Sauvegardes offsite vers Cloudflare R2, pas vers Cloud Storage** : R2 est à 0,015 $/Go **sans frais d'egress**. Le `repo2` est déjà pré-écrit en commentaire dans `pgbackrest/pgbackrest.conf`.

---

## Étape 0 — Compte et facturation

1. Aller sur https://console.cloud.google.com et se connecter.
2. Activer l'essai gratuit (**300 $ / 90 jours**) — une carte bancaire est demandée
   pour vérification, mais **rien n'est débité automatiquement** à la fin de l'essai :
   il faut basculer manuellement en compte payant.
3. Vérifier que le projet `ecole-miriam` existe et est **lié à un compte de facturation** :
   *Facturation → Gérer les comptes de facturation → Associer le projet*.
   Sans cela, la création de VM échoue.
4. **Créer une alerte de budget immédiatement** :
   *Facturation → Budgets et alertes → Créer un budget*
   - Montant : **100 $/mois**
   - Seuils d'alerte : 50 %, 90 %, 100 %
   - Cocher « M'envoyer un e-mail »

   C'est le garde-fou le plus important : GCP n'a pas de plafond de dépense automatique.

---

## Étape 1 — Installer et configurer gcloud (sur ton Mac)

```bash
brew install --cask google-cloud-sdk
```

```bash
gcloud init
```

Choisir le compte Google, puis le projet `ecole-miriam`.

Puis fixer les valeurs par défaut et activer les API nécessaires :

```bash
gcloud config set project ecole-miriam && gcloud config set compute/region europe-west1 && gcloud config set compute/zone europe-west1-b && gcloud services enable compute.googleapis.com iap.googleapis.com oslogin.googleapis.com
```

L'activation des API prend 1 à 2 minutes la première fois.

---

## Étape 2 — Créer la VM

```bash
gcloud compute instances create ecolemiriam-prod --machine-type=e2-standard-2 --zone=europe-west1-b --image-family=ubuntu-2404-lts-amd64 --image-project=ubuntu-os-cloud --boot-disk-size=100GB --boot-disk-type=pd-balanced --boot-disk-device-name=ecolemiriam-prod --no-service-account --no-scopes --shielded-secure-boot --shielded-vtpm --shielded-integrity-monitoring --metadata=enable-oslogin=TRUE,serial-port-enable=TRUE --deletion-protection --tags=ecolemiriam
```

Explication des options non évidentes :

- `--no-service-account --no-scopes` : la VM n'a **aucun droit** sur ton projet GCP.
  Si elle est compromise, l'attaquant ne peut pas piloter ton infrastructure Google.
- `--shielded-*` : Secure Boot + vTPM, protège contre les rootkits au démarrage.
- `enable-oslogin=TRUE` : les accès SSH sont gérés par IAM, pas par des clés déposées
  dans le projet. Révoquer un accès = retirer un rôle IAM.
- `serial-port-enable=TRUE` : **console de secours**. Indispensable — c'est ton
  seul recours si tu te verrouilles hors du SSH (voir étape 5).
- `--deletion-protection` : impossible de supprimer la VM par accident.

---

## Étape 3 — Fermer le réseau

Par défaut, le VPC `default` de GCP expose SSH et RDP à Internet entier. Comme
Cloudflare Tunnel n'a besoin d'**aucun port entrant**, on supprime tout et on
n'autorise SSH que depuis la plage IAP de Google.

```bash
gcloud compute firewall-rules delete default-allow-ssh default-allow-rdp --quiet
```

```bash
gcloud compute firewall-rules create allow-ssh-iap --network=default --direction=INGRESS --action=ALLOW --rules=tcp:22 --source-ranges=35.235.240.0/20 --target-tags=ecolemiriam --description="SSH uniquement via Cloud IAP"
```

`35.235.240.0/20` est la plage réservée de Google pour l'IAP TCP forwarding.
Aucune IP publique ne peut plus atteindre le port 22.

Vérifier :

```bash
gcloud compute firewall-rules list --format="table(name,direction,sourceRanges.list(),allowed[].map().firewall_rule().list())"
```

Se connecter désormais ainsi (plus jamais par IP publique) :

```bash
gcloud compute ssh ecolemiriam-prod --zone=europe-west1-b --tunnel-through-iap
```

---

## Étape 4 — Swap + préparation système

Une VM GCP n'a **aucun swap** par défaut. Sur la VM :

```bash
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile && echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab && sudo sysctl -w vm.swappiness=10 && echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-swappiness.conf
```

`swappiness=10` : le swap ne sert qu'en cas de vraie pression mémoire (la bascule
blue/green), jamais en régime normal — Postgres déteste être swappé.

Vérifier :

```bash
free -h && df -h /
```

---

## Étape 5 — Durcissement OS (⚠️ lire avant d'exécuter)

**Prendre un snapshot AVANT.** C'est le filet de sécurité si le durcissement
te verrouille dehors :

```bash
gcloud compute disks snapshot ecolemiriam-prod --zone=europe-west1-b --snapshot-names=avant-hardening
```

### Adaptation obligatoire pour GCP : `SSH_PORT=22`

`harden-os.sh` déplace SSH sur le port **22022** par défaut. Sur GCP c'est à la
fois **inutile et dangereux** :

- **Inutile** : le port 22 n'est déjà plus joignable depuis Internet (étape 3),
  seule la plage IAP y accède. Changer de port n'ajoute rien.
- **Dangereux** : Ubuntu 24.04 démarre SSH par **activation de socket systemd**
  (`ssh.socket`). La directive `Port` de `sshd_config` y est **ignorée** — SSH
  resterait sur 22 alors qu'UFW n'autoriserait que 22022. Résultat : verrouillage
  immédiat hors de la machine.

Donc, sur la VM :

```bash
git clone https://github.com/wilsan007/ecolemiriam.git /opt/ecolemiriam && cd /opt/ecolemiriam && sudo SSH_PORT=22 bash docker/scripts/harden-os.sh
```

Le script installe aussi Docker — pas besoin de `get.docker.com` séparément.

**Après le script, sans fermer ta session SSH actuelle**, ouvrir un **second**
terminal et vérifier que la connexion passe toujours :

```bash
gcloud compute ssh ecolemiriam-prod --zone=europe-west1-b --tunnel-through-iap
```

Si ça échoue, tu as encore la première session ouverte pour corriger
(`sudo ufw allow 22/tcp`). En dernier recours : console série depuis la console
GCP (activée à l'étape 2), ou restauration du snapshot `avant-hardening`.

### Note UFW + Docker

UFW ne filtre pas les conteneurs Docker (Docker écrit directement dans iptables).
Ce n'est pas un problème ici : `docker-compose.yml` ne publie **aucun port** sur
l'hôte — tout est interne, et cloudflared sort en connexion sortante.

---

## Étape 6 — Sauvegardes automatiques du disque

En complément de pgBackRest (niveau base de données), un snapshot hebdomadaire du
disque entier permet de reconstruire la VM complète :

```bash
gcloud compute resource-policies create snapshot-schedule hebdo-ecolemiriam --region=europe-west1 --max-retention-days=30 --start-time=02:00 --weekly-schedule=sunday --on-source-disk-delete=apply-retention-policy
```

```bash
gcloud compute disks add-resource-policies ecolemiriam-prod --zone=europe-west1-b --resource-policies=hebdo-ecolemiriam
```

Activer aussi l'offsite pgBackRest vers Cloudflare R2 : décommenter le bloc
`repo2-*` dans `pgbackrest/pgbackrest.conf` et renseigner les clés R2.

---

## Étape 7 — Suite du déploiement

À partir d'ici, **suivre [DEPLOYMENT-VPS.md](./DEPLOYMENT-VPS.md) à partir de son
étape 2** — rien n'est spécifique à GCP :

| Étape VPS | Commande |
|---|---|
| 2 — Cloudflare (déjà configuré) | `make cf-setup` si reconfiguration |
| 3 — Secrets | `bash docker/scripts/secrets-init.sh` |
| 4 — `.env.production` | `cp .env.example .env.production` puis éditer |
| — Accès GHCR + CI | `bash docker/scripts/setup-vps-ghcr.sh` (voir [DEPLOYMENT-CI.md](./DEPLOYMENT-CI.md)) |
| 5 — Migration Supabase | `bash docker/scripts/migrate-from-supabase.sh` |
| 6 — Démarrage | `cd docker && make up` |
| 7 — Vérification | `make health && make audit` |

⚠️ **Ne jamais builder l'image sur la VM.** `next build` consomme 2 à 4 Go et
saturerait les 8 Go pendant que Postgres tourne. Les images viennent de
`ghcr.io/wilsan007/ecolemiriam-app` via GitHub Actions — c'est déjà le
fonctionnement de `ci-deploy.sh`. Le `make build` local n'est qu'un fallback
de secours.

---

## Checklist finale

- [ ] Projet `ecole-miriam` lié à un compte de facturation
- [ ] Alerte de budget à 100 $/mois créée
- [ ] VM `e2-standard-2` (**pas** `e2-medium`) créée avec 100 Go pd-balanced
- [ ] `default-allow-ssh` et `default-allow-rdp` **supprimées**
- [ ] Règle `allow-ssh-iap` créée (22 depuis `35.235.240.0/20` uniquement)
- [ ] Connexion validée via `--tunnel-through-iap`
- [ ] Swap de 4 Go actif (`free -h`) avec `swappiness=10`
- [ ] Snapshot `avant-hardening` pris
- [ ] `harden-os.sh` lancé **avec `SSH_PORT=22`**
- [ ] Seconde session SSH validée après durcissement
- [ ] Politique de snapshots hebdomadaires attachée au disque
- [ ] Cloud NAT **non activé**
- [ ] `make audit` ≥ 75
- [ ] `curl -f https://app.ecolemiriam.com/api/health` répond

---

## Quand redimensionner

Cette configuration encaisse **1 à 3 écoles, ~3 000 élèves, 150-250 sessions
simultanées**.

Signaux pour passer à `e2-standard-4` (4 vCPU / 16 Go, ~+50 $/mois) :
load average > 2 en continu, ou p95 des pages > 1,5 s pendant les périodes de
génération de bulletins.

Le redimensionnement se fait à froid, sans recréer la VM :

```bash
gcloud compute instances stop ecolemiriam-prod --zone=europe-west1-b && gcloud compute instances set-machine-type ecolemiriam-prod --zone=europe-west1-b --machine-type=e2-standard-4 && gcloud compute instances start ecolemiriam-prod --zone=europe-west1-b
```

Penser alors à remonter `mem_limit` de `postgres` et `shared_buffers` dans
`postgres/postgresql.conf` en conséquence.
