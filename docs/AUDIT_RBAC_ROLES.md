
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
checkPermission(session.user.role, "notes:write");

// api/parametres/signature-cachet — action de direction uniquement
if (session.user.role !== "TENANT_ADMIN" && session.user.role !== "SUPER_ADMIN") {
  return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
}

// api/test/setup-links — supprimer la route ou exiger SUPER_ADMIN
```

3. Sur les lectures nominatives du § 5.2, remplacer `siteFilterForModel` par
   `eleveScopeFilter(session.user, "eleve")` — le helper qui combine site **et**
   périmètre personnel (`src/lib/site-scope.ts:500-507`).

### P1 — pages

4. Poser `guardPage` sur les pages du § 4 avec la permission de lecture du
   module :

```ts
guardPage(session, "eleves:read");      // /eleves, /eleves/[id], …
guardPage(session, "parents:read");     // /parents
guardPage(session, "notes:read");       // /notes, /notes/bulletins
guardPage(session, "evaluations:read"); // /evaluations
guardPage(session, "examens:read");     // /examens
guardPage(session, "cours:read");       // /cours
guardPage(session, "emploi-du-temps:read");
guardPage(session, "absences:read");
```

> Conséquence attendue : `PARENT`/`STUDENT` n'ont pas `eleves:read` et seront
> redirigés vers `/dashboard`. Si des écrans « mes enfants » doivent exister,
> les traiter comme un module dédié, pas comme une exception à la garde.

5. `/parametres` : remplacer le simple `canManage` par une garde de rôle
   explicite (`TENANT_ADMIN` / `SUPER_ADMIN` / `PRINCIPAL`) et conditionner le
   lien de la `Sidebar` en conséquence.
6. `/test-telegram`, `/test-whatsapp`, `/api/test/setup-links` : réserver à
   `SUPER_ADMIN` ou supprimer en production.

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
`paiements/*` (1), `test/*` (1 route + 2 pages) et `health` **n'appliquent aucun
contrôle RBAC**. La conclusion du § 3.2 doit être corrigée pour ne pas servir de
référence d'audit.

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