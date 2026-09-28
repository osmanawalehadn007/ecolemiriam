# Incident secret — `.env.bak-20260926070948` (clos le 27/09/2026)

## Ce qui s'est passé

Un fichier `.env.bak-20260926070948` (sauvegarde locale de `.env`) est resté sur
le disque de poste. Il est **ignoré par git** (règle `*.bak-*` de `.gitignore`),
donc jamais suivi par une branche — mais l'extension d'édition (checkpoints
Cline) photographie les fichiers non suivis : le contenu du fichier s'est donc
retrouvé dans la **base d'objets git locale**, atteignable depuis
`refs/cline/checkpoints/*`.

## Diagnostic (mesuré, pas supposé)

| Question | Réponse |
|---|---|
| Le fichier a-t-il été poussé sur GitHub ? | **Non.** Le blob n'était atteignable depuis aucune branche ni aucune ref distante (`refs/heads`, `refs/remotes`). |
| Quel secret contenait-il ? | Le projet Supabase `ndtaedcgwnaopopugiql` (`aws-1-eu-west-2`) : `DATABASE_URL`, `DIRECT_URL`, `AUTH_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_TOKEN`, `GLM_API_KEY`. |
| Est-ce le mot de passe de la base de production **actuelle** ? | **Non.** La production utilise le projet Supabase `hyejtirvtdhxseambzyg` (`aws-0-eu-west-1`, via `.env.production` du VPS). Empreintes SHA-256 comparées : différentes. |
| Rotation de la base de production nécessaire ? | **Non** pour cette fuite-ci. Le mot de passe réellement utilisé en production n'a jamais été committé ni poussé. |

## Remédiation appliquée

1. Suppression du fichier sur disque (fait antérieurement).
2. **Purge de la base d'objets locale** : les 28 checkpoints (`refs/cline/checkpoints/*`)
   dont l'historique contenait le blob ont été supprimés, `git reflog expire
   --expire-unreachable=now --all` puis `git gc --prune=now`. Vérification :
   `git rev-list --all --objects | grep env.bak` → 0, `git cat-file -e <blob>`
   → échec. 37 checkpoints sans rapport conservés.
   *Effet de bord assumé : les points de restauration Cline de ces 28
   conversations ne sont plus disponibles.*
3. Suppression de `backups/.env.bak` (sauvegarde non suivie qui contenait, elle,
   les identifiants du projet **de production** `hyejtirvtdhxseambzyg`, plus une
   clé OpenRouter et `AUTH_SECRET`). Aucune copie versionnée n'existe : le
   fichier n'a jamais été committé.
4. Garde-fou CI durci : `scripts/ci/scan-secrets.mjs` **n'exclut plus `tests/`**
   et détecte désormais les paires « e-mail réel + mot de passe » (y compris la
   forme `process.env.X ?? "mot de passe réel"` et les identifiants passés en
   arguments adjacents d'un appel de connexion). Il refusait 0 fichier, il en
   analyse 776 et a fait tomber 17 occurrences réelles présentes dans `main`.

## À faire côté Supabase (action humaine)

Le projet `ndtaedcgwnaopopugiql` doit être **supprimé** ou ses clés
**révoquées** dans le dashboard Supabase s'il existe encore : la fuite est
localisée, mais le secret a existé en clair sur un poste.

## Autres secrets versionnés : comptes utilisateurs

Indépendamment de ce fichier, **six comptes de production avaient leur mot de
passe dans des fichiers versionnés** (`tests/e2e/*`, `scripts/test-*.ts`,
`scripts/create-comptable.ts`). Le code est nettoyé et le garde-fou CI refuse
désormais ce motif, mais les mots de passe publiés restent valides dans
l'historique git. Risque, décision prise et procédure de rotation :
**[docs/COMPTES-EXPOSES-ROTATION.md](COMPTES-EXPOSES-ROTATION.md)**.

## Hygiène recommandée

- **VPS** : `/opt/ecolemiriam/` contient 11 sauvegardes `.env.production.bak*`
  en clair. Une seule copie est utile ; archiver les autres chiffrées puis les
  supprimer :
  ```bash
  ssh root@169.58.208.217 'cd /opt/ecolemiriam && tar -czf /root/env-backups-$(date +%F).tar.gz .env.production.bak* && chmod 600 /root/env-backups-*.tar.gz && rm -f .env.production.bak*'
  ```
- **Poste de travail** : `.env` local pointe encore la base Supabase de
  production. Préférer une base locale dédiée pour `npm run dev` (le garde-fou
  `playwright.config.ts` refuse déjà les bases distantes pour les tests e2e).
- Ne jamais faire suivre `.env*` par un checkpoint : la règle `*.bak-*` protège
  des commits, pas des instantanés d'outillage.
