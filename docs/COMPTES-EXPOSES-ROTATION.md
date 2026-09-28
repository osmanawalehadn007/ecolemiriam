# Comptes exposés — mots de passe versionnés (constat du 27/09/2026)

> **Décision du 27/09/2026 : aucune rotation en production pour l'instant.**
> Ce document consigne le risque mesuré et la procédure prête à exécuter, pour
> que le changement de mot de passe reste un geste simple et tracé le jour où il
> sera décidé (départ d'un collaborateur, changement de visibilité du dépôt,
> doute sur un compte…).

## Ce qui a été constaté

Le mot de passe de **six comptes réels de production** a été écrit en clair dans
des fichiers **versionnés** de ce dépôt :

| Fichier (dans `main`) | Forme |
|---|---|
| `tests/e2e/fixtures.ts` | `process.env.TEST_TEACHER_PASSWORD ?? "…"` |
| `tests/e2e/rls-fix.spec.ts` | `login(page, "…", "…")` (arguments adjacents) |
| `tests/e2e/import-enseignants.spec.ts` | `const ADMIN_PASSWORD = "…"` |
| `scripts/test-create-user.ts`, `test-import-enseignants.ts`, `test-inference.ts`, `test-messy-import.ts` | `const TEST_PASSWORD = "…"` |
| `scripts/create-comptable.ts` | `bcrypt.hash("…", 10)` |

Comptes concernés (état vérifié le 27/09, base **live** = Supabase) :

| Compte | Rôle | Dernière connexion | 2FA | Présent en base live |
|---|---|---|---|---|
| `ilyasadendjama@gmail.com` | TENANT_ADMIN | 26/09/2026 | non | oui |
| `ahdimounomar@gmail.com` | TENANT_ADMIN | 27/09/2026 | non | oui |
| `mohamed.abdi.pk12@gmail.com` | TENANT_ADMIN | 27/09/2026 | non | oui |
| `dya.adine@miriam.dj` | COUNSELOR | 29/08/2026 | non | oui |
| `awaleh.osman.adn@gmail.com` | (enseignant) | — | non | **non** (base vestige uniquement) |
| `zdouce.zz@gmail.com` | (enseignant) | — | non | **non** (base vestige uniquement) |

Les deux derniers sont **absents des deux bases** (comptes supprimés ou jamais
créés) : aucune action ne les concerne. Le script de rotation les signale de
lui-même et n'agit que sur les comptes réellement présents.

## Pourquoi la CI ne l'a pas vu

`scripts/ci/scan-secrets.mjs` excluait entièrement `tests/` et ne cherchait que
des secrets de fournisseurs (clés Stripe, Resend, JWT…). Ni une paire
« e-mail + mot de passe », ni un littéral passé à `bcrypt.hash()` n'étaient
détectés. **Les deux trous sont bouchés** (commit `413bc88` puis durcissement
`bcrypt.hash`) : le garde-fou signale désormais 20 occurrences sur l’ancien
`main` et refuse toute récidive, y compris dans `tests/` et `scripts/`.

## Évaluation du risque (pourquoi « pas d'urgence » aujourd'hui)

- Le dépôt est **privé** (`gh repo view wilsan007/EcolPro` → `isPrivate: true`) :
  les valeurs ne sont pas indexées publiquement.
- Elles sont en revanche lisibles par **tout ce qui a un accès en lecture au
  dépôt** : collaborateurs, sessions d'agents IA, journaux de CI, clones et
  sauvegardes locales, et tout jeton de lecture ayant existé.
- Trois des comptes exposés sont **administrateurs de l'établissement** et
  aucun n'a de 2FA.
- Retirer les fichiers ne suffit pas : les valeurs restent dans l'**historique
  git**. La seule remédiation réelle est le **changement de mot de passe**.

## Procédure de rotation (à exécuter quand vous le décidez)

### Étape 0 — diagnostic (lecture seule, aucun effet)

```bash
export DIRECT_URL="$(grep '^DIRECT_URL=' .env | cut -d= -f2- | tr -d '\"')"
npx tsx scripts/rotater-mots-de-passe-exposes.ts
```
Le script affiche la base visée, les comptes trouvés (rôle, état, 2FA) et ce
qu'il ferait — sans rien modifier.

### Étape 1 — choisir la méthode

| Méthode | Effet | Usage |
|---|---|---|
| **A. Rotation + mot de passe temporaire** | `--apply` : un mot de passe fort est généré par compte, l'ancien cesse de fonctionner, `mustChangePassword = true` exige un changement à la reconnexion. Le script affiche les mots de passe à transmettre. | Recommandé : immédiat, sans dépendance à l'email |
| **B. Rotation + email de réinitialisation** | Rotation (comme A) puis, pour chaque personne, laisser utiliser « Mot de passe oublié » sur `/forgot-password` (Resend est configuré en production). Attention : l'API limite à **3 demandes / 5 min par IP**. | Plus fluide pour les utilisateurs |
| **C. Changement forcé seul** | `mustChangePassword = true` sans changer le mot de passe. | À éviter : l'ancien mot de passe reste valide une fois |

Application de la méthode A :

```bash
npx tsx scripts/rotater-mots-de-passe-exposes.ts --apply
```

### Étape 2 — couper les sessions en cours (si nécessaire)

Un changement de mot de passe **n'invalide pas les sessions déjà ouvertes** :
la session est un JWT (durée par défaut 30 jours chez Auth.js). Si un compte est
suspecté d'être utilisé par un tiers :

```bash
./docker/scripts/secrets-rotate.sh   # régénère AUTH_SECRET (+ mots de passe Postgres)
```
⚠️ Cela déconnecte **tout le monde** (et fait ~10 s de coupure) : à réserver au
cas suspecté compromis.

### Étape 3 — vérifier

```bash
npx tsx scripts/rotater-mots-de-passe-exposes.ts   # doit afficher « changement déjà exigé »
```
Puis : une connexion avec l'ancien mot de passe doit **échouer** (à tester avec
un compte neutre), et la connexion avec le mot de passe temporaire doit mener à
`/change-password`.

## Mesures complémentaires recommandées

1. **Activer la 2FA** pour les comptes `TENANT_ADMIN` (aucun n'en a aujourd'hui).
2. Ne plus jamais réutiliser un compte réel dans un test : les tests lisent
   `TEST_*` (voir `.env.example`), les comptes de la seed servent de valeurs par
   défaut.
3. Ne pas coller d'identifiants dans une conversation, un ticket ou un journal
   de CI — c'est ainsi que le mot de passe s'est retrouvé dans le dépôt.
4. Si le dépôt devient public un jour : rotation **immédiate** des six comptes,
   sans attendre.
