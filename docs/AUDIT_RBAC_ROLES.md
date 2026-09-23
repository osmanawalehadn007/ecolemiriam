# Audit RBAC — Rôles & permissions (pages, modules, actions, modales)

> **Question posée** : « Vérifier si les rôles ont des permissions sur certaines
> actions / pages / modules / modales qu'ils ne devraient pas avoir. »
>
> **Réponse courte** : **oui, et à trois niveaux.**
> 1. La source de vérité `ROLE_PERMISSIONS` (`src/lib/rbac.ts`) accorde au moins
>    **une permission d'écriture par erreur** (`STUDENT` → `cours:*`).
> 2. **32 pages sur 40** du dashboard n'appliquent **aucune** garde RBAC :
>    elles sont accessibles par URL à tout compte authentifié (dont `PARENT` et
>    `STUDENT`), alors que leur menu n'est filtré que par une liste de rôles
>    codée en dur dans la `Sidebar`.
> 3. **19 routes d'API** (dont des écritures et des documents officiels) ne
>    vérifient **que** l'authentification, jamais la permission. Pour un compte
>    `PARENT` / `STUDENT`, le filtre de site est **neutre**
>    (`site-scope.ts` → `RELATION` ⇒ `{}`), donc le périmètre tombe.

Date : 23/09/2026 — commit audité : `81d0bff` — branche `main`.
Périmètre : `src/app/(dashboard)`, `src/app/api`, `src/components`,
`src/lib/{rbac,site-scope,teacher-classes,guard-page}.ts`.

> **État d'application — 23/09/2026 (soir).** Les correctifs **P0** du § 8 sont
> **appliqués** dans la copie de travail (non encore commités) :
>
> - **C1** — `STUDENT` ne porte plus que `cours:read` (`src/lib/rbac.ts`) ;
> - les **8 routes de mutation** du § 5.1 portent désormais une garde (détail et
>   preuve au § 8.1) ;
> - **permissions dédiées** (§ 8.2) : `notes:manage` (périodes + règles
>   d'appréciation) et `etablissement:write` (mentions officielles) ; les
>   contrôles de rôle inline sont remplacés par `checkPermission`, donc **les
>   refus sont journalisés** ;
> - trois suites de non-régression : `src/lib/rbac.test.ts` (13 cas),
>   `src/lib/parametres-tabs.test.ts` (6 cas) et
>   `src/app/api/rbac-mutations.test.ts` (21 cas) — **40/40 verts** ;
>
> **P1 appliqué également** (§ 8, section « P1 — pages ») :
>
> - `guardPage` sur les **25 pages** qui n'en avaient pas (codemod
>   `scripts/patch-guard-page.ts`), gardes de rôle sur `/test-telegram`,
>   `/test-whatsapp` et `/parametres/audit` (`guardRoles`), écrans de personnel
>   via `guardStaff` (`/notes`, `/notes/bulletins`, `/absences`,
>   `/absences/appel`) ;
> - `/parametres` → **onglets dérivés des permissions** (`lib/parametres-tabs.ts`) ;
> - **11 lectures nominatives** du § 5.2 durcies (`eleveScopeFilter` + permission
>   de module, `finance:read`, `finance:write`, `eleves:write`) ;
> - **§ 8.3** : les 5 points de vigilance soldés (onglets, documents financiers
>   des familles, artefacts de classe, écrans de personnel, notes récentes).
>
> **Arbitrages métier (§ 8bis)** : **A1**, **B1** et **D1** sont tranchés et
> appliqués ; **C1** est acté (aucun changement de code).
>
> **Contrôles** : `vitest run` → **269/269** sur 16 fichiers (les 6 échecs
> préexistants sont réparés : mocks `ficheRH.*` / `eleve.*`, et les 13 modèles
> `learnos*` déclarés dans `SITE_PATHS`) ; `tsc --noEmit` → exit 0 ;
> `next lint` (projet entier) → 0 erreur.
>
> **Reste ouvert** : les modales rendues sans condition de rôle (UI1) et la
> dérivation du menu depuis la matrice (UI2/§ 8 P2), ainsi que la correction du
> § 3.2 de `PLAN_CHANTIERS_RESTANTS.md` (déjà réécrit, cf. § 10).

---

## 1. Comment le contrôle d'accès est censé fonctionner

| Couche | Mécanisme | Appliqué où |
|---|---|---|
| Middleware | `src/middleware.ts` — authentification seule (aucun rôle) | toutes les routes |
| API | `checkPermission(role, "module:action")` / `authorize()` | 72 routes sur 110 |
| Pages (Server Components) | `guardPage(session, "module:action")` | **8 pages sur 40** |
| Périmètre | `siteFilterForModel()` + `personalScopeFilter()` | dépend de l'appelant |
| UI | filtrage `roles: [...]` codé en dur dans `Sidebar.tsx` | menu uniquement |

Deux listes de rôles coexistent donc et **divergent** :
`ROLE_PERMISSIONS` (permissions) et `navGroups[].roles` (`Sidebar.tsx:54-110`).
Aucune des deux n'est dérivée de l'autre.

---

## 2. Synthèse

