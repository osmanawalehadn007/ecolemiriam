# 🔎 Audit du filtrage « périmètre enseignant » — EcolPro

**Date :** 22 septembre 2026
**Statut :** ✅ **tous les écarts identifiés ont été corrigés** (voir § 2), et le **chantier 2** — isolation multi-sites / multi-tenants (§ 5) — est également **clos**. `npx next lint` : `✔ No ESLint warnings or errors`. `npx tsc --noEmit` : 0 erreur.
**Objectif :** recenser **où** la plateforme filtre les données sur le périmètre de l'enseignant connecté (ses classes et ses matières), **où** elle ne le faisait pas, et **comment** chaque cas a été traité.
**Source de vérité du périmètre :** `src/lib/teacher-classes.ts` → `getTeacherScope(tenantId, userId, role)` — classes déduites de l'emploi du temps + rôle de prof principal ; matières déduites des créneaux.

> 📋 **Plan d'exécution :** le détail actionnable de ce qui reste (tâche par tâche,
> fichier par fichier, avec critères de recette) est dans
> **`docs/PLAN_CHANTIERS_RESTANTS.md`**.

> **Deux niveaux de protection à ne jamais confondre**
> 1. **Affichage** (page serveur) : l'enseignant ne *voit* que son périmètre.
> 2. **Garde serveur** (route API) : toute requête hors périmètre est *refusée* (403), même forgée à la main.
>
> Le filtrage d'affichage **seul** ne suffit pas : une route API non protégée reste exploitable (adresse tapée directement, outil type Postman, formulaire modifié).

---

## 1. Modules disposant déjà des deux niveaux de protection

| Module | Fichier(s) | Nature du filtrage |
|---|---|---|
| Cours (LMS) | `src/app/(dashboard)/cours/page.tsx` + `src/components/cours/CoursView.tsx` | Listes **Matière** / **Classe cible** limitées au périmètre — *corrigé* |
| Notes (saisie) | `src/app/(dashboard)/notes/page.tsx` | 3 sélecteurs en cascade limités au périmètre |
| Bulletins | `src/app/(dashboard)/notes/bulletins/page.tsx` | Classes/matières limitées au périmètre |

---

## 2. Écarts identifiés — périmètre enseignant (Web) : TOUS CORRIGÉS

> ⚠️ Ce chapitre couvre le **périmètre enseignant sur le Web**. Les écarts
> **multi-sites / multi-tenants** sont traités au § 5, et ce qui **reste ouvert**
> est inventorié au **§ 6**.

### 🔴 Priorité 1 — écart de confidentialité / sécurité

#### 2.1 ✅ API Notes — garde de périmètre enseignant — **CORRIGÉ**
- **Fichier :** `src/app/api/notes/route.ts` (GET et POST)
- **Écart :** le filtre appliqué était `siteFilterForModel` + `eleveScopeFilter`. Or `eleveScopeFilter` ne couvre que les rôles **PARENT / STUDENT** (lien personnel). Pour un enseignant, `where` restait **non contraint** : en passant un `classeId` (GET) ou un `eleveId` (POST) quelconque du même site, on lisait ou on écrivait des notes d'une classe qui n'est pas la nôtre.
- **Correctif appliqué :**
  - GET → `mergeFilters(…, scopeFilter, await teacherNoteFilter(session.user))` : classe **et** matière bornées au périmètre.
  - POST → garde explicite `resolveTeacherScope` : refus **403** *« Vous ne pouvez saisir des notes que pour vos propres classes »* / *« … que pour les matières que vous enseignez »*.

