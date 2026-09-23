# 🗺️ Plan des chantiers restants — filtrage par périmètre

**Projet :** EcolPro · **Date :** 22 septembre 2026
**Documents liés :**
- `docs/AUDIT_FILTRAGE_ENSEIGNANTS.md` — ce qui **a été corrigé** (§ 1 à § 5) et l'inventaire brut des restes (§ 6)
- `docs/FORMATION_ENSEIGNANTS.md` — guide utilisateur remis aux enseignants

**Objectif de ce document :** transformer l'inventaire du § 6 de l'audit en **plan d'exécution actionnable** — une tâche par écart, avec le fichier, le correctif précis, le critère de recette et l'ordre de traitement.

---

## 0. État des lieux au démarrage

| Contrôle | État |
|---|---|
| `npx tsc --noEmit` | ✅ 0 erreur |
| `npx next lint` | ✅ `✔ No ESLint warnings or errors` |
| Périmètre enseignant — **Web** | ✅ Traité (chantier 1, 14 points) |
| Isolation **multi-sites / multi-tenant** | ✅ Traité (chantier 2, 18 vulnérabilités) |
| Périmètre enseignant — **Mobile** | ❌ **Non traité** (chantier 3) |
| Périmètre enseignant — **Web, reste** | ❌ **9 points résiduels** (chantier 4) |
| Tests d'isolation automatisés | ❌ **Aucun** (chantier 5) |

### Le principe à ne jamais perdre de vue

> **Le filtre de site n'est pas le périmètre enseignant.**
> Le filtre de site répond à « cet utilisateur a-t-il accès à ce **site** ? ».
> Le périmètre enseignant répond à « cet enseignant a-t-il accès à **cette classe / cette matière** ? ».
> Les deux sont **cumulatifs** : le second ne remplace jamais le premier.

---

## 1. Boîte à outils déjà disponible (ne rien réécrire)

Tout est dans `src/lib/teacher-classes.ts` et `src/lib/site-scope.ts`.

### 1.1 Fragments `where` — à passer à `mergeFilters`

| Helper | Cible | Effet pour un enseignant |
|---|---|---|
| `teacherEleveFilter(claims)` | `Eleve` | Borné à `classeId ∈ scope.classeIds` |
| `teacherClasseFilter(claims)` | `Classe` | Borné à `id ∈ scope.classeIds` |
| `teacherMatiereFilter(claims)` | `Matiere` | Borné à `id ∈ scope.matiereIds` |
| `teacherEleveRelationFilter(claims, "eleve")` | `Absence`, `Incident`, `Bulletin`… | Borné via `eleve.classeId` |
| `teacherNoteFilter(claims)` | `Note` | Borné sur `classeId` **et** `matiereId` |
| `teacherParentFilter(claims)` | `Parent` | Familles dont un enfant est dans une de ses classes |

**Renvoient `{}` pour tout rôle non enseignant** → aucune régression pour les admins.

### 1.2 Prédicats de garde — quand l'identifiant vient de la requête HTTP

| Helper | Usage |
|---|---|
| `isClasseInTeacherScope(claims, classeId)` | Refuser un `classeId` forgé (URL, corps) |
| `isMatiereInTeacherScope(claims, matiereId)` | Refuser un `matiereId` forgé |
| `isEleveInTeacherScope(claims, eleveId)` | Refuser un `eleveId` forgé (consulte la base) |
| `areElevesInTeacherScope(claims, eleveIds)` | Saisie en masse : un seul hors périmètre ⇒ refus |

**Renvoient `true` pour tout rôle non enseignant.**

### 1.3 Le piège n° 1 : toujours `mergeFilters`, jamais l'étalement

```ts
// ❌ INTERDIT — l'étalement écrase le `OR` de premier niveau du filtre de site
const where = { tenantId, ...siteFilter, ...(q && { OR: [...] }), ...teacherFilter };

// ✅ CORRECT — `mergeFilters` encapsule chaque fragment dans la clé racine `AND`
const where = mergeFilters(
  { tenantId, ...siteFilter, ...(q && { OR: [...] }) },
  await teacherEleveFilter(claims)
);
```

*Raison :* `site-scope.ts` règle n° 2 — un `OR` de premier niveau posé par l'appelant écraserait silencieusement le filtre de site.

### 1.4 Le piège n° 2 : ne jamais substituer, toujours combiner