| # | Sévérité | Constat | Impact |
|---|---|---|---|
| C1 | 🔴 Critique | `STUDENT: "cours:*"` → `cours:write` + `cours:delete` accordés | un élève crée / modifie / supprime des cours |
| C2 | 🔴 Critique | `POST /api/eleves/generer-comptes` sans RBAC | un `PARENT`/`STUDENT` crée des comptes élèves et **reçoit les mots de passe en clair** → prise de contrôle de tous les comptes élèves du tenant |
| C3 | 🔴 Critique | `PUT /api/parametres/signature-cachet` sans RBAC | n'importe quel rôle réécrit la signature, le cachet et le nom du chef d'établissement sur les documents officiels |
| E1 | 🟠 Élevée | 32 pages sans `guardPage` | annuaire élèves, parents, notes, examens, paramètres accessibles à tout rôle par URL |
| E2 | 🟠 Élevée | `POST /api/eleves/changer-classe`, `/api/eleves/dispenses` (POST+DELETE) sans RBAC | déplacement d'élèves et suppression de dispenses par tout rôle |
| E3 | 🟠 Élevée | `PUT /api/parametres/periodes-cloture`, `/api/parametres/regles-appreciation` (POST/PUT/DELETE) sans RBAC | ouverture/clôture des périodes de notes et règles d'appréciation modifiables par tout rôle |
| E4 | 🟠 Élevée | `POST /api/vie-scolaire/convocations` sans RBAC | tout rôle génère une convocation officielle signée du directeur |
| E5 | 🟠 Élevée | Lectures sans RBAC ni périmètre personnel : `bulletins/matrice`, `bulletins/check-existing`, `bulletins/rapport-classe`, `eleves/cartes-scolaires`, `absences/feuille-presence` | `PARENT`/`STUDENT` lit notes, moyennes, rangs, décisions et listes nominatives de **n'importe quelle classe** |
| E6 | 🟠 Élevée | `PARENT: "messages:*"` (donc `messages:write`) + `GET/POST /api/messages/audience` | un parent peut diffuser vers les groupes autorisés (`PARENTS`) — à confirmer côté métier |
| M1 | 🟡 Moyenne | `CLASS_TEACHER: "bulletins:publish"` | un professeur principal publie les bulletins de l'établissement |
| M2 | 🟡 Moyenne | `NURSE` a `messages:read` + `messages:write` mais **pas** `messages:reply` | l'infirmier crée une conversation puis reçoit 403 pour y répondre (incohérence) |
| M3 | 🟡 Moyenne | `GET /api/test/setup-links`, pages `/test-telegram`, `/test-whatsapp` | routes/pages de développement exposées en production |
| M4 | 🟡 Moyenne | `GET /api/health`, `factures/[id]/pdf`, `paiements/[id]/recu`, `stripe/checkout` sans RBAC | documents financiers atteignables par tout rôle (site/facture vérifiés, rôle non) |
| UI1 | 🟡 Moyenne | Modales d'action rendues sans condition de rôle (`CoursView`, `InventaireView`, `AlumniView`, `RHView`, `ExamensManager`, `VieScolaireView`, `CommunicationView`, `FacturationActions`) | les rôles en lecture seule voient les boutons/modales de création, modification, suppression (le serveur répond 403) |
| UI2 | 🟡 Moyenne | `Sidebar.tsx` affiche les entrées sans `roles` **à tout le monde**, dont `/eleves`, `/notes`, `/evaluations`, `/cours`, `/emploi-du-temps`, `/absences`, `/messages` et **`/parametres`** | `PARENT`/`STUDENT` voient les modules administratifs dans le menu |
| D1 | 📄 Doc | `docs/PLAN_CHANTIERS_RESTANTS.md` § 3.2 affirme « `parametres/*`, `factures/*`, `paiements/*`, `test/*` : rien à faire (vérifié) » | **inexact** : ces routes ne portent aucun contrôle RBAC (cf. C3, E3, M3, M4) |
---

## 3. Détail des constats critiques

### C1 — `STUDENT` peut écrire et supprimer des cours

`src/lib/rbac.ts:106-110`

```ts
  STUDENT: [
    "bulletins:read", "absences:read", "notes:read",
    "messages:read", "messages:reply",
    "communication:read", "cours:*", "emploi-du-temps:read",
  ],
```

`roleHasPermission` (`rbac.ts:116-123`) résout `cours:*` pour **toute** action du
module, donc `cours:write` et `cours:delete`. Or :

- `POST /api/cours` exige `cours:write` (`src/app/api/cours/route.ts:81`) ;
- `PATCH/DELETE /api/cours/[id]` exigent `cours:write` / `cours:delete`
  (`src/app/api/cours/[id]/route.ts:62` et `:110`).

⇒ un élève peut créer, modifier et supprimer n'importe quel cours publié de son
périmètre de site. Aucun contrôle de rôle complémentaire n'existe dans ces
routes. Pour comparaison, `PARENT` n'a que `cours:read` (`rbac.ts:99`) :
l'intention pour `STUDENT` était manifestement `cours:read`.

### C2 — Création de comptes élèves + divulgation des mots de passe

`src/app/api/eleves/generer-comptes/route.ts:8-12` — seule garde :

```ts
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
```

La route crée des `User` (rôle `STUDENT`) pour les élèves d'une classe et
renvoie `accounts[].password` **en clair** (`:59-87`). Le filtre appliqué est
`siteFilterForModel("eleve", session.user)` (`:26`), qui renvoie `{}` pour les
rôles à périmètre relationnel (`src/lib/site-scope.ts:430-434`) :

```ts
  switch (scope.kind) {
    case "ALL":
    case "RELATION":
      return {};
```

Un compte `PARENT` ou `STUDENT` (qui a bien un `tenantId`) peut donc générer les
comptes de **tous** les élèves du tenant et lire leurs mots de passe, puis se
connecter avec eux. C'est la faille la plus grave de l'audit.

### C3 — Réécriture des mentions officielles de l'établissement

`src/app/api/parametres/signature-cachet/route.ts:5-24` — aucune permission :

