pour l'arbitrage prennez la decison la plus optimal

# Arbitrage facturation / tarifs — `main` vs `feat/invitations-facturation-tarifs`

> État au 27/09/2026. Ce document **ne tranche pas** les questions métier : il
> inventorie les deux implémentations qui coexistent, ce qui est compatible, et
> ce qui doit être décidé avant toute fusion.

## Contexte

- `main` (ace40bf) contient une implémentation **parallèle** de la facturation
  mensuelle, mergée par PR #20/#24/#25.
- La branche `feat/invitations-facturation-tarifs` (978cb69) contient le travail
  complet « invitations + mensualités + impayés + tarifs ». Elle est basée sur
  `81d0bff`, soit **133 commits en arrière** : son diff brut est donc
  inexploitable tel quel (il « supprime » des fichiers qui ont évolué depuis,
  par ex. `src/proxy.ts` → `src/middleware.ts`).
- **Aucune PR n'est ouverte** pour cette branche (la PR #2 mentionnée dans les
  notes est un document de déploiement, déjà mergé : le numéro ne correspond pas
  au travail facturation).

## Ce que `main` possède déjà

| Élément | Emplacement |
|---|---|
| Enum `TypeFacture` (`MENSUALITE`, `INSCRIPTION`, `RENOUVELLEMENT`, `CANTINE`, `TRANSPORT`, `LIBRE`) | `prisma/schema.prisma:1318` |
| `Facture.mois` (`"2025-10"`) + index `[tenantId, mois]` | `prisma/schema.prisma:1351` |
| Grille tarifaire (UI) | `src/components/parametres/TarifsManager.tsx`, `TarifsTab.tsx`, `/parametres/tarifs` |
| Actions facturation (création, paiement, relances) | `src/lib/actions/facture.ts` |
| Cron de relances d'impayés | `src/app/api/cron/relances-auto` |
| Invitations (corrigées, PR #24/#25) | `src/components/parametres/InvitationsPanel.tsx` |

## Ce que la branche apporte en plus

| Apport | Fichiers | Valeur |
|---|---|---|
| Rapprochement classe ↔ grille tarifaire | `src/lib/tarifs.ts` (144 l.) + `tarifs.test.ts` (117 l.) | **Corrige un bug réel** : `"1ère"` (1ère année, 7 000 DJF) et `"Première"` (lycée, 15 000 DJF) étaient confondus ; applique la règle « tarif du site de l'élève, sinon tarif global ». |
| Génération mensuelle automatique | `src/lib/factures/mensualites.ts` (+ tests), `src/app/api/cron/facturation-mensuelle/route.ts`, `scripts/generer-mensualites.ts` | Idempotent (`?dry=1`, `?mois=`, `?tenantId=`), protégé par `CRON_SECRET`. `main` n'a **pas** de génération automatique. |
| Contrainte d'unicité mensuelle en base | `migration_facture_mensualite_unicite.sql` | Empêche deux factures identiques pour un même élève/mois. Non présent sur `main`. |
| Portail « Mes factures » (parent/élève) | `src/app/(dashboard)/mes-factures/page.tsx` | `main` ne l'a pas. |
| Paiement par numéro de facture, recherche d'élève | `src/components/facturation/PaiementParNumero.tsx`, `StudentSearch.tsx` (+ tests) | Accélère l'encaissement au guichet. |
| Graines et outils tarifs | `prisma/seed-tarifs.ts`, `scripts/audit-tarifs.ts` | Utile pour installer la grille. |
| Hors périmètre facturation | `prisma/schema.prisma` (+441 l. : `Invitation`, suite `Learnos*`), `AnneesScolairesTab.tsx`, `prisma/normaliser-classes.ts` | À sortir dans des PR séparées. |

## Questions à trancher (métier)

1. **Grille tarifaire** : on garde `TarifsManager`/`TarifsTab` de `main` et on y
   branche la logique de `src/lib/tarifs.ts` (recommandé : la logique est testée
   et corrige un bug), ou on remplace l'écran par celui de la branche ?
2. **Mensualités** : génération par cron (`/api/cron/facturation-mensuelle`),
   par action manuelle dans l'écran Facturation, ou les deux (cron + bouton
   « générer le mois » avec `?dry=1` pour prévisualiser) ?
3. **Impayés** : `main` relance déjà via `/api/cron/relances-auto`. La branche
   ajoute des vues d'impayés et le paiement par numéro. Fusionner ou choisir ?
4. **Portail parent/élève** (`/mes-factures`) : à intégrer ? Il touche aux règles
   d'isolation (`eleveScopeFilter` obligatoire pour PARENT/STUDENT, cf.
   `AGENTS.md` §14) — une revue dédiée est nécessaire.
5. **Invitations** : `main` est la version de référence (mergée, corrigée,
   `emailVerified` posé à l'acceptation). Ne pas réintroduire la version de la
   branche.
6. **Unicité mensuelle en base** : appliquer
   `migration_facture_mensualite_unicite.sql` sur la base de production (à faire
   via le rôle owner, `DIRECT_URL`) — impact direct sur les données existantes,
   donc à valider sur un dump avant.

## Procédure conseillée (une fois les décisions prises)

1. Créer une branche neuve depuis `main` : `git checkout main && git checkout -b
   feat/mensualites-impayes`.
2. Y porter **uniquement** les fichiers retenus avec
   `git checkout feat/invitations-facturation-tarifs -- <chemin>` (port ciblé),
   puis adapter les imports (`src/proxy.ts` → `src/middleware.ts`, client RLS
   vs `prismaBase` selon le contexte, `TypeFacture` déjà présent sur `main`).
3. Ouvrir une PR **par thème** (tarifs, mensualités, portail parent) : la
   branche actuelle mélange 26 500 lignes, elle n'est pas reviewable en l'état.
4. Ne pas rebaser la branche historique : la conserver comme archive
   (`feat/invitations-facturation-tarifs` reste disponible).
