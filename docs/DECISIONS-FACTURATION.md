# Décisions de facturation — arbitrage tranché (27/09/2026)

Les deux implémentations qui coexistaient (`main` d'un côté,
`feat/invitations-facturation-tarifs` de l'autre) sont arbitrées ci-dessous.
Chaque décision retient **la pratique des éditeurs de référence** (PowerSchool,
Veracross, Fedena, Pronote/Index Éducation côté scolaire ; Stripe Billing,
Chargebee côté facturation récurrente) et, quand c'est possible, va plus loin.

Inventaire détaillé des deux implémentations :
[`ARBITRAGE-FACTURATION-TARIFS.md`](ARBITRAGE-FACTURATION-TARIFS.md) (conservé
comme état des lieux).

## 1. Grille tarifaire — moteur de résolution unique et canonique

**Décision.** La résolution tarifaire passe par un seul moteur
(`src/lib/tarifs.ts`) : clé de niveau **canonique** (`1`, `1er`, `1ère`,
`1ère année`, `1ère A` → `an1` ; `Première` → `premiere`) et règle
« tarif du site de l'élève, sinon tarif global », dans l'année scolaire de la
classe. L'UI existante (`TarifsManager`) est conservée : elle saisit la grille,
elle ne la résout pas.

**Pourquoi.** Les éditeurs scolaires indexent la grille sur un **référentiel de
niveaux** (grade level), jamais sur du texte libre : un tarif indexé sur une
chaîne saisie ne survit pas au premier import. Ici, l'ancien
`tarifMap.get(niveau.toLowerCase())` faisait **échouer silencieusement** la
facturation des classes dont le niveau s'écrit autrement — et « 1ère »
(7 000 DJF) pouvait être confondu avec « Première » (15 000 DJF).

**Robustesse ajoutée.** Aucun niveau résolu ⇒ **on ne facture pas**
(`sansTarif`), plutôt que d'appliquer un tarif au hasard.

## 2. Mensualités — génération récurrente idempotente, garantie par la base

**Décision.** Un **cœur unique** (`src/lib/factures/mensualites.ts`) alimente
trois déclencheurs : le cron `GET /api/cron/facturation-mensuelle`
(`CRON_SECRET`, le 1er du mois), le CLI `scripts/generer-mensualites.ts`
(rattrapage d'un mois, aperçu `--dry`), et l'endpoint d'aperçu `?dry=1`.
L'unicité est garantie par un **index unique partiel en base** :
`(tenantId, eleveId, type, mois) WHERE mois IS NOT NULL AND statut <> 'ANNULEE'`.

**Pourquoi.** Stripe Billing, Chargebee & co. génèrent les factures récurrentes
sur ordonnancement avec une **clé d'idempotence** et un aperçu « dry run » ; les
ERP scolaires parlent de « fee run » mensuel rejouable. La différence entre un
moteur amateur et un moteur de production est ici : l'unicité doit être
**atomique** (deux exécutions simultanées), donc portée par la base — pas par un
`if (déjàFacturé)` applicatif qui perd la course.

**Mieux que l'existant.** Trois repères de dédoublonnage sont testés
simultanément : le mois **structuré** (`type=MENSUALITE` + `mois="2025-10"`), et
les **deux conventions de libellé** historiques (« Scolarité Octobre
2025-2026 » et « Scolarité Octobre 2025 »). Un établissement qui a déjà facturé
avec l'ancien format peut donc activer la génération sans créer de doublons. Une
facture **annulée libère le mois** (réémission possible), ce qu'un index unique
plein interdirait.

**Vérifié de bout en bout** (base jetable, grille officielle) :
`10 mensualités, 200 000 DJF` pour une classe de Terminale → seconde exécution
**0 créée**, `factures_mensualites_doublons` vide, et une insertion manuelle de
doublon est **rejetée par la base**
(`duplicate key value violates unique constraint "factures_unicite_mensuelle"`).

**Alignement de l'écran Facturation (29/09/2026).** Le bouton « Générer »
entretenait un **second moteur** dans `src/lib/actions/facturation-avancee.ts`,
resté sur l'ancienne logique : niveaux comparés en chaîne brute (les classes
« 2 » et « 3 » de Campus Central — 191 élèves — ne trouvaient aucun tarif et
étaient ignorées en silence), frais de réinscription additionnés à la
mensualité de septembre (donc un montant différent de celui du cron pour le
même mois) et aucun filtre de site (un comptable mono-site facturait les trois
sites). Les deux actions délèguent désormais au cœur, bornées à
`siteFilterForModel("eleve", …)`. Le second moteur est supprimé : une seule
implémentation, un seul comportement, quel que soit le déclencheur.

**Septembre est un choix explicite (29/09/2026).** Les frais de rentrée
n'entrent dans la mensualité que si l'exploitant les coche (écran Facturation),
passe `?inscription=1` / `?renouvellement=1` au cron, ou `--inscription` /
`--renouvellement` au CLI — et uniquement pour le mois de septembre. Par
défaut, septembre est facturé comme les autres mois : un élève ayant réglé son
inscription à l'admission ne doit pas être facturé deux fois. Le dédoublonnage
interroge désormais aussi l'`INSCRIPTION` du mois (le flux d'admission facture
« Frais d'inscription + Scolarité Septembre » en une seule facture), ce qui
évitait 4 doubles facturations constatées le 29/09/2026.

## 3. Recouvrement / impayés — une seule échelle de relance

**Décision.** On garde l'échelle de relances de `main` (`cron/relances-auto` +
`Facture.relances.niveau`) et on **n'ajoute pas** le second système d'alerte de
la branche (`cron/alerte-impayes`).