```ts
// ❌ INTERDIT — le filtre manuel REMPLACE le filtre de site
const classeWhere = { tenantId, id: { in: scope.classeIds } };

// ✅ CORRECT — le périmètre S'AJOUTE au filtre de site
const classeWhere = mergeFilters(
  { tenantId, ...siteFilterForModel("classe", session.user) },
  await teacherClasseFilter(session.user)
);
```

## 2. Chantier 3 — Mobile : 12 routes sans périmètre enseignant 🔴

### 2.1 Pourquoi c'est le chantier prioritaire

L'application mobile (`mobile-app/`) expose des écrans **métier enseignant** : `appel`, `notes`, `eleves`, `emploi-du-temps`, `vie-scolaire`, `absences`. Toutes les routes `src/app/api/mobile/*` appliquent le filtre de **site** mais **aucune** n'applique le périmètre **enseignant**.

**Conséquence concrète :** un professeur qui se connecte sur l'application mobile voit **toutes** les classes, tous les élèves, toutes les notes et toutes les absences de son site — et peut faire l'appel sur n'importe quelle classe.

### 2.2 Pourquoi le correctif est mécanique

`verifyMobileScope(req)` renvoie déjà un objet compatible avec `resolveTeacherScope(claims)` :

```ts
export type MobileScope = MobileUser & SessionSiteClaims;
// MobileUser : { id, email, role, tenantId }
// + siteId, siteIds, tenantHasSites …
```

Les helpers `teacherXFilter(claims)` acceptent `claims.id` — **aucun adaptateur n'est nécessaire**.

### 2.3 Modèle de correctif (à appliquer route par route)

```ts
import { verifyMobileScope, mobileUnauthorized } from "@/lib/mobile-auth";
import { siteFilterForModel, mergeFilters } from "@/lib/site-scope";
import { teacherEleveFilter } from "@/lib/teacher-classes";
import type { Prisma } from "@prisma/client";

export async function GET(req: NextRequest) {
  const user = await verifyMobileScope(req);
  if (!user) return mobileUnauthorized();
  if (!user.tenantId) { /* … */ }

  const eleveFilter = siteFilterForModel("eleve", user);
  const teacherFilter = await teacherEleveFilter(user);   // ← l'ajout

  const eleves = await prisma.eleve.findMany({
    where: mergeFilters(
      { tenantId: user.tenantId /* + filtres d'écran */ },
      eleveFilter,
      teacherFilter
    ) as Prisma.EleveWhereInput,
    // …
  });
}
```

### 2.4 Tableau d'exécution

| # | Route | Helper à brancher | Note |
|---|---|---|---|
| 3.1 | `mobile/eleves/route.ts` (GET) | `teacherEleveFilter` | Le `OR` de recherche `q` impose `mergeFilters` |
| 3.2 | `mobile/eleves/[id]/route.ts` (GET) | `isEleveInTeacherScope` → `404` | `id` vient de l'URL : garde **avant** lecture |
| 3.3 | `mobile/notes/route.ts` (GET) | `teacherNoteFilter` | Borne `classeId` **et** `matiereId` |
| 3.4 | `mobile/absences/route.ts` (GET) | `teacherEleveRelationFilter(user, "eleve")` | Existant : `eleveScopeFilter(user, "eleve")` |
| 3.5 | `mobile/classes/route.ts` (GET) | `teacherClasseFilter` + `teacherEleveFilter` dans le `_count` | Deux requêtes à borner |
| 3.6 | `mobile/appel/route.ts` (**GET + POST**) | `isClasseInTeacherScope` → `403` | **Le plus critique** : écriture d'absences |
| 3.7 | `mobile/incidents/route.ts` (GET) | `teacherEleveRelationFilter(user, "eleve")` | |
| 3.8 | `mobile/dashboard/route.ts` (GET) | `teacherEleveFilter` + `teacherClasseFilter` + `teacherEleveRelationFilter` | 6 requêtes agrégées |
| 3.9 | `mobile/analytics/route.ts` (GET) | idem 3.8 | 3 `count` + listes |
| 3.10 | `mobile/emploi-du-temps/route.ts` (GET) | **helper à créer** (voir 2.5) | Doit montrer **son** planning |
| 3.11 | `mobile/messages/route.ts` | — | Déjà borné par `ConversationParticipant` |
| 3.12 | `mobile/register-device/route.ts` | — | Enregistre le jeton de **l'appareil de l'utilisateur** |