#### 2.2 ✅ Emploi du temps — grille de l'établissement + mode lecture seule — **CORRIGÉ**
- **Fichiers :** `src/app/(dashboard)/emploi-du-temps/page.tsx`, `src/components/emploi-du-temps/EmploiDuTempsView.tsx`
- **Écart :** `getEmploiData` ne filtrait que par **site**. Un enseignant voyait **toutes** les classes, **tous** les créneaux et **tous** les collègues, dans un éditeur complet (création / suppression / glisser-déposer).
- **Correctif appliqué :**
  1. `getEmploiData` reçoit `scope` + `enseignantId` : `classes` bornées au périmètre, `emplois` / `disponibilites` limités à `enseignantId`, `enseignants` réduit à sa propre fiche.
  2. Nouvelle prop `readOnly` sur `EmploiDuTempsView` : masque **Nouveau créneau / Optimiser (IA) / Supprimer**, désactive le `draggable` et le `onDrop`, et retire le bandeau d'aide au glisser-déposer. Le nettoyage a aussi supprimé deux `console.log` de debug restés dans le composant.

#### 2.3 ✅ Tableau de bord — KPI bornés au périmètre — **CORRIGÉ**
- **Fichier :** `src/app/(dashboard)/dashboard/page.tsx`
- **Écart :** les 5 filtres passés à `getDashboardData` étaient uniquement des filtres de **site** : effectif total de l'établissement, nombre total de classes, absences du jour toutes classes, dernières notes tous élèves, prochain examen tous niveaux.
- **Correctif appliqué :** les fragments `teacherEleveFilter` / `teacherClasseFilter` / `teacherEleveRelationFilter` / `teacherNoteFilter` sont fusionnés avec le filtre de site **avant** l'appel, donc passés en **arguments** de la fonction mémoïsée.
- **⚠️ Point de vigilance cache (respecté) :** `getDashboardData` est enveloppé dans `unstable_cache`. Le périmètre **doit** être un argument (il fait partie de la clé de cache) et non une capture de closure — sinon un enseignant verrait les chiffres mis en cache pour un autre.
- **Note assumée :** `Examen` ne porte pas de classe (c'est une période d'épreuves à l'échelle de l'établissement) : le KPI « prochain examen » reste borné au site, par nature. C'est documenté dans le code.

| Évaluations | `src/app/(dashboard)/evaluations/page.tsx`, `src/app/api/evaluations/route.ts` | Liste + champs limités (page) **et** refus 403 hors périmètre (API GET + POST) |
| Examens | `src/app/(dashboard)/examens/page.tsx`, `src/app/api/examens/route.ts`, `src/app/api/examens/[id]/sessions/route.ts` | Sessions affichées limitées (matières + niveaux) **et** refus 403 à la création d'une session hors périmètre — *corrigé* |
| Absences (consultation) | `src/app/(dashboard)/absences/page.tsx` | Statistiques + liste limitées aux classes de l'enseignant |
| Appel | `src/app/(dashboard)/absences/appel/page.tsx`, `src/app/api/absences/appel/route.ts` | Sélecteur de classes limité **et** refus 403 si la classe n'est pas la sienne — *corrigé* |


### 🟠 Priorité 2 — cohérence fonctionnelle

#### 2.4 ✅ Vie scolaire — incidents bornés — **CORRIGÉ**
- **Fichier :** `src/app/(dashboard)/vie-scolaire/page.tsx`
- **Correctif :** `incidents`, `eleves` et `classes` sont chacun construits par `mergeFilters(filtre de site, périmètre enseignant)` — `teacherEleveRelationFilter` pour les incidents, `teacherEleveFilter` / `teacherClasseFilter` pour les deux autres.

#### 2.5 ✅ Élèves — annuaire borné au périmètre — **CORRIGÉ**
- **Fichier :** `src/app/(dashboard)/eleves/page.tsx`
- **Décision prise :** l'annuaire est **restreint** aux élèves des classes de l'enseignant.
- **Correctif :** `eleveFilter` et `classeSiteFilter` sont fusionnés avec les fragments enseignant **avant** l'appel à `getElevesData` / `getClassesList` → ils font partie des clés `unstable_cache` (même vigilance que § 2.3).