**Pourquoi.** Deux moteurs de recouvrement = deux vérités sur le « dernier
niveau de relance envoyé » : le premier qui envoie gagne, le second envoie un
doublon au parent. Les éditeurs gardent **une** échelle échelonnée (rappel →
relance → mise en demeure) avec la trace du dernier palier — c'est exactement ce
que fait `main`.

## 4. Portail famille `/mes-factures` — adopté, avec isolation prouvée

**Décision.** L'écran est adopté (`/mes-factures`, entrée de menu pour
PARENT/STUDENT et rôles finance), et `getFacturesForTenant` borne désormais les
familles par `eleveScopeFilter(user, "eleve")` — `siteFilterForModel` renvoyant
`{}` pour ces rôles, l'isolation ne peut venir que du filtre relationnel
(cf. `AGENTS.md` §14).

**Pourquoi.** Le portail parents (factures, reçus téléchargeables) est un
standard du marché (Pronote « comptes financiers », PowerSchool, Veracross) et
un levier direct sur les impayés : le parent règle ce qu'il voit.

**Robustesse.** Test e2e dédié : deux factures créées en base (une pour l'enfant
du parent de démonstration, une pour un autre élève) ; le parent voit **la
sienne** et **jamais** l'autre. Le filtre est *fail-closed* : sans identité
exploitable, `DENY_ALL`.

## 5. Invitations — on garde `main`

**Décision.** Aucun portage : la version mergée (PR #24/#25) est corrigée
(email vérifié à l'acceptation, lien à usage unique, invitation révocable) et
son garde-fou est testé.

**Pourquoi.** Réintroduire la version de la branche ferait cohabiter deux
implémentations du même objet — la cause exacte de la confusion actuelle.

## 6. Unicité mensuelle en base — migration versionnée et vérifiable

**Décision.** `migration_facture_mensualite_unicite.sql` (idempotent :
`CREATE UNIQUE INDEX IF NOT EXISTS`) est **versionné** et accompagné d'une vue
de contrôle `factures_mensualites_doublons` à consulter **avant** d'activer la
génération. Le fichier est ajouté avec `git add -f` car `.gitignore` exclut
`*.sql` — exception assumée pour une contrainte de schéma.

**Pourquoi.** Une contrainte d'intégrité appartient à la base et doit être
rejouable sans risque. À l'opposé, les éditeurs de facturation ne s'appuient
jamais sur un verrou applicatif seul.

**État vérifié le 27/09 sur la base live** : l'index
`factures_unicite_mensuelle` est **déjà appliqué** (définition identique à ce
fichier — `("tenantId", "eleveId", type, mois) WHERE mois IS NOT NULL AND
statut <> 'ANNULEE'`), sur `389` factures dont `208` mensualités, avec **0
doublon**. La vue de contrôle `factures_mensualites_doublons` a été créée le
27/09 et renvoie 0. Ce fichier reste la référence pour toute base neuve (CI,
restauration, nouvel environnement).

**Piège d'outillage** : `prisma db execute --file` n'exécute que la **première**
instruction du fichier (il a donc appliqué l'index puis ignoré la vue). Utiliser
`psql -f`, ou exécuter les instructions séparément.

## Ce qui est volontairement reporté (et pourquoi)

| Sujet | Décision | Motif |
|---|---|---|
| Bouton « Générer le mois » dans l'écran Facturation | Reporté | Le cron + le CLI couvrent le besoin ; l'UI viendra avec un écran d'aperçu digne de ce nom (leaders : « fee run » avec prévisualisation ligne par ligne). |
| Encaissement au guichet par numéro de facture | Reporté | Utile mais indépendant ; `PaiementParNumero` de la branche n'avait pas de backend sur `main`. |
| Rapport d'ancienneté des impayés (aging) | Reporté | `/facturation` + `relances-auto` couvrent le besoin immédiat. |
| Schéma `Learnos*` de la branche | Refusé dans cette PR | Autre produit, 12 modèles sans rapport avec la facturation. |
| Index unique **plein** via Prisma `@@unique` | Refusé | Interdirait la réémission d'un mois après annulation, cas métier réel. |

## Invariants à ne pas casser

1. Une mensualité = `(tenantId, eleveId, type=MENSUALITE, mois)`, unique en base.
2. Aucune facture sans niveau résolu (pas de tarif « au hasard »).
3. Le tarif du site prime sur le tarif global ; jamais celui d'un autre site.
4. Un parent ne voit que ses enfants (`eleveScopeFilter`), et la liste est vide
   si le périmètre n'est pas calculable.
5. Une seule échelle de relance par facture.
6. Toute écriture de facture est **idempotente** : rejouer ne duplique pas.
7. Une seule implémentation de la génération : le cron, le CLI et l'écran
   passent tous par `src/lib/factures/mensualites.ts`. Toute divergence de
   montant entre deux déclencheurs est un bug, pas une variante.
8. La grille tarifaire est un **référentiel fermé** : `niveau` ∈
   `NIVEAUX_CANONIQUES` (contrainte en base `tarifs_niveau_canonique`), et
   toute création/modification/suppression de tarif écrit une ligne d'audit
   `tarif:create` / `tarif:update` / `tarif:delete` avec l'avant/après. Une
   grille modifiable sans trace rendait impossible la contestation d'une
   facture.
9. La génération est **bornée au périmètre du demandeur** : jamais de facture
   créée sur un site hors du rattachement de l'utilisateur.