### 2.5 Prérequis à créer : `teacherEmploiTempsFilter`

**Aucun helper existant ne borne `EmploiTemps` sur l'enseignant lui-même.** `teacherClasseFilter` bornerait bien sur ses classes, mais montrerait **les créneaux de ses collègues** pour ces mêmes classes.

À ajouter dans `src/lib/teacher-classes.ts` :

```ts
/**
 * Pour une requête sur `EmploiTemps` : borné aux créneaux de l'enseignant
 * LUI-MÊME. `teacherClasseFilter` ne suffit pas — il montrerait les créneaux
 * de ses collègues pour les mêmes classes.
 * Fail-closed : si la fiche enseignant n'existe pas, aucun créneau.
 */
export async function teacherEmploiTempsFilter(
  claims: TeacherScopeClaims
): Promise<Record<string, unknown>>;
```

Implémentation : résoudre `enseignant.id` depuis `claims.userId ?? claims.id`, puis renvoyer `{ AND: [{ enseignantId: { in: [id] } }] }` ; si la fiche n'existe pas → `{ AND: [{ enseignantId: { in: [NO_TEACHER_SCOPE_ID] } }] }`.

### 2.6 Critère de recette du chantier 3

> Connecté avec un compte **enseignant** sur le mobile, chaque écran ne doit
> présenter que les données de **ses** classes et de **ses** matières. Un
> `classeId` / `eleveId` d'une autre classe doit renvoyer **403** (écriture) ou
> **404** (lecture) — jamais la donnée.

---
## 3. Chantier 4 — Web : 9 points résiduels 🟠