```ts
export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.tenantId) { /* 401 */ }
  const { chefEtablissement, signatureUrl, cachetUrl } = await req.json();
  const tenant = await prisma.tenant.update({
    where: { id: session.user.tenantId },
    data: { chefEtablissement, signatureUrl, cachetUrl },
  });
```

Ces trois champs alimentent les bulletins, attestations et convocations
(`src/lib/attestation-generator.ts`, `api/eleves/attestation`, …). Tout rôle
authentifié peut donc modifier l'identité signataire et le visuel du cachet.

---
## 4. Pages sans garde RBAC (32 / 40)

`guardPage` n'est présent que sur : `admissions`, `analytics`, `communication`,
`facturation`, `inventaire`, `rapports`, `rh`, `vie-scolaire`.

| Page | Garde RBAC | Données servies | Rôles indûment admis |
|---|---|---|---|
| `/eleves`, `/eleves/[id]`, `/eleves/nouveau`, `/eleves/[id]/modifier` | ❌ | annuaire complet (nom, matricule, classe, tuteur + téléphone) | `PARENT`, `STUDENT` (aucun `personalScopeFilter` ; `baseEleveWhere` ne fait qu'exclure les `EXCLU` pour `PARENT`, `eleves/page.tsx:31-44`) |
| `/parents` | ❌ | annuaire des parents | `PARENT`, `STUDENT` |
| `/notes`, `/notes/bulletins` | ❌ | notes / bulletins | `PARENT`, `STUDENT` |
| `/evaluations`, `/evaluations/[id]` | ❌ | évaluations + notes | `PARENT`, `STUDENT` |
| `/examens`, `/examens/rapport-classe` | ❌ | examens, sessions, délibérations | `PARENT`, `STUDENT` |
| `/cours` | ❌ | cours (y compris brouillons) | `PARENT`, `STUDENT` (+ écriture via C1) |
| `/emploi-du-temps` | ❌ | créneaux | `PARENT`, `STUDENT` |
| `/absences`, `/absences/appel` | ❌ | absences / appel | `PARENT`, `STUDENT` |
| `/messages` | ❌ | messagerie | conforme (`messages:*` / `messages:read`) |
| `/orientation` | ❌ | orientation | `PARENT`, `STUDENT`, `TEACHER` |
| `/alumni` | ❌ | anciens élèves | `PARENT`, `STUDENT`, `TEACHER` |
| `/parametres` (tous les onglets) | ❌ (seul `canManage` masque les boutons) | établissement, utilisateurs, parents, élèves, classes, matières, sites, années | `PARENT`, `STUDENT`, `TEACHER`, `NURSE`… |
| `/facturation/nouvelle`, `/facturation/[id]` | ❌ | factures | `PARENT`, `STUDENT`, `TEACHER` |
| `/vie-scolaire/convocations` | ❌ | convocations | `PARENT`, `STUDENT` |
| `/test-telegram`, `/test-whatsapp` | ❌ | pages de test | tous |
| `/dashboard` | ❌ (volontaire) | tableau de bord | — |

Le menu ne protège pas : `Sidebar.tsx:144-148` n'applique `roles` qu'aux entrées
qui en déclarent ; les autres (dont `/eleves`, `/notes`, `/evaluations`,
`/cours`, `/emploi-du-temps`, `/absences`, `/messages`) sont **visibles de
tous**, et le lien `/parametres` (`Sidebar.tsx:330-339`) est en dehors du
filtrage.

> Pour réconcilier le compte `32 / 40` : les pages sans `guardPage` mais soit
> sans données sensibles, soit protégées autrement sont `acces-bloque`,
> `dashboard` et `offline` (neutres), `parametres/audit` et `super-admin`
> (contrôle de rôle inline), et les sous-pages d'action
> `eleves/attestations`, `eleves/cartes`, `eleves/comptes`, `eleves/transfert`
> (aucune garde — elles héritent du problème de `/eleves`).

---

## 5. Routes d'API sans contrôle de permission

Extraction complète (`110` fichiers `route.ts`) : `72` portent un contrôle de
permission ou de rôle explicite, `38` n'en portent aucun.

### 5.1 Mutations sans RBAC (actionnables par tout compte authentifié)

| Route | Méthodes | Garde réelle | Risque |
|---|---|---|---|
| `api/eleves/generer-comptes` | POST | auth + site (neutre en `RELATION`) | **C2** |
| `api/eleves/changer-classe` | POST | auth + site | déplacement d'élèves en masse |
| `api/eleves/dispenses` | POST, DELETE | auth + site | création/suppression de dispenses (le `DELETE` ne filtre même pas par site) |
| `api/parametres/signature-cachet` | PUT | auth | **C3** |
| `api/parametres/periodes-cloture` | PUT | auth | ouverture/clôture des périodes de notes |
| `api/parametres/regles-appreciation` | POST, PUT, DELETE | auth | règles d'appréciation de l'établissement |
| `api/vie-scolaire/convocations` | POST | auth + `isEleveInTeacherScope` (neutre hors enseignant) | convocation officielle |
| `api/test/setup-links` | GET | auth | route de dev : crée un parent et le lie aux élèves |
| `api/structures` | POST, DELETE | `role === TENANT_ADMIN \|\| SUPER_ADMIN` ✔ | conforme |

### 5.2 Lectures sans RBAC (données nominatives / scolaires / financières)

| Route | Données | Filtre présent | Filtre manquant |
|---|---|---|---|
| `api/bulletins/matrice` | notes, moyennes, rangs, décisions, par classe | site (neutre en `RELATION`) + périmètre prof | périmètre personnel parent/élève |
| `api/bulletins/check-existing` | existence/publication de bulletins | site + périmètre prof | idem |
| `api/bulletins/rapport-classe` | synthèse nominative de classe | site + périmètre prof | idem |
| `api/absences/feuille-presence` | liste nominative d'une classe | site + périmètre prof | idem |
| `api/eleves/cartes-scolaires` | photos, dates de naissance, matricules | site | périmètre personnel |
| `api/eleves/attestation` | identité + scolarité d'un élève | site | périmètre personnel |
| `api/dashboard/absences-chart` | absences du tenant | site + périmètre prof | périmètre personnel |
| `api/factures/[id]/pdf` | facture + données du tuteur | tenant + site | permission `finance:read` |
| `api/paiements/[id]/recu` | reçu + données du tuteur | tenant + site | permission `finance:read` |
| `api/stripe/checkout` | facture | tenant + site | permission `finance:*` |
| `api/eleves/upload-photo` | convertit une image en data-URL | auth + rate-limit | permission `eleves:write` |

> Motif commun : `isClasseInTeacherScope` / `isEleveInTeacherScope` renvoient
> **`true` pour tout rôle non enseignant** (`src/lib/teacher-classes.ts:303-305`
> et `:313`). Ces helpers ne remplacent donc pas une garde RBAC : combinés à
> un filtre de site neutre en `RELATION`, ils laissent passer `PARENT`/`STUDENT`.

### 5.3 Hors périmètre / légitimes

`api/auth/*`, `api/auth/mobile`, `api/cron/*` (Bearer `CRON_SECRET`),
`api/webhooks/*` (signature), `api/health`, `api/switch-tenant` (preuve
d'adhésion `UserTenant`), `api/super-admin/*` (`role === "SUPER_ADMIN"`),
`api/import/eleves/*` (`TENANT_ADMIN`/`SUPER_ADMIN`),
`api/mobile/*` (jeton + `verifyMobileScope`, périmètre personnel correct via
`eleveScopeFilter`).

---
## 6. Modales et actions exposées sans condition de rôle

Aucune vue d'action ne reçoit son rôle en propriété : seul `ParametresTabs`
(`canManage`) et `MessagerieView` (`userRole`) en reçoivent un.

| Composant | Modales / boutons rendus en dur | Rôle en lecture seule qui les voit |
|---|---|---|
| `components/cours/CoursView.tsx:708-723,798` | `CreerCoursModal`, `AjouterContenuModal` | `PARENT`, `SECRETARY`… (**et `STUDENT` peut réellement écrire — C1**) |
| `components/inventaire/InventaireView.tsx:162-175,282,303` | création / édition / alerte | `SECRETARY` (`inventaire:read`) |
| `components/alumni/AlumniView.tsx:150,224-236` | `openCreate`, `openEdit`, modale | `SECRETARY` (`alumni:read`) |
| `components/rh/RHView.tsx` + `PersonnelAbsencesConges.tsx:79-80` | formulaires absence/congé, génération paie | `PRINCIPAL` (`rh:read`) |
| `components/examens/ExamensManager.tsx:656-700` | `CreateExamenModal`, `AddSessionModal` | `SECRETARY` (`examens:read`) |
| `components/vie-scolaire/VieScolaireView.tsx:424-453` | `CreateIncidentModal` | rôle non-écrivain |
| `components/communication/CommunicationView.tsx:433,502` | `ComposeModal` | `COUNSELOR` (`communication:read`) |
| `components/facturation/FacturationActions.tsx:47-53,151-169` | génération, paiement, retard, exclusion | `PRINCIPAL` (`finance:read`) |
| `components/bulletins/BulletinsList.tsx:192` | `BulletinEditorModal` | `TEACHER` (`bulletins:read`) |
| `components/eleves/*` (`TransfertClasseForm`, `DispenseMatiereManager`, `GenerationComptesForm`, `ElevesActions`) | formulaires de mutation | `PARENT`, `STUDENT` |

Le serveur refuse (403) pour la plupart, mais : (a) l'interface ment sur les
droits, (b) `PARENT`/`STUDENT` peuvent **ouvrir** ces écrans faute de garde de
page, et (c) pour `cours` et pour les routes du § 5.1, le serveur **accepte**.

---

## 7. Anomalies de la matrice `ROLE_PERMISSIONS` (`src/lib/rbac.ts`)

| Ligne | Rôle | Permission | Verdict |
|---|---|---|---|
| 109 | `STUDENT` | `cours:*` | ❌ trop large → `cours:read` |
| 87 | `NURSE` | `messages:read`, `messages:write` | ❌ incohérent → ajouter `messages:reply` (ou retirer `messages:write`) |
| 73 | `CLASS_TEACHER` | `bulletins:publish` | ⚠️ à confirmer : publier les bulletins est habituellement une action de direction |
| 92 | `ACCOUNTANT` | `rh:*` | ⚠️ à confirmer : RH en écriture pour un comptable |
| 55 | `SECRETARY` | `eleves:*` (dont `delete`) | ⚠️ à confirmer : suppression d'élèves par le secrétariat |
| 63-67 | `TEACHER` | `absences:write` | ✔ cohérent (appel) |
| 35-41 | `TENANT_ADMIN` | `finance:*`, `rh:*`, `audit:read` | ✔ cohérent |
| 44-51 | `PRINCIPAL` | `finance:read`, `rh:read` (pas d'écriture) | ✔ conforme au commentaire — mais `RHView`/`FacturationActions` ne le reflètent pas (UI1) |

Écarts entre la matrice RBAC et la liste de rôles du menu (`Sidebar.tsx`), source
d'incohérences visibles :

- `/vie-scolaire` : la `Sidebar` autorise `SECRETARY` (`:75`) mais
  `ROLE_PERMISSIONS` ne lui accorde aucune permission `vie-scolaire` → le lien
  s'affiche puis `guardPage` renvoie vers `/dashboard`.
- `/parents` : la `Sidebar` autorise `TEACHER` et `CLASS_TEACHER` (`:76`) ; la
  matrice ne leur accorde que `parents:read` (ok pour lire, mais aucune garde sur
  la page).

---
## 8. Correctifs recommandés (par priorité)

### P0 — immédiat

1. `src/lib/rbac.ts:109` — `STUDENT` : `"cours:*"` → `"cours:read"`.
2. Ajouter une permission aux mutations du § 5.1, sur le modèle des routes déjà
   protégées (`const denied = checkPermission(...) ; if (denied) return denied;`) :

```ts
// api/eleves/generer-comptes, api/eleves/changer-classe
checkPermission(session.user.role, "eleves:write");

// api/eleves/dispenses (POST + DELETE)
checkPermission(session.user.role, "eleves:write");

// api/vie-scolaire/convocations
checkPermission(session.user.role, "vie-scolaire:write");

// api/parametres/periodes-cloture, api/parametres/regles-appreciation
// `notes:manage` = pilotage du calendrier et des règles (direction), distinct
// de `notes:write` = saisie d'une note (enseignant).
checkPermission(session.user.role, "notes:manage");

// api/parametres/signature-cachet, api/parametres/upload-signature
// Permission dédiée aux mentions officielles : le refus est journalisé,
// contrairement à l'ancien contrôle de rôle inline.
checkPermission(session.user.role, "etablissement:write");

// api/test/setup-links — supprimer la route ou exiger SUPER_ADMIN
```

#### 8.1 État des correctifs P0 (appliqués)

| Constat | Route / fichier | Garde posée | Test de non-régression |
|---|---|---|---|
| — | `src/lib/rbac.ts:127` | `STUDENT` : `cours:read` (au lieu de `cours:*`) | `rbac.test.ts` — C1 |
| **C2** | `api/eleves/generer-comptes` (POST) | `eleves:write` | `rbac-mutations.test.ts` — 4 rôles refusés |
| E2 | `api/eleves/changer-classe` (POST) | `eleves:write` | idem (PARENT 403, SECRETARY franchit) |
| E2 | `api/eleves/dispenses` (POST **et** DELETE) | `eleves:write` | idem (POST + DELETE) |
| **C3** | `api/parametres/signature-cachet` (PUT) | `etablissement:write` (`TENANT_ADMIN`, `SUPER_ADMIN` via `*`) | idem (5 rôles refusés, direction 200) |
| C3 | `api/parametres/upload-signature` (POST) | `etablissement:write` | idem (6 rôles refusés, 401 si anonyme) |
| E3 | `api/parametres/periodes-cloture` (PUT) | `notes:manage` | idem (TEACHER / CLASS_TEACHER refusés) |
| E3 | `api/parametres/regles-appreciation` (POST/PUT/DELETE) | `notes:manage` | idem (3 verbes, TEACHER / CLASS_TEACHER refusés) |
| E4 | `api/vie-scolaire/convocations` (POST) | `vie-scolaire:write` | idem |
| M3 | `api/test/setup-links` (GET) | `authorizeSuperAdmin()` | idem (401 si anonyme, 403 sinon) |

> La garde ne remplace pas le **périmètre** : le filtre de site (et, pour les
> convocations, `isEleveInTeacherScope`) reste appliqué après elle. Une
> permission est une condition **nécessaire**, pas suffisante.

3. Sur les lectures nominatives du § 5.2, remplacer `siteFilterForModel` par
   `eleveScopeFilter(session.user, "eleve")` — le helper qui combine site **et**
   périmètre personnel (`src/lib/site-scope.ts:500-507`).

#### 8.2 Permissions dédiées — limites levées

Deux limites signalées à la pose des gardes P0 ont été levées le 23/09/2026 :

1. **`notes:manage`** — les gardes de `periodes-cloture` et
   `regles-appreciation` étaient `notes:write`, que `TEACHER` et
   `CLASS_TEACHER` détiennent : ils pouvaient donc ouvrir/clôturer les périodes
   et redéfinir les règles d'appréciation de l'établissement. La matrice leur
   accorde désormais `notes:read` + `notes:write` (saisie) au lieu de
   `notes:*` ; la direction conserve `notes:*`, qui couvre implicitement
   `notes:manage`.
2. **`etablissement:write`** — la garde de `signature-cachet` était un contrôle
   de rôle inline, qui n'émet **aucune** trace en cas de refus. Elle passe par
   `checkPermission(..., "etablissement:write")` (accordée à `TENANT_ADMIN` ;
   `SUPER_ADMIN` via `*`) : le refus 403 est **journalisé** dans `auditLog`.
   `upload-signature`, qui manipule le même objet, est alignée sur la même
   permission.

> Ces deux permissions ne sont portées par aucun rôle au-delà du strict
> nécessaire : `notes:manage` par la direction, `etablissement:write` par le
> propriétaire. Toute extension future doit être une décision explicite.

### P1 — pages *(appliqué le 23/09/2026)*

4. **`guardPage` posé sur les 25 pages qui n'en avaient pas** (`eleves`,
   `eleves/[id]`, `eleves/nouveau`, `eleves/[id]/modifier`, `eleves/attestations`,
   `eleves/cartes`, `eleves/comptes`, `eleves/transfert`, `parents`, `notes`,
   `notes/bulletins`, `cours`, `emploi-du-temps`, `absences`, `absences/appel`,
   `evaluations`, `evaluations/[id]`, `examens`, `examens/rapport-classe`,
   `orientation`, `alumni`, `messages`, `vie-scolaire/convocations`,
   `facturation/nouvelle`, `facturation/[id]`). Codemod idempotent :
   `scripts/patch-guard-page.ts`. Règles retenues :
   - permission de **lecture** du module pour les écrans de consultation ;
   - permission d'**écriture** pour les écrans d'action (`eleves/nouveau`,
     `eleves/[id]/modifier`, `eleves/comptes`, `eleves/transfert`,
     `vie-scolaire/convocations`, `facturation/nouvelle`) — rediriger vaut mieux
     que laisser remplir un formulaire dont l'action serveur répond 403 ;
   - exception documentée : `/notes/bulletins` exige `bulletins:read` et non
     `notes:read`, car le secrétariat a `bulletins:read` **sans** module `notes`.

> Conséquence : `PARENT`/`STUDENT` n'ont pas `eleves:read` et sont redirigés vers
> `/dashboard`. Si des écrans « mes enfants » doivent exister, les traiter comme
> un module dédié, pas comme une exception à la garde.

5. **Écrans de direction / outillage** — helpers `guardRoles` / `guardStaff` :
   - `/parametres` → onglets **dérivés des permissions**
     (`lib/parametres-tabs.ts`) : chaque onglet exige la permission de son
     module, un rôle ne voit que les siens (le secrétariat garde parents /
     classes / matières / doublons ; la direction garde tout ; les familles ne
     voient rien et sont redirigées) ;
   - `/test-telegram`, `/test-whatsapp` → `SUPER_ADMIN` (pages *client* : la
     garde est posée dans un `layout.tsx` de segment, Server Component) ;
   - `/parametres/audit` → garde serveur de segment ajoutée (la page ne
     vérifiait le rôle qu'après rendu, côté client).
6. **Lectures nominatives du § 5.2 — 11 routes** :
   - `bulletins/matrice`, `bulletins/check-existing`, `bulletins/rapport-classe`
     → `bulletins:read` **et** `eleveScopeFilter` ;
   - `absences/feuille-presence` → `absences:read` **et** `eleveScopeFilter` ;
   - `eleves/cartes-scolaires`, `eleves/attestation` → `eleves:read` **et**
     `eleveScopeFilter` ;
   - `dashboard/absences-chart` → `eleveScopeFilter` (le tableau de bord reste
     ouvert à tous, seul le périmètre change) ;
   - `factures/[id]/pdf`, `paiements/[id]/recu` → `finance:read` ;
   - `stripe/checkout` → `finance:write` ;
   - `eleves/upload-photo` → `eleves:write`.

> `eleveScopeFilter` est **neutre** pour les rôles de site : aucun écran de
> direction ou d'enseignement ne change de comportement. Vérifications :
> `npx vitest run` → **263/263** ; `tsc --noEmit` → exit 0 ;
> `npx next lint` (projet entier) → 0 erreur.

#### 8.3 Points de vigilance soldés

Les réserves signalées après la pose des gardes P0/P1 sont levées :

1. **`/parametres` n'est plus « tout ou rien »** — chaque onglet exige la
   permission de son module (`lib/parametres-tabs.ts`, verrouillé par
   `parametres-tabs.test.ts`). Le secrétariat retrouve parents / classes /
   matières / doublons ; les mentions officielles, les sites et les comptes
   restent au propriétaire et à la direction.
2. **Documents financiers et familles** — `factures/[id]/pdf` et
   `paiements/[id]/recu` acceptent soit `finance:read` (personnel), soit un rôle
   à périmètre personnel **borné à ses propres enfants** (`personalScopeFilter`
   sur la facture, contrôle d'appartenance sur l'élève pour le reçu). L'accès
   par identifiant reste fermé, et le document demeure accessible à la famille
   concernée — ce que le refus global aurait cassé.
3. **Artefacts de classe** — `bulletins/matrice`, `bulletins/check-existing`,
   `bulletins/rapport-classe`, `absences/feuille-presence` renvoient un **403
   explicite** aux rôles à périmètre personnel : une liste nominative de classe
   ne se « borne » pas à un élève, elle ne le concerne pas.
4. **Écrans de personnel ouverts aux familles** — `/notes`,
   `/notes/bulletins`, `/absences`, `/absences/appel` passent sur `guardStaff` :
   les rôles à périmètre personnel sont redirigés vers `/dashboard`. Un futur
   « espace famille » sera un **module dédié** appliquant `eleveScopeFilter`.
5. **Tableau de bord** — la liste « notes récentes », qui affiche des noms
   d'élèves, est bornée par `personalScopeFilter` (elle exposait sinon les
   dernières notes de tout l'établissement à un parent).

### P2 — UI / outillage

7. Faire dériver l'affichage (menu, boutons, modales) de la **même** matrice que
   le serveur : exposer `ROLE_PERMISSIONS` (ou une route `/api/me/permissions`)
   et remplacer les listes `roles:` de `Sidebar.tsx` par `roleHasPermission`.
8. Ajouter un test unitaire de non-régression de la matrice :

```ts
expect(roleHasPermission("STUDENT", "cours:write")).toBe(false);
expect(roleHasPermission("STUDENT", "cours:delete")).toBe(false);
expect(roleHasPermission("PARENT", "eleves:write")).toBe(false);
```

---

## 8bis. Arbitrages métier en attente (les 3 points « à confirmer » du § 7)

Ces trois points ne sont **pas** des défauts de code : la matrice fait ce qu'on
lui demande. Ce sont des **choix d'organisation** — une décision de direction,
pas une décision technique. Pour chacun : ce que le code fait aujourd'hui, les
options, et celle qui est **recommandée**.

### A. `CLASS_TEACHER` → `bulletins:publish` (constat M1)

**Ce que fait le code.** `POST /api/bulletins/publier` bascule `isPublie` sur les
bulletins d'**une classe** × une période, et n'est ouvert qu'aux rôles portant
`bulletins:publish` (`TENANT_ADMIN`, `PRINCIPAL`, `CLASS_TEACHER`,
`SUPER_ADMIN`). La route borne déjà l'action à `isClasseInTeacherScope` : un
professeur principal ne publie donc **que les classes où il enseigne** — le
constat du § 2 (« publie les bulletins de l'établissement ») est trop large et
doit être lu ainsi. Le schéma ne connaît **aucune** notion de professeur
principal *titulaire* d'une classe (`Classe` n'a pas de champ `titulaireId`) :
il est impossible de distinguer « le PP de la classe » de « un enseignant de la
classe ».

| Option | Effet | Risque |
|---|---|---|
| **A1 — Retirer `bulletins:publish` de `CLASS_TEACHER`** | Publier devient un **acte de direction** ; le PP garde `bulletins:write` (saisie, édition, conseil de classe). | Une étape de plus dans le circuit de fin de période. |
| A2 — Conserver | Le PP publie ses classes, la direction publie le reste. | Réellement : **tout enseignant de la classe** peut publier (faute de notion de titulaire) ; publication possible avant l'arbitrage de la direction, sans visa « direction » tracé. |

**Recommandation : A1.** La publication rend le bulletin visible des familles et
fige les résultats : c'est l'acte final de la période (post-conseil de classe),
pas un acte de saisie — c'est aussi le modèle des produits de référence
(« Publish report cards » = administration). A2 ne deviendrait cohérent qu'après
ajout d'un `titulaireId` sur `Classe` (chantier séparé).

Coût : 1 ligne (`rbac.ts:73`) + 1 cas de test ; la route et son périmètre ne
changent pas.

### B. `ACCOUNTANT` → `rh:*` (§ 7, ligne 92)

**Ce que fait le code.** `rh:write` — accordé par `rh:*` — garde quatre choses de
nature très différente :

| Route | Contenu | Doit-il être ouvert au comptable ? |
|---|---|---|
| `PATCH /api/rh/[id]` | fiche RH : `salaireBase`, `tarifHoraire`, `banque`, **`rib`**, contrat, dates | ❌ c'est la **base du paiement** |
| `POST /api/rh/[id]` | **génération du bulletin de paie** | ✅ c'est son métier |
| `POST/PATCH /api/rh/absences`, `/api/rh/conges` | absences, congés (report sur `congesPris`) | ❌ acte RH |
| `GET /api/rh*` | consultation (`rh:read`) | ✅ oui |

**Le point sensible est le RIB** : un rôle qui peut modifier le salaire **et** le
RIB du bénéficiaire **et** générer le paiement concentre les deux moitiés du
contrôle — le schéma classique de détournement de virement en paie.

| Option | Effet |
|---|---|
| **B1 — `rh:*` → `rh:read` + `paie:write` (permission dédiée à la génération des bulletins)** | Le comptable lit le RH et génère les bulletins ; salaires, RIB, contrats, absences et congés restent à la direction / au secrétariat. |
| B2 — `rh:*` → `rh:read` seul | La direction (ou le secrétariat) génère les bulletins ; le comptable les comptabilise. Le plus strict. |
| B3 — statu quo | Simple, mais aucune séparation des tâches. |

**Recommandation : B1.** Elle conserve la capacité réellement utilisée
(`RHView` → « Générer la paie », `POST /api/rh/[id]`, entrée `/rh` visible pour
`ACCOUNTANT` dans la `Sidebar`) tout en retirant la capacité dangereuse.
Mise en œuvre : nouveau module `paie` (`paie:write`) ; `POST /api/rh/[id]` accepte
`rh:write` **ou** `paie:write` (les rôles déjà munis de `rh:*` ne changent pas) ;
`ACCOUNTANT` reçoit `paie:write` + `rh:read`. Choisir B2 si l'établissement veut
que **seule** la direction génère les bulletins.

Coût : ~15 lignes (helper multi-permission + 1 route + matrice) et 4 cas de test.
**Décision préalable nécessaire** : si, dans cet établissement, le comptable
saisit lui-même les absences qui alimentent la paie, B1 le lui retire.

### C. `SECRETARY` → `eleves:*` (dont `eleves:delete`)

**Ce que fait le code.** La « suppression » d'un élève est un **soft delete**
(`src/lib/actions/eleve.ts`) : `deletedAt` renseigné, `statut = ABANDONNE`,
compte utilisateur délié, `identiteKey` libéré pour permettre une réinscription.
Elle est **réversible** (`restoreEleve`, avec contrôle du doublon repris
entre-temps) et **auditée** (`audit` + motif). Il n'existe **aucun** hard delete
dans `src/` : notes, absences et factures sont conservés.

| Option | Effet | Contrepartie |
|---|---|---|
| C1 — **Conserver** `eleves:delete` au secrétariat | Le guichet traite les départs (transfert, abandon, radiation) sans dépendre de la direction. | Le secrétariat retire l'élève des listes ; les données restent et la restauration est possible. |
| C2 — Scinder : `eleves:read/write` au secrétariat, `eleves:delete` à la direction | La radiation devient un acte de direction. | Goulot au guichet, et contournement possible (statut modifié à la main via `eleves:write`). |

**Recommandation : C1**, avec deux règles à inscrire au dossier :

1. `eleves:delete` ne couvre **jamais** une purge définitive : si la conservation
   ou le RGPD impose un jour une suppression physique, elle exige une permission
   **distincte** (`eleves:purge`), réservée à la direction et auditée.
2. Le **motif** de radiation reste obligatoire dans l'appel (`reason`) : il est
   déjà journalisé — c'est la pièce justificative en cas de réclamation.

Coût : 0 ligne de code (décision + documentation). C2 : 1 ligne + 1 test, à
condition de décider qui, au secrétariat, garde le droit de corriger un statut.

### D. `SECRETARY` → module `vie-scolaire` (divergence `Sidebar` ↔ matrice, révélée par le correctif P0)

**Ce que fait le code.** La `Sidebar` affiche `/vie-scolaire` au secrétariat
(`Sidebar.tsx:75`) depuis l'origine, mais `ROLE_PERMISSIONS` ne lui accorde
**aucune** permission `vie-scolaire` (§ 7). L'écart était déjà visible sur les
incidents (`api/vie-scolaire/incidents/*` exige `vie-scolaire:write` → 403 pour
le secrétariat) ; le correctif P0 l'étend aux **convocations**, qui n'exigeaient
auparavant aucune permission : le secrétariat reçoit désormais 403 sur une tâche
de guichet que son menu lui propose.

| Option | Effet | Contrepartie |
|---|---|---|
| **D1 — Accorder `vie-scolaire:write` au secrétariat** | Le guichet convoque les familles et traite les incidents, conformément à l'intention de la `Sidebar`. Aligne menu et matrice. | Le secrétariat gagne aussi la création d'incidents (même permission, déjà bornée par site). |
| D2 — Retirer l'entrée `/vie-scolaire` du menu du secrétariat | La matrice reste la source de vérité ; convocations et incidents deviennent des actes de direction / CPE. | Le secrétariat perd la convocation des familles, tâche de guichet courante. |

**Recommandation : D1.** Le menu et l'usage décrivent un secrétariat qui convoque
les familles ; la permission reste bornée au tenant (`tenantId`) et au périmètre
de site par `siteFilterForModel`. Coût : 1 ligne dans le bloc `SECRETARY` de
`rbac.ts` + 1 cas de test. Choisir D2 si l'établissement veut que les
convocations soient visées par la direction ou le CPE.

> Ce point est distinct des 3 arbitrages ci-dessus : il n'était pas visible avant
> que les routes ne portent de garde (§ 5.1).

**Décision D1 (23/09/2026) — appliquée.** `SECRETARY` reçoit
`vie-scolaire:read` **et** `vie-scolaire:write` (bloc `SECRETARY` de `rbac.ts`).
Les deux sont nécessaires : `read` ouvre `/vie-scolaire` (`guardPage` de la
page), `write` autorise incidents et convocations. Cas de test :
`rbac.test.ts` — « les convocations exigent vie-scolaire:write ».

## 9. Vérifié sans anomalie

- `api/import/eleves/*` : `role === TENANT_ADMIN || SUPER_ADMIN`.
- `api/super-admin/*` : `role === "SUPER_ADMIN"`.
- `api/audit` : `authorize({ permission: "audit:read" })` + rôle super-admin.
- `api/test/telegram`, `api/test/whatsapp` : `authorizeSuperAdmin()`.
- `api/mobile/*` : `verifyMobileScope` (jeton + relecture en base) et
  `eleveScopeFilter` → périmètre personnel réellement appliqué.
- `api/messages/audience`, `messaging-audience.ts` : ciblage borné par rôle
  (`allowedScopeKinds` / `allowedGroups`).
- `api/absences/appel`, `api/evaluations`, `api/examens`, `api/notes`,
  `api/eleves` (GET/POST), `api/cours` (GET/POST — hors rôle `STUDENT`) :
  `checkPermission` + périmètre enseignant.
- `api/bulletins/publier` exige `bulletins:publish` (voir cependant M1).
- `api/structures`, `switch-site`, `switch-tenant` : contrôles de rôle/adhésion
  explicites.

---

## 10. Écart avec la documentation

`docs/PLAN_CHANTIERS_RESTANTS.md` § 3.2 liste comme « rien à faire (vérifié) » :

> `rh/*`, `inventaire/*`, …, `factures/*`, `paiements/*`, `parametres/*`,
> `audit`, `cron/*`, `webhooks/*`, `health`, `test/*`, `switch-site`,
> `switch-tenant`, `rapports`.

Ce classement ne repose que sur la lecture de `ROLE_PERMISSIONS`, pas sur une
vérification des routes. Or `parametres/*` (3 routes), `factures/*` (1),
`paiements/*` (1), `test/*` (1 route + 2 pages) et `health` **n'appliquaient aucun
contrôle RBAC**.

> **Corrigé le 23/09/2026** — le § 3.2 a été réécrit (plus de « rien à faire ») et
> les 4 routes actionnables portent désormais une garde (cf. § 8.1). Restent sans
> permission : `factures/[id]/pdf`, `paiements/[id]/recu`, `stripe/checkout`
> (documents financiers) et `health` — à traiter en P1 (§ 5.2, M4).

---

## 11. Reproduire la vérification

```bash
# Routes sans aucun contrôle de permission
for f in $(find src/app/api -name 'route.ts'); do
  grep -qE 'checkPermission\(|authorize\(|authorizeSuperAdmin|role !== |role === ' "$f" \
    || echo "NO-PERM-CHECK: $f"
done

# Pages sans guardPage
grep -L 'guardPage' $(find 'src/app/(dashboard)' -name 'page.tsx')
```