#### 2.6 ✅ Parents — familles bornées — **CORRIGÉ**
- **Fichier :** `src/app/(dashboard)/parents/page.tsx`
- **Correctif :** `teacherParentFilter` ajoute `enfants: { some: { eleve: { classeId: { in: scope.classeIds } } } }` ; le `where` résultant est construit via `mergeFilters` avant l'appel.

#### 2.7 ✅ Orientation — API bornée + garde d'écriture — **CORRIGÉ**
- **Fichier :** `src/app/api/orientation/route.ts`
- **Correctifs :**
  - GET liste → `mergeFilters(filtre de site, teacherEleveFilter)` ;
  - GET `?eleveId=…` → même filtre **et** réponse **404** si l'élève sort du périmètre (fail-closed : sinon le parcours, les notes, les absences et les incidents de l'élève restaient lus depuis un identifiant non vérifié) ;
  - POST → garde **403** *« Vous ne pouvez pas modifier l'orientation d'un élève hors de vos classes »*.

#### 2.8 ✅ API Cours — brouillons des collègues — **CORRIGÉ**
- **Fichier :** `src/app/api/cours/route.ts` (GET)
- **Correctif :** pour un rôle enseignant, `OR: [{ statut: { not: "BROUILLON" } }, { auteurNom: session.user.name }]` est encapsulé dans `AND` **via `mergeFilters`**, pour ne pas écraser le filtre de site par un `OR` de premier niveau (règle n° 2 de `site-scope.ts`).

### 🟡 Priorité 3 — contrôles confirmés et corrigés

#### 2.9 ✅ `api/absences/feuille-presence` — **CORRIGÉ**
- **Fichier :** `src/app/api/absences/feuille-presence/route.ts`
- **Correctif :** `classeId` vient de l'URL → garde `teacherClasseFilter` + `teacherEleveFilter` fusionnés sur la classe **et** sur la liste nominative des élèves.