| # | Fichier | Constat vérifié | Correctif | Recette |
|---|---|---|---|---|
| 4.1 | `src/app/api/eleves/route.ts` (**GET**) | `eleves:read` est accordé aux profs : liste **et export CSV** (`?export=true`, jusqu'à 5 000 lignes) de **tous** les élèves du site | `mergeFilters(where, await teacherEleveFilter(claims))` | Un prof ne reçoit que ses élèves, y compris en `export=true` |
| 4.2 | `src/app/(dashboard)/eleves/[id]/page.tsx` | Un prof ouvre **n'importe quel** élève du site par URL : identité, notes, absences, bulletins, parents | `isEleveInTeacherScope(claims, id)` → sinon `notFound()` | `/eleves/<id hors périmètre>` ⇒ 404 |
| 4.3 | `src/app/(dashboard)/evaluations/[id]/page.tsx` | `siteFilterForRelation(user, "classe")` uniquement → évaluation d'une autre classe accessible par URL | Ajouter `evalScopeFilter` (déjà utilisé sur `notes/page.tsx`) via `mergeFilters` | `/evaluations/<id hors périmètre>` ⇒ redirection |
| 4.4 | `api/vie-scolaire/incidents` (GET + POST), `incidents/[id]`, `convocations` | Filtre de **site** seulement. La **page** est bornée, l'**API** ne l'est pas | `teacherEleveRelationFilter` sur les listes ; `isEleveInTeacherScope` sur les `eleveId` reçus | Créer un incident pour un élève hors périmètre ⇒ 403 |
| 4.5 | `api/cours/[id]` (GET/PATCH/DELETE) | Un prof peut **lire et modifier** le brouillon d'un collègue par identifiant | **Décision métier requise** (voir § 3.1) | Un prof n'accède pas au brouillon d'un autre |
| 4.6 | `api/bulletins/[id]`, `bulletins/publier`, `bulletins/rapport-classe` | Filtre de site seulement (10 autres routes bulletins sont déjà bornées) | `teacherClasseFilter` / `teacherEleveRelationFilter` | Bulletin d'une autre classe ⇒ 404/403 |
| 4.7 | `api/dashboard/absences-chart/route.ts` | Graphique calculé sur **tout** le site | `teacherEleveRelationFilter` | Le graphique d'un prof ne somme que ses classes |
| 4.8 | `api/ai/appreciation`, `api/ai/chat` | `ai:teacher` : le contexte transmis au modèle peut porter sur un élève hors périmètre | `isEleveInTeacherScope` sur les `eleveId` reçus | Appréciation hors périmètre ⇒ refus |
| 4.9 | `api/examens/[id]`, `[id]/deliberation` | Protégés par `examens:write`, **non accordé** aux rôles enseignant d'après `ROLE_PERMISSIONS` | **Rien à faire** — à revérifier si la matrice RBAC évolue | Contrôle négatif documenté |

### 3.1 Décision métier à trancher AVANT 4.5

Le modèle `Cours` ne porte **pas** de `enseignantId` — seulement un champ libre `auteurNom` (cf. `prisma/schema.prisma`, ligne 1953). Deux options :

- **Option A — sans migration (fragile)** : pour un enseignant, n'exposer que `statut = PUBLIE` **ou** les cours dont `auteurNom` correspond à son nom. La comparaison porte sur une **chaîne libre** : un homonyme ou une faute de frappe ouvre ou ferme la mauvaise porte.
- **Option B — propre (avec migration)** : ajouter `auteurId String?` (+ relation `User`) à `Cours`, l'alimenter à la création depuis la session, puis borner sur `auteurId = soi`. **Préférable à moyen terme.**

> ⚠️ **Ne pas implémenter 4.5 avant cette décision.** L'option A donnerait une fausse sensation de sécurité.

### 3.2 Contrôle négatif — revu après l'audit RBAC du 23/09

> ⚠️ **Corrigé le 23/09/2026.** La version initiale de cette section affirmait
> « rien à faire (vérifié) » en se fondant sur la **lecture de la matrice**
> `ROLE_PERMISSIONS`, et non sur une vérification des routes. L'audit
> `docs/AUDIT_RBAC_ROLES.md` a montré que plusieurs de ces routes ne portaient
> **aucun** contrôle : `parametres/*` (3 routes), `test/setup-links`,
> `factures/[id]/pdf`, `paiements/[id]/recu`, `stripe/checkout`, `health`.

État réel :

- **Corrigées** (porte désormais une garde) : `parametres/signature-cachet`,
  `parametres/periodes-cloture`, `parametres/regles-appreciation`,
  `test/setup-links` — voir `docs/AUDIT_RBAC_ROLES.md` § 8.1 ;
- **Conformes** (contrôle de rôle inline ou clé de service) : `structures`,
  `super-admin/*`, `import/eleves/*`, `cron/*` (`CRON_SECRET`), `webhooks/*`
  (signature), `switch-site`, `switch-tenant`, `audit` ;
- **Encore sans permission** : `factures/[id]/pdf`, `paiements/[id]/recu`,
  `stripe/checkout` (documents financiers — le site et la facture sont
  vérifiés, pas le rôle) et `health` (lecture neutre).

> Toute évolution de la matrice `ROLE_PERMISSIONS` devra déclencher une
> **ré-évaluation** de ces routes — et cette fois en **exécutant** la commande de
> contrôle (`docs/AUDIT_RBAC_ROLES.md` § 11), pas en relisant la matrice.

---
## 4. Chantier 5 — Tests d'isolation automatisés 🔵

### 4.1 Le problème

Tout ce qui a été corrigé dans les chantiers 1 et 2 est validé **statiquement** (TypeScript + ESLint) — c'est-à-dire que le code **compile** et respecte les règles de lint. Aucun test **n'exécute** les chemins d'accès pour vérifier qu'ils **refusent** effectivement.

> **Sans test, une régression est indétectable.** Un futur refactoring peut retirer un `mergeFilters` sans que ni `tsc` ni `eslint` ne s'en aperçoive.

### 4.2 Prérequis à lever d'abord

| # | Prérequis | Constat |
|---|---|---|
| 5.1 | **Cohérence `fixtures.ts` ↔ `prisma/seed.ts`** | `tests/e2e/fixtures.ts` se connecte avec `admin@lycee-**djibouti**.ecolpro.app`, alors que le seed crée `admin@lycee-**demo**.ecolpro.app`. Les tests existants ne peuvent donc pas s'authentifier sur une base fraîchement seedée. **À aligner.** |
| 5.2 | **Identifiants configurables** | Exposer `loginAs(page, { email, password })` dans `fixtures.ts`, avec repli sur des variables d'environnement (`E2E_ADMIN_EMAIL`…) — évite de figer les comptes dans le dépôt. |
| 5.3 | **Un second enseignant dans le seed** | Le seed ne crée qu'**un** compte `TEACHER`. Un test « prof A ne voit pas les données de prof B » exige **prof B**. À ajouter. |
| 5.4 | **Un second site** | Un test « admin du site A n'atteint pas le site B » exige deux `Site` dans le même tenant, avec des classes distinctes. À ajouter si absent. |

### 4.3 Livrable : `tests/e2e/isolation.spec.ts`

**Stratégie recommandée : tester au niveau de l'API, pas de l'interface.** Motif : l'UI *masque* les liens hors périmètre depuis le chantier 1 — elle serait donc « verte » même si l'API restait ouverte. Ce qu'il faut prouver, c'est que **l'API refuse**, ce qui n'est observable qu'en appelant directement.

`page.request` réutilise les cookies de session du contexte Playwright :

```ts
import { test, expect } from "./fixtures";

test.describe("Isolation — périmètre enseignant", () => {
  test("un prof ne peut pas faire l'appel sur la classe d'un collègue", async ({ authedPage: page }) => {
    const res = await page.request.post("/api/absences/appel", {
      data: { classeId: CLASSE_DE_PROF_B, date: "2026-09-22", presences: [] },
    });
    expect(res.status()).toBe(403);
  });

  test("un prof ne peut pas programmer une session hors de ses matières", async ({ authedPage: page }) => {
    const res = await page.request.post(`/api/examens/${EXAMEN_ID}/sessions`, {
      data: { matiereNom: "MATIERE_DE_PROF_B", date: "2026-09-22", heureDebut: "08:00", heureFin: "10:00" },
    });
    expect(res.status()).toBe(403);
  });
});
```

### 4.4 Scénarios à couvrir (liste minimale)

| # | Scénario | Attendu |
|---|---|---|
| 5.5 | Prof A appelle une classe de prof B | **403** |
| 5.6 | Prof A crée une évaluation (classe ou matière de B) | **403** |
| 5.7 | Prof A programme une session d'examen hors périmètre | **403** |
| 5.8 | Prof A lit `GET /api/notes?eleveId=<élève de B>` | liste **vide** (jamais les notes de B) |
| 5.9 | Prof A écrit une note sur un élève de B (`POST /api/notes`) | **403** |
| 5.10 | Prof A ouvre `/eleves/<id de B>` | **404** |
| 5.11 | Prof A ouvre `/emploi-du-temps` | ne voit **que** ses créneaux |
| 5.12 | Admin du site A lit une facture du site B | **404/403** |
| 5.13 | Admin du site A importe un élève dans le site B | **403/404** |
| 5.14 | Admin du site A demande une attestation pour un élève du site B | **404** |
| 5.15 | Prof A (mobile) appelle une classe de B *(`Authorization: Bearer …`)* | **403** — après chantier 3 |

### 4.5 Commande et intégration

```bash
npm run test:e2e                                        # tous les tests
npx playwright test tests/e2e/isolation.spec.ts          # le lot d'isolation
```

- Config : `playwright.config.ts` — `baseURL: http://localhost:3001`, `webServer: npm run dev`, `reuseExistingServer: true`.
- **À ajouter au besoin :** une cible dans `package.json` (`"test:isolation"`) et un appel en **CI** (`forbidOnly` est déjà positionné : idéal pour un pipeline).

---
## 5. Séquencement recommandé

L'ordre suit **l'exposition réelle décroissante**, pas la difficulté technique.

```
   ┌─────────────────────────────────────────────────────────────┐
   │ ÉTAPE 0 — Prérequis (bloquants)                             │
   │  · teacherEmploiTempsFilter (§ 2.5)                         │
   │  · Alignement fixtures ↔ seed (§ 4.2 / 5.1)                 │
   └───────────────────────────┬─────────────────────────────────┘
                               ▼
   ┌─────────────────────────────────────────────────────────────┐
   │ ÉTAPE 1 — Chantier 3 « Mobile, écriture »                   │
   │  3.6 mobile/appel (GET + POST)   ← le plus critique         │
   │  3.2 mobile/eleves/[id]  3.1 mobile/eleves                  │
   │  3.3 mobile/notes        3.4 mobile/absences                │
   └───────────────────────────┬─────────────────────────────────┘
                               ▼
   ┌─────────────────────────────────────────────────────────────┐
   │ ÉTAPE 2 — Chantier 4 « Web, écriture puis lecture »         │
   │  4.4 vie-scolaire (API)  4.1 api/eleves  4.2 eleves/[id]    │
   │  4.3 evaluations/[id]    4.6 bulletins   4.7 absences-chart │
   └───────────────────────────┬─────────────────────────────────┘
                               ▼
   ┌─────────────────────────────────────────────────────────────┐
   │ ÉTAPE 3 — Chantier 3 « Mobile, lecture et agrégats »        │
   │  3.5 classes  3.7 incidents  3.8 dashboard                  │
   │  3.9 analytics  3.10 emploi-du-temps                        │
   └───────────────────────────┬─────────────────────────────────┘
                               ▼
   ┌─────────────────────────────────────────────────────────────┐
   │ ÉTAPE 4 — Décision métier puis 4.5 (Cours brouillons)       │
   │  Option A (auteurNom) ou Option B (migration auteurId)      │
   └───────────────────────────┬─────────────────────────────────┘
                               ▼
   ┌─────────────────────────────────────────────────────────────┐
   │ ÉTAPE 5 — Chantier 5 (tests d'isolation) + 4.8 (IA)         │
   │  Verrouille définitivement les étapes 1 à 4                 │
   └─────────────────────────────────────────────────────────────┘
```

### Pourquoi les tests arrivent en **dernier**

Les tests d'isolation ont besoin des helpers de l'étape 0 **et** d'un périmètre effectivement appliqué pour être significatifs.

> **Exception :** les scénarios **5.8 / 5.9 / 5.12 / 5.13 / 5.14** (Web + facturation) peuvent être écrits **immédiatement** : ils portent sur les chantiers 1 et 2 **déjà livrés**. Les écrire tôt **verrouille l'acquis** avant d'attaquer le mobile.

---
## 6. Recette globale — définition de « terminé »

Une tâche n'est considérée terminée que si **les cinq** conditions sont réunies :

1. **Correctif appliqué** — le helper est branché via `mergeFilters`, jamais par étalement.
2. **`npx tsc --noEmit`** → 0 erreur.
3. **`npx next lint`** → `✔ No ESLint warnings or errors` (le projet est actuellement à zéro : ne pas introduire de nouvelle alerte).
4. **Test négatif** — l'accès hors périmètre est **refusé**.
5. **Test positif** — l'utilisateur légitime conserve **exactement** son périmètre (aucune régression).

### Table de correspondance code HTTP

| Situation | Réponse attendue |
|---|---|
| Écriture hors périmètre (identifiant forgé dans le corps) | **403** + message métier explicite |
| **Lecture** hors périmètre (identifiant dans l'URL) | **404** — ne pas révéler l'existence de la ressource |
| Liste hors périmètre | **200 avec liste vide** (pas d'erreur : le périmètre est normal) |
| Rôle non enseignant, ressource dans son site | **200** — aucune régression |

> **Pourquoi 404 en lecture et 403 en écriture ?** Un 403 sur une lecture confirmerait l'existence de la ressource à un utilisateur qui n'a pas le droit de la connaître.

---

## 7. Journal de progression

Tenue le **23 septembre 2026**. Légende : `[x]` livré et vérifié statiquement
(`npx tsc --noEmit` → 0 erreur ; `npx next lint` → `✔ No ESLint warnings or errors`).

### Étape 0 — Prérequis
- [x] `teacherEmploiTempsFilter` créé dans `src/lib/teacher-classes.ts` (session du 22/09)
- [x] `tests/e2e/fixtures.ts` aligné sur `prisma/seed.ts` (domaine `lycee-demo`)
- [x] Identifiants E2E configurables par variables d'environnement (`E2E_*`)
- [x] Second enseignant ajouté au seed (+ fiche `Enseignant` associée)
- [x] Second site dans le seed **+ une classe du même site hors périmètre** (cible qui distingue « périmètre enseignant » de « filtre de site »)

### Étape 1 — Mobile, écriture
- [x] 3.6 `mobile/appel` — garde `isClasseInTeacherScope` → **403** (la seule route mobile qui écrit et notifie les familles)
- [x] 3.2 `mobile/eleves/[id]` — garde `isEleveInTeacherScope` → **404**
- [x] 3.1 `mobile/eleves` — `teacherEleveFilter` via `mergeFilters`
- [x] 3.3 `mobile/notes` — `teacherNoteFilter` sur les notes **et** sur les listes de classes/matières proposées
- [x] 3.4 `mobile/absences` — `teacherEleveRelationFilter(user, "eleve")`

### Étape 2 — Web, écriture puis lecture
- [x] 4.4 `api/vie-scolaire/incidents` (GET : `teacherEleveRelationFilter` ; POST : `isEleveInTeacherScope` → 403), `incidents/[id]` (PATCH + sanction), `convocations`
- [x] 4.1 `api/eleves` (GET + export CSV) — `teacherEleveFilter`
- [x] 4.2 `eleves/[id]/page.tsx` — `isEleveInTeacherScope` → `notFound()`
- [x] 4.3 `evaluations/[id]/page.tsx` — `teacherEvaluationFilter` (helper ajouté à `teacher-classes.ts`)
- [x] 4.6 `api/bulletins/[id]` (PUT + DELETE), `bulletins/publier`, `bulletins/rapport-classe`
- [x] 4.7 `api/dashboard/absences-chart` — `teacherEleveRelationFilter`

### Étape 3 — Mobile, lecture et agrégats
- [x] 3.5 `mobile/classes` — classe **et** élèves imbriqués bornés
- [x] 3.7 `mobile/incidents` — `teacherEleveRelationFilter`
- [x] 3.8 `mobile/dashboard` — 6 agrégats + listes « récentes »
- [x] 3.9 `mobile/analytics` — 6 `count` + 3 listes + moyennes
- [x] 3.10 `mobile/emploi-du-temps` — `teacherEmploiTempsFilter` (son planning, pas celui de ses collègues)

### Étape 2 — Web, écriture puis lecture
- [ ] 4.4 `api/vie-scolaire/*` (3 routes)
- [ ] 4.1 `api/eleves` (GET + export CSV)
- [ ] 4.2 `eleves/[id]/page.tsx`
- [ ] 4.3 `evaluations/[id]/page.tsx`
- [ ] 4.6 `api/bulletins/[id]`, `publier`, `rapport-classe`
- [ ] 4.7 `api/dashboard/absences-chart`

### Étape 3 — Mobile, lecture et agrégats
- [ ] 3.5 `mobile/classes`
- [ ] 3.7 `mobile/incidents`
- [ ] 3.8 `mobile/dashboard`
- [ ] 3.9 `mobile/analytics`
- [ ] 3.10 `mobile/emploi-du-temps`

### Étape 4 — Décision puis Cours
- [ ] **Décision métier 4.5 non tranchée** — `api/cours/[id]` reste **volontairement
  non corrigé** : l'option A (`auteurNom`, comparaison sur une chaîne libre) donne
  une fausse sensation de sécurité, l'option B exige une migration (`auteurId` +
  relation `User`). Conformément au plan § 3.1, rien n'a été implémenté avant
  l'arbitrage.

### Étape 5 — Tests et IA
- [x] `tests/e2e/isolation.spec.ts` créé — **11 scénarios** (5.5 → 5.15), au niveau API
- [x] Seed de test : 2 sites, 3 classes (dont une hors périmètre **dans le même site**), 2 enseignants, évaluations, notes, examens, facture — identifiants fixes
- [x] 4.8 `api/ai/appreciation` — `isEleveInTeacherScope` sur l'`eleveId` reçu → **404**
- [x] 4.8 `api/ai/chat` — les outils d'emploi du temps (lister classes/créneaux, suggérer, restructurer) sont bornés au périmètre enseignant (`withinTeacherScope` dans `schedule-tool.ts`, revendications étendues à `id`/`tenantId`)
- [x] Cible `test:isolation` ajoutée à `package.json`
- [ ] **Exécution** de la suite — **bloquée** par l'écart d'enum `Role` (voir « Blocage » ci-dessous)

### Clôture
- [x] `docs/AUDIT_FILTRAGE_ENSEIGNANTS.md` § 6 — statut « traité » + § 6.1 (chantier 6)
- [x] `docs/FORMATION_ENSEIGNANTS.md` — encadré 📱 « Application mobile » remplacé par la mention d'alignement
- [x] `docs/FORMATION_ENSEIGNANTS.md` — tableau § 3 : les modules mobiles sont couverts par la mention d'ensemble (le filtrage est identique au Web, un tableau distinct n'aurait rien ajouté)

---

## 7 bis. Blocage constaté à la clôture — écart d'enum `Role` (hors plan)

**Ce qui est livré** : l'intégralité du code du plan (chantiers 0 à 5, sauf 4.5 qui
attend une décision métier). `npx tsc --noEmit` → **0 erreur**, `npx next lint` →
`✔ No ESLint warnings or errors`, `npx prisma validate` → schéma valide.

**Ce qui bloque** : la base configurée (`DATABASE_URL`, Supabase hébergé) contient
**16 valeurs** dans l'enum Postgres `Role`, dont **5 absentes** de
`prisma/schema.prisma` : `SUPERVISOR`, `CAISSIER`, `INSPECTOR`, `SUBJECT_LEAD`,
`SITE_MANAGER`. Le client Prisma refuse de désérialiser une ligne `User` portant
l'une de ces valeurs :

```
Value 'SUPERVISOR' not found in enum 'Role'
  → prisma.user.findMany() lève
  → connexion et lecture des utilisateurs en échec pour ces comptes
```

Constat mesuré : 4 utilisateurs `SUPERVISOR` sur l'établissement client, présents
également dans les tenants de démonstration et de test. **Aucun test d'isolation
ne peut s'exécuter** (l'authentification échoue avant d'atteindre les contrôles de
périmètre), et **aucun seed ne peut s'exécuter** non plus (il commence par un
`user.upsert`).

Aucune écriture n'a été faite sur la base hébergée : elle contient les données
réelles de l'établissement client (`tenant-ambouli`), et l'arbitrage suivant
appartient à la direction technique.

| Option | Contenu | Coût / risque |
|---|---|---|
| **A — aligner** | Ajouter les 5 valeurs à `enum Role` + à `ROLE_PERMISSIONS`, puis `ALTER TYPE "Role" ADD VALUE` | Touche un schéma **partagé avec la base client** ; chaque rôle exige sa matrice de permissions (`roleHasPermission` renvoie `undefined` sinon → crash) |
| **B — isoler** | Exécuter la suite sur une base dédiée (tenant `e2e-test` déjà présent, enum aligné) | Aucun impact sur la base client ; ne corrige pas le bug de connexion des comptes `SUPERVISOR` |