#### 2.10 ✅ `api/emploi-du-temps/[id]` (DELETE / PATCH) — **COUVERT**
- **Constat :** l'API n'est atteignable que par les rôles disposant de `emploi-du-temps:write|delete`. Or **ni `TEACHER` ni `CLASS_TEACHER` ne possèdent ces permissions** (cf. `ROLE_PERMISSIONS` dans `src/lib/rbac.ts` — les deux rôles n'ont que `emploi-du-temps:read`) : le `checkPermission` en tête de handler suffit donc à bloquer tout enseignant.
- **Défense en profondeur :** l'UI est désormais en `readOnly` (§ 2.2) ; il n'existe plus de chemin d'appel côté enseignant.

#### 2.11 ✅ Routes Bulletins — **CORRIGÉ** (10 routes)
| Route | Garde ajoutée |
|---|---|
| `bulletins/list` | `teacherEleveFilter` fusionné (classe + élève) |
| `bulletins/generer` | `isClasseInTeacherScope` → 403 |
| `bulletins/matrice` | `isClasseInTeacherScope` → 403 |
| `bulletins/annuel` | `isClasseInTeacherScope` → 403 |
| `bulletins/conseil-data` | `isClasseInTeacherScope` → 403 |
| `bulletins/check-existing` | `isClasseInTeacherScope` → 403 |
| `bulletins/export-excel` | `isClasseInTeacherScope` → 403 |
| `bulletins/preview` | `isEleveInTeacherScope` → 403 |
| `bulletins/annuel-preview` | `isEleveInTeacherScope` → 403 |
| `bulletins/conseil` | `isClasseInTeacherScope` + `areElevesInTeacherScope` → 403 |

#### 2.12 ✅ `api/evaluations/[id]/notes` (GET / PUT) — **CORRIGÉ**
- **Fichier :** `src/app/api/evaluations/[id]/notes/route.ts`
- **Correctif :** `resolveTeacherScope` restreint la recherche de l'évaluation à `classeId ∈ scope.classeIds` **et** `matiereId ∈ scope.matiereIds`, en lecture comme en écriture (l'`evaluationId` vient de l'URL).

#### 2.13 ✅ `api/absences/*` (hors appel) — **COUVERT**
- **Constat :** le dossier ne contient que `appel` (déjà protégé) et `feuille-presence` (§ 2.9). Les justifications d'absence passent par les actions serveur, couvertes par `checkPermission("absences:*")` réservé à `CLASS_TEACHER` et aux rôles administratifs.

#### 2.14 ✅ `api/analytics` — **CORRIGÉ** (+ fuite financière fermée)
- **Fichier :** `src/app/api/analytics/route.ts`
- **Correctifs :** les 7 filtres (élève, classe, note, bulletin, absence, incident) sont fusionnés avec le périmètre enseignant ; les 6 requêtes retardées (`allAbsences`, `garcons`/`filles`, `allAbsencesWithEleve`) le sont aussi.
- **⚠️ Écart supplémentaire détecté et fermé :** `analytics:read` est accordé aux enseignants, et la réponse contenait le **chiffre d'affaires** de l'établissement (`revenueData`, 6 derniers mois de paiements). La requête `paiement` est désormais conditionnée à `roleHasPermission(role, "finance:read")` : les enseignants reçoivent un tableau vide.

---

## 3. ✅ Industrialisation réalisée

Plutôt que de répéter le contrôle dans chaque route, tout est centralisé dans `src/lib/teacher-classes.ts`. Ce fichier est désormais le **seul point à auditer** pour le périmètre enseignant.

### Fragments `where` (clé racine `AND` → jamais d'écrasement d'un `OR` de premier niveau)

| Helper | Modèle ciblé |
|---|---|
| `teacherEleveFilter` | `Eleve` (`classeId ∈ classes`) |
| `teacherClasseFilter` | `Classe` (`id ∈ classes`) |
| `teacherMatiereFilter` | `Matiere` (`id ∈ matières`) |
| `teacherEleveRelationFilter` | tout modèle lié à `Eleve` (Absence, Incident, Bulletin…) |
| `teacherNoteFilter` | `Note` (`classeId` **et** `matiereId`) |
| `teacherParentFilter` | `Parent` (famille dont un enfant est dans une de ses classes) |

### Prédicats de garde (identifiant reçu de la requête HTTP)

| Helper | Usage |
|---|---|
| `isClasseInTeacherScope(claims, classeId)` | décider avant d'exécuter (`?classeId=`, corps de requête) |
| `isMatiereInTeacherScope(claims, matiereId)` | idem pour une matière |
| `isEleveInTeacherScope(claims, eleveId)` | idem pour un élève (requête en base) |
| `areElevesInTeacherScope(claims, eleveIds[])` | refus global si **un seul** identifiant sort du périmètre |

### Points de conception

- **`resolveTeacherScope(claims)`** ne lève jamais : identité incomplète ⇒ périmètre non restreint, la restriction de site reste juge.
- **Fail-closed systématique** : un enseignant sans périmètre résolu reçoit une valeur impossible (`__ecolpro_no_teacher_scope__`) ⇒ **aucune donnée**, jamais tout le tenant.
- **Rôles non enseignants** : les helpers renvoient `{}` ou `true` — le RBAC et le filtre de site ne sont jamais affaiblis.
- **Toujours combiné via `mergeFilters`**, jamais par étalement direct.
- **Toujours en plus du filtre de site**, jamais à sa place.

---

## 4. Vérification de ce lot

| Contrôle | Résultat |
|---|---|
| `npx tsc --noEmit` | ✅ **0 erreur** |
| `npx eslint` sur les **23 fichiers** touchés | ✅ **0 erreur / 0 warning** |
| `npx next lint` (projet complet) | ✅ **`✔ No ESLint warnings or errors`** — voir § 5 pour le détail du traitement de la base préexistante. |

Les gardes serveur ajoutées renvoient **403** avec un message métier explicite, repris tel quel dans le Guide de formation.

---

## 5. Chantier 2 — isolation multi-sites / multi-tenants : ✅ CLOS

Les 87 alertes de la base préexistante (35 fichiers) ont été traitées. **`npx next lint` renvoie désormais `✔ No ESLint warnings or errors` sur l'ensemble du projet**, et `npx tsc --noEmit` reste à 0 erreur.

### 5.1 Vulnérabilités réelles corrigées

| Fichier | Écart | Correctif |
|---|---|---|
| `api/import/eleves/route.ts` | **`siteId` du FORMULAIRE non validé** : on pouvait importer des élèves dans un autre site — voire, la clé étrangère `Site` étant globale, dans un site d'un **autre établissement** | Validation contre `resolveSiteScope` + vérification d'appartenance au tenant (403/404) |
| `lib/actions/facture.ts` | `createFacture` : `eleveId` du formulaire, `findUnique({ id })` **sans tenantId** → facture pour un élève d'un autre établissement | `findFirst({ id, tenantId, …siteFilter })` + refus si hors périmètre |
| `lib/actions/facture.ts` | Lectures de factures sans filtre de site (liste, détail, recherche par n°), et **encaissement/annulation** sur une facture d'un autre site | `siteFilterForModel("facture", …)` partout |
| `lib/actions/facturation-avancee.ts` | `deleteTarif` par identifiant sans contrôle ; `genererMensualites` générait des factures pour **tous** les sites ; `exclureEleve`/`leverExclusion` écrivaient sur un élève hors périmètre | Contrôles d'appartenance + filtres de site |
| `api/emploi-du-temps/[id]` (PATCH/DELETE) | Créneau d'un autre site modifiable/supprimable | `siteFilterForModel("emploiTemps", …)` sur les 5 requêtes |
| `api/examens/[id]` (PATCH/DELETE), `…/[id]/deliberation` | Examen d'un autre site modifiable/supprimable | `siteFilterForModel("examen", …)` |
| `api/vie-scolaire/incidents/[id]` (PATCH/POST sanction), `incidents` (POST) | Incident et élève d'un autre site accessibles par identifiant | Filtres de site ajoutés |
| `api/rh/absences/[id]`, `api/rh/conges/[id]` | Compteur d'absences tenant-wide ; écriture `ficheRH` par identifiant sans contrôle ; filtre manuel ignorant `EnseignantSite` | `siteFilterForModel("absencePersonnel"/"congePersonnel"/"ficheRH")` + contrôle d'appartenance |
| `api/rh/[id]` (POST bulletin de paie) | Filtre manuel fragile sur la fiche RH | Filtre canonique `ficheRH` |
| `api/sms/send` | `eleveId` du corps de requête : envoi de SMS aux parents d'un élève d'un autre site | `findFirst` + filtre de site |
| `api/eleves/attestation` + `lib/attestation-generator.ts` | **Document officiel nominatif** émis pour un élève hors périmètre | Nouveau paramètre `siteFilter` alimenté par l'appelant |
| `lib/actions/parametres.ts` | `updateParentPhone`, `deleteParent`, `updateUserPhone`, `assignUserSites` sans filtre de site ; **`getUserSites` sans contrôle du tout** (n'importe quel compte lisait les rattachements d'un tiers) | Filtres + contrôle d'appartenance de l'utilisateur ciblé |
| `lib/notifications/dispatch.ts` | `DeviceToken` lu et purgé **hors tenant** (le modèle porte `tenantId`) | `tenantId` ajouté à la lecture et à la purge |
| `lib/financial-guard.ts` | `exclusionEleve` interrogé **sans `tenantId`** (2 requêtes) → fuite inter-établissements | `tenantId` ajouté |
| `api/emploi-du-temps/auto-generate` | Matières, enseignants et disponibilités non bornés au site de la classe (affectation d'un prof d'un autre site) | 3 filtres ajoutés |
| `api/emploi-du-temps/bulk-apply` | `classeId` du plan sans filtre de site | `siteFilterForModel("classe", …)` |
| `lib/import-eleves-server.ts` | Site cible **remplaçant** le périmètre de session au lieu de le restreindre | `mergeFilters(scope de session, site cible)` |
| `notes/page.tsx`, `notes/bulletins/page.tsx` | Accès direct à une évaluation par identifiant hors périmètre enseignant ; `classeWhere` **sans aucun filtre de site** | `evalScopeFilter` + filtre de site transmis |

### 5.2 Cohérence des données rétablie

- **`facture.create`** dans `facturation-avancee.ts` ne renseignait pas `siteId` : les factures générées étaient « non assignées » et **invisibles** dans les vues filtrées par site. Elles héritent désormais du site de l'élève.
- Les filtres de site sont maintenant **toujours combinés** (jamais substitués) au périmètre enseignant : `mergeFilters(scope de session, restriction supplémentaire)`.
- Deux constructions manuelles de filtre (`{ enseignant: userFilter.user }`) ont été remplacées par les filtres canoniques `siteFilterForModel`, qui empruntent le bon chemin (`EnseignantSite`) — source unique de vérité.

### 5.3 Annotations justifiées (aucune vulnérabilité)

Chaque exception restante est **documentée dans le code** par un commentaire `eslint-disable … -- <raison>` :

- **Aucune session possible** : `lib/auth.ts` (login), `register.ts` (inscription publique), `webhooks/sms|whatsapp` (le numéro de téléphone est le seul discriminant), `lib/tenant-claims.ts` (la lecture *produit* le périmètre — filtrer serait circulaire).
- **Numérotation tenant-wide assumée** : `facture.count({ tenantId })` pour `FAC-<année>-<n>` — seul un **nombre** est lu, aucune donnée d'un autre site n'est exposée.
- **Rôles à périmètre relationnel** (`PARENT`/`STUDENT`, cf. `site-scope.ts`) : le site n'est pas le discriminant — un parent peut avoir des enfants sur plusieurs sites. Concerne `lib/financial-guard.ts` (guarde financière au login) et `eleveParent`.
- **Relations enfants** : un `include` est un enfant d'un parent déjà borné par le `where` (élèves d'une classe filtrée, paiements d'une facture filtrée, bulletins de paie d'une fiche RH filtrée…). Aucun chemin de site propre.
- **Filtres passés en paramètres** : `dashboard/page.tsx`, `rh/page.tsx`, `notes/bulletins/page.tsx` — la règle ne remonte pas jusqu'aux arguments de la fonction ; le commentaire cite explicitement le constructeur du filtre chez l'appelant.

---

## 6. Reste à faire — inventaire vérifié

> 📋 **Plan d'exécution détaillé : `docs/PLAN_CHANTIERS_RESTANTS.md`** — chaque écart
> ci-dessous y est repris sous forme de tâche, avec le helper exact à brancher,
> le critère de recette et l'ordre de traitement.
>
> ✅ **État au 23/09/2026 : les chantiers 3 (mobile), 4 (Web résiduel) et 5
> (tests d'isolation) ont été TRAITÉS.** Le journal d'exécution complet — points
> cochés, fichiers touchés et vérifications — est tenu au **§ 7 du plan**. Les
> tableaux ci-dessous sont conservés comme inventaire d'origine (« ce qui
> manquait »), et non comme état courant.
>
> ⛔ **Un seul point reste bloquant, hors plan :** l'**écart d'enum `Role`** entre
> le schéma Prisma et la base de données (cf. § 6.1). Il empêche d'**exécuter**
> les tests d'isolation tant qu'il n'est pas tranché, et casse l'authentification
> des utilisateurs portant l'un des 5 rôles non déclarés.

Inventaire établi par **scan automatisé** des 103 routes API et 60 pages :
`grep` des 12 helpers de `teacher-classes.ts` (`isTeacherRole`, `resolveTeacherScope`,
`teacherEleveFilter`, `teacherClasseFilter`, `teacherNoteFilter`, `teacherParentFilter`,
`teacherEleveRelationFilter`, `isClasseInTeacherScope`…) sur l'ensemble de `src/app`.

> **Lecture du tableau.** « Site » = la route est déjà protégée contre la fuite
> **inter-établissements et inter-sites**. Ce qui reste à faire est le second
> étage : le **périmètre enseignant** (un prof ne doit pas voir le site entier).

### 🔴 Chantier 3 — Mobile : 12 routes sans périmètre enseignant

C'est **le plus gros écart restant**. Toutes ces routes appliquent le filtre de
site (`eleveScopeFilter` / `siteFilterForModel`) mais **aucune** n'applique le
périmètre enseignant. Un professeur connecté à l'application mobile voit donc
**toutes** les classes, tous les élèves, toutes les notes et absences de son site.

| Route mobile | Exposition |
|---|---|
| `mobile/eleves` + `mobile/eleves/[id]` | Annuaire complet du site |
| `mobile/notes` | Notes de toutes les classes |
| `mobile/absences` | Absences de tous les élèves |
| `mobile/classes`, `mobile/emploi-du-temps` | Toutes les classes, tout le planning |
| `mobile/incidents` | Tous les incidents |
| `mobile/analytics`, `mobile/dashboard` | Agrégats établissement |
| `mobile/appel` (GET + POST) | Appel sur **n'importe quelle** classe du site |
| `mobile/messages`, `mobile/register-device` | Aucun enjeu (périmètre conversationnel / jeton) |

**Correctif :** `verifyMobileScope` renvoie un `MobileScope` (avec `id`, `role`,
`tenantId`) — donc directement compatible avec `resolveTeacherScope(claims)`.
Ajouter un `mergeFilters(filtreExistant, await teacherXFilter(user))` par route,
et une garde sur `mobile/appel`.

### 🟠 Chantier 4 — Pages et routes Web

| # | Cible | Constat | Correctif |
|---|---|---|---|
| 6.1 | `api/eleves` (**GET**) | `eleves:read` est accordé aux enseignants : liste **et export CSV** de tous les élèves du site | `teacherEleveFilter` |
| 6.2 | `eleves/[id]/page.tsx` | Un enseignant ouvre **n'importe quel** élève du site par identifiant (notes, absences, bulletins, parents) | `isEleveInTeacherScope` → `notFound()` |
| 6.3 | `evaluations/[id]/page.tsx` | Filtre de site uniquement → évaluation d'une autre classe accessible par URL | `evalScopeFilter` (déjà utilisé sur `notes/page.tsx`) |
| 6.4 | `api/vie-scolaire/incidents` (GET/POST), `incidents/[id]`, `convocations` | Filtre de site seulement. La **page** est bornée, l'**API** ne l'est pas | `teacherEleveFilter` |
| 6.5 | `api/cours/[id]` (GET/PATCH/DELETE) | Un enseignant peut lire — et modifier — le **brouillon d'un collègue** par identifiant | Contrôle auteur (`auteurNom`/propriétaire) + `teacherMatiereFilter` |
| 6.6 | `api/bulletins/[id]`, `bulletins/publier`, `bulletins/rapport-classe` | Filtre de site seulement (10 autres routes bulletins sont déjà bornées) | `teacherClasseFilter` |
| 6.7 | `api/dashboard/absences-chart` | Graphique calculé sur tout le site | `teacherEleveRelationFilter` |
| 6.8 | `api/ai/appreciation`, `api/ai/chat` | `ai:teacher` : le contexte transmis à l'IA peut concerner un élève hors périmètre | `isEleveInTeacherScope` sur les `eleveId` reçus |
| 6.9 | `api/examens/[id]`, `[id]/deliberation` | Protégés par des permissions d'**écriture** non accordées aux enseignants (`examens:write`) → risque faible, mais à confirmer si la matrice RBAC évolue | Vérification périodique |

### 🟢 Hors périmètre enseignant (rien à faire — contrôle négatif)