**Recommandation** : traiter l'option A comme un chantier à part entière (c'est un
bug de production : les porteurs de ces rôles ne peuvent pas se connecter), et
livrer les tests d'isolation (option B) dès qu'une base alignée est disponible.

---
## 8. Points de vigilance transverses

| # | Vigilance | Détail |
|---|---|---|
| 1 | **Ne jamais étaler un fragment de filtre** | `mergeFilters` encapsule dans `AND`. Un `OR` de premier niveau (recherche textuelle, `OR` de périodes) écraserait sinon le filtre de site — silencieusement. |
| 2 | **Ne jamais substituer, toujours combiner** | Le périmètre enseignant **s'ajoute** au filtre de site, il ne le remplace pas. |
| 3 | **Fail-closed** | Périmètre vide ⇒ **aucune** donnée, jamais « tout le tenant ». Les helpers renvoient `NO_TEACHER_SCOPE_ID` dans ce cas. |
| 4 | **Rôles non enseignants intacts** | Les helpers renvoient `{}` pour les admins : **vérifier systématiquement** qu'un admin conserve son accès complet après chaque correctif. |
| 5 | **Cache `unstable_cache`** | Le périmètre doit être passé en **argument** de la fonction cachée, jamais capturé par closure (cf. `dashboard/page.tsx`). |
| 6 | **`404` en lecture, `403` en écriture** | Cohérence à respecter partout (cf. § 6). |
| 7 | **Le mobile n'exige pas de republication** | L'app consomme l'API : une correction serveur prend effet **immédiatement**, sans mise à jour de l'application. |

---

## 9. Résumé exécutable

| Chantier | Volume | Priorité | Bloqueur |
|---|---|---|---|
| **0 — Prérequis** | 5 tâches | 🔴 Bloquant | — |
| **3 — Mobile** | 12 routes | 🔴 Critique | `teacherEmploiTempsFilter` (3.10) |
| **4 — Web résiduel** | 9 points | 🟠 Élevée | Décision métier (4.5) |
| **5 — Tests d'isolation** | 11 scénarios | 🔵 Verrouillage | Seed à 2 profs / 2 sites |

### Les 3 actions à effet le plus immédiat

1. **`mobile/appel` (3.6)** — c'est la seule route mobile qui **écrit** des données (absences). Un prof peut aujourd'hui marquer absent un élève d'une classe qui n'est pas la sienne.
2. **`mobile/eleves` + `mobile/notes` (3.1, 3.3)** — l'annuaire et les notes de tout le site, exposés sur mobile.
3. **`api/eleves` (4.1)** — l'export CSV permet d'exfiltrer 5 000 lignes d'identités d'un coup.

---

*Plan opérationnel interne — EcolPro.*
*Référence amont : `docs/AUDIT_FILTRAGE_ENSEIGNANTS.md` § 6.*