Vérifiés et **non accessibles** aux rôles `TEACHER` / `CLASS_TEACHER` d'après la
matrice `ROLE_PERMISSIONS` : `rh/*`, `inventaire/*`, `salles/*`, `admissions/*`,
`alumni/*`, `structures`, `super-admin/*`, `stripe/*`, `factures/*`, `paiements/*`,
`parametres/*`, `audit`, `cron/*`, `webhooks/*`, `health`, `test/*`,
`switch-site`, `switch-tenant`, `rapports`.

### 🔵 Qualité — ✅ traité le 23/09/2026

1. **Tests d'isolation automatisés livrés** — `tests/e2e/isolation.spec.ts`
   (11 scénarios : 5.5 à 5.15 du plan), exécutable par `npm run test:isolation`.
   Les scénarios visent l'**API**, pas l'interface : l'UI masque déjà les liens
   hors périmètre, elle serait donc « verte » même si l'API restait ouverte.
2. **Prérequis de test levés** — `tests/e2e/fixtures.ts` aligné sur le domaine
   `lycee-demo`, identifiants configurables par variables d'environnement
   (`E2E_*`), seed enrichi à **2 sites**, **3 classes** (dont une classe du même
   site hors périmètre, cible qui distingue « périmètre enseignant » de « filtre
   de site ») et **2 enseignants**.
3. **Guide de formation relu** — `docs/FORMATION_ENSEIGNANTS.md` : l'encadré
   d'avertissement sur l'application mobile est remplacé par la mention
   d'alignement (le filtrage mobile est désormais identique au Web).
4. **Reste bloquant (hors plan)** — cf. § 6.1 : l'écart d'enum `Role` empêche
   d'**exécuter** la suite sur la base de développement actuelle.

### ⛔ 6.1 Chantier 6 — écarts de schéma constatés en base (hors plan, bloquant)

Constat établi par lecture directe de la base (`enum_range(null::"Role")`) :

| Écart | Détail | Effet |
|---|---|---|
| **5 rôles présents en base, absents de `prisma/schema.prisma`** | `SUPERVISOR`, `CAISSIER`, `INSPECTOR`, `SUBJECT_LEAD`, `SITE_MANAGER` | Le client Prisma **rejette la désérialisation** de toute ligne `User` portant ces valeurs → `Value 'SUPERVISOR' not found in enum 'Role'`. Concrètement : `prisma.user.findMany()` lève, donc **connexion et lecture des utilisateurs en échec** pour ces comptes (4 `SUPERVISOR` sur l'établissement client, présents aussi dans les tenants de démonstration et de test). |
| **Champ `Classe.siteId` / `Eleve.siteId` non renseigné** (seed historique) | Classes et élèves créés avant l'introduction des sites | Avec un tenant à plusieurs sites, `siteFilterForModel` renvoie `siteId: { in: [...] }` : les enregistrements `null` sont **exclus** (fail-closed) — écran vide, tests impossibles. Corrigé côté seed (les `upsert` réalignent désormais `siteId`). |

**Décision requise (au choix, non prise à ce stade) :**

- **Option A — aligner** : ajouter les 5 valeurs à `enum Role` **et** une entrée à
  `ROLE_PERMISSIONS` (`src/lib/rbac.ts`) pour chacune, puis `ALTER TYPE "Role" ADD
  VALUE` en base. À planifier comme un chantier à part entière : chaque rôle a sa
  matrice de permissions, et `roleHasPermission` renvoie `undefined` pour un rôle
  non déclaré (crash potentiel) — ce n'est pas un « one-liner ».
- **Option B — isoler** : exécuter les tests d'isolation sur une base dédiée
  (tenant `e2e-test`, déjà présent) dont l'enum est aligné sur le schéma, sans
  toucher à la base partagée avec l'établissement client.

**En l'état**, `npm run test:isolation` ne peut pas s'exécuter : la suite est
livrée, typée et lintée, mais son exécution est subordonnée à cette décision.

*Document technique interne — EcolPro.*
