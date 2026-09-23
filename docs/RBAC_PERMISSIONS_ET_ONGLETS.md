# RBAC — permissions, gardes et accès aux onglets

> **Ce document répond à une question précise** : *comment l'accès aux écrans
> (et en particulier aux onglets des Paramètres) est-il décidé selon le rôle ?*
>
> Toutes les tables de ce document sont **générées depuis le code**, pas
> recopiées : `ROLE_PERMISSIONS` (`src/lib/rbac.ts`) et
> `PARAMETRES_TAB_PERMISSIONS` (`src/lib/parametres-tabs.ts`). Les chiffres et
> listes de rôles sont ceux exécutés par `npx vitest run`.

Date : 23/09/2026 — branche `main`.

---

## 1. Vue d'ensemble : quatre couches, dans cet ordre

| # | Couche | Fichier | Question à laquelle elle répond |
|---|---|---|---|
| 1 | **Source de vérité** | `src/lib/rbac.ts` → `ROLE_PERMISSIONS`, `roleHasPermission` | *Qui a le droit, en principe ?* |
| 2 | **Périmètre (données)** | `src/lib/site-scope.ts` → `siteFilterForModel`, `personalScopeFilter`, `eleveScopeFilter` | *Sur quelles lignes ?* |
| 3 | **Gardes serveur** | `checkPermission` / `checkAnyPermission` / `authorize` / `authorizeSuperAdmin` (routes) · `guardPage` / `guardRoles` / `guardStaff` (pages) | *Refuser ou laisser passer ?* |
| 4 | **Interface** | `Sidebar`, `ParametresTabs` (`allowedTabs`) | *Que proposer à l'écran ?* |

> **Règle d'or n° 1** — *une permission est une condition nécessaire, jamais
> suffisante*. Le périmètre (couche 2) reste appliqué après la garde.
>
> **Règle d'or n° 2** — *l'interface ne protège rien*. Masquer un onglet ou un
> bouton est un confort : la décision d'accès est prise par la couche 3.
>
> **Règle d'or n° 3** — *fail-closed*. En cas d'information manquante (rôle,
> site, identité), on refuse : `DENY_ALL` plutôt qu'un filtre vide.

---

## 2. La matrice des permissions — `src/lib/rbac.ts`

### 2.1 Format

```
<module>:<action>      ex.  eleves:write, bulletins:publish, notes:manage
<module>:*             « toutes les actions du module »
*                      « tout » (réservé au super-admin)
```

`roleHasPermission(role, permission)` est la **seule** fonction de résolution :

```ts
export function roleHasPermission(role: Role, permission: Permission): boolean {
  const perms = ROLE_PERMISSIONS[role] ?? [];
  if (perms.includes("*")) return true;          // super-admin
  if (perms.includes(permission)) return true;   // action explicite
  const moduleName = permission.split(":")[0];
  if (perms.includes(`${moduleName}:*`)) return true; // joker de module
  return false;
}
```

> ⚠️ **Piège du joker.** `notes:*` satisfait *n'importe quelle* action du module —
> y compris une action ajoutée plus tard. C'est pour cela que `TEACHER` et
> `CLASS_TEACHER` portent `notes:read` + `notes:write` et **non** `notes:*` :
> sinon ils hériteraient silencieusement de `notes:manage` (pilotage des
> périodes et des règles d'appréciation, réservé à la direction).

### 2.2 Matrice actuelle, rôle par rôle

| Rôle | Permissions (exactement, telles que déclarées) |
|---|---|
| `SUPER_ADMIN` | `*` |
| `TENANT_ADMIN` | `eleves:*`, `parents:*`, `enseignants:*`, `classes:*`, `matieres:*`, `notes:*`, `evaluations:*`, `bulletins:*`, `absences:*`, `examens:*`, `emploi-du-temps:*`, `communication:*`, `messages:*`, `vie-scolaire:*`, `admissions:*`, `rh:*`, `finance:*`, `inventaire:*`, `alumni:*`, `orientation:*`, `cours:*`, `analytics:*`, `rapports:*`, `documents:*`, `etablissement:write`, `ai:*`, `audit:read` |
| `PRINCIPAL` | idem direction **sauf** `rh:*` → `rh:read` et `finance:*` → `finance:read` ; **pas** `etablissement:write`, **pas** `audit:read` |
| `SECRETARY` | `eleves:*`, `parents:*`, `classes:read`, `matieres:read`, `absences:*`, `emploi-du-temps:*`, `communication:read`, `communication:send`, `messages:*`, `admissions:*`, `examens:read`, `inventaire:read`, `documents:*`, `alumni:read`, `bulletins:read`, `rapports:read`, `vie-scolaire:read`, `vie-scolaire:write` |
| `CLASS_TEACHER` | `eleves:read`, `classes:read`, `matieres:read`, `notes:read`, `notes:write`, `evaluations:*`, `absences:*`, `bulletins:read`, `bulletins:write`, `emploi-du-temps:read`, `messages:*`, `cours:*`, `vie-scolaire:*`, `orientation:read`, `orientation:write`, `analytics:read`, `examens:read`, `parents:read`, `ai:teacher` |
| `TEACHER` | `eleves:read`, `classes:read`, `matieres:read`, `notes:read`, `notes:write`, `evaluations:*`, `absences:read`, `absences:write`, `bulletins:read`, `emploi-du-temps:read`, `messages:*`, `cours:*`, `analytics:read`, `examens:read`, `ai:teacher` |
| `COUNSELOR` | `eleves:read`, `absences:read`, `vie-scolaire:*`, `orientation:*`, `messages:*`, `parents:read`, `communication:read`, `analytics:read` |
| `NURSE` | `eleves:read`, `absences:read`, `messages:read`, `messages:write` |
| `ACCOUNTANT` | `finance:*`, `rh:read`, `paie:write`, `eleves:read`, `parents:read`, `inventaire:*`, `analytics:read`, `messages:*`, `rapports:read` |
| `PARENT` | `bulletins:read`, `absences:read`, `notes:read`, `messages:*`, `communication:read`, `cours:read`, `orientation:read`, `emploi-du-temps:read`, `ai:parent` |
| `STUDENT` | `bulletins:read`, `absences:read`, `notes:read`, `messages:read`, `messages:reply`, `communication:read`, `cours:read`, `emploi-du-temps:read` |

## 3. Permissions dédiées et arbitrages métier

Ces permissions ont été introduites pour distinguer des actions que le même
module mélangeait. Elles sont **volontairement étroites** : toute extension est
une décision explicite, tracée dans `docs/AUDIT_RBAC_ROLES.md`.

| Permission | Accordée à | Ce qu'elle ouvre | Décision |
|---|---|---|---|
| `notes:manage` | `TENANT_ADMIN`, `PRINCIPAL` (via `notes:*`) | ouvrir/clôturer une période, définir les règles d'appréciation | `notes:write` (saisie) reste aux enseignants — constat E3 |
| `etablissement:write` | `TENANT_ADMIN` (`SUPER_ADMIN` via `*`) | signature, cachet, nom du chef d'établissement (`PUT /api/parametres/signature-cachet`, `POST /api/parametres/upload-signature`) | constat **C3** |
| `paie:write` | `ACCOUNTANT` | générer un bulletin de paie (`POST /api/rh/[id]`) | **B1** (23/09/2026) : le comptable perd l'écriture RH (salaire, RIB, contrats) |
| `vie-scolaire:read` + `:write` | `SECRETARY` | ouvrir `/vie-scolaire`, créer convocations et incidents | **D1** (23/09/2026) |

Arbitrages sans changement de permission :

| Point | Décision | Effet |
|---|---|---|
| Publication des bulletins | **A1** | `bulletins:publish` retiré de `CLASS_TEACHER` ; publier est un acte de direction. Le PP garde `bulletins:write` |
| Radiation d'un élève | **C1** | `SECRETARY` conserve `eleves:delete`, qui ne couvre qu'un **soft delete** réversible et audité. Une purge physique exigerait une permission distincte (`eleves:purge`) |

---

## 4. Les onglets des Paramètres : la partie qui répond à votre question

### 4.1 Le principe

`/parametres` n'est **pas** réservé « en bloc » à la direction. La politique
tient dans un seul fichier : **`src/lib/parametres-tabs.ts`**.

```ts
export const PARAMETRES_TAB_PERMISSIONS: Record<ParametresTab, Permission> = {
  etablissement: "etablissement:write",
  annees:        "etablissement:write",
  sites:         "etablissement:write",
  signature:     "etablissement:write",
  utilisateurs:  "enseignants:write",
  parents:       "parents:read",
  classes:       "classes:read",
  matieres:      "matieres:read",
  doublons:      "eleves:write",
  appreciations: "notes:manage",
  periodes:      "notes:manage",
  tarifs:        "finance:read",
};

export function allowedParametresTabs(role: Role): ParametresTab[] {
  return (Object.keys(PARAMETRES_TAB_PERMISSIONS) as ParametresTab[])
    .filter((tab) => roleHasPermission(role, PARAMETRES_TAB_PERMISSIONS[tab]));
}
```

Le type `Record<ParametresTab, Permission>` est **exhaustif** : ajouter un onglet
sans lui donner de permission ne compile pas.

### 4.2 De la permission aux rôles (qui voit quel onglet)

| Onglet | Permission exigée | Rôles autorisés |
|---|---|---|
| Établissement | `etablissement:write` | `SUPER_ADMIN`, `TENANT_ADMIN` |
| Années scolaires | `etablissement:write` | `SUPER_ADMIN`, `TENANT_ADMIN` |
| Sites | `etablissement:write` | `SUPER_ADMIN`, `TENANT_ADMIN` |
| Signature & cachet | `etablissement:write` | `SUPER_ADMIN`, `TENANT_ADMIN` |
| Utilisateurs | `enseignants:write` | `SUPER_ADMIN`, `TENANT_ADMIN`, `PRINCIPAL` |
| Parents | `parents:read` | `SUPER_ADMIN`, `TENANT_ADMIN`, `PRINCIPAL`, `SECRETARY`, `CLASS_TEACHER`, `COUNSELOR`, `ACCOUNTANT` |
| Classes | `classes:read` | `SUPER_ADMIN`, `TENANT_ADMIN`, `PRINCIPAL`, `SECRETARY`, `CLASS_TEACHER`, `TEACHER` |
| Matières | `matieres:read` | `SUPER_ADMIN`, `TENANT_ADMIN`, `PRINCIPAL`, `SECRETARY`, `CLASS_TEACHER`, `TEACHER` |
| Doublons | `eleves:write` | `SUPER_ADMIN`, `TENANT_ADMIN`, `PRINCIPAL`, `SECRETARY` |
| Appréciations | `notes:manage` | `SUPER_ADMIN`, `TENANT_ADMIN`, `PRINCIPAL` |
| Périodes | `notes:manage` | `SUPER_ADMIN`, `TENANT_ADMIN`, `PRINCIPAL` |
| Tarifs | `finance:read` | `SUPER_ADMIN`, `TENANT_ADMIN`, `PRINCIPAL`, `ACCOUNTANT` |

### 4.3 Vue par rôle (ce que voit un utilisateur connecté)

| Rôle | Onglets visibles | Nb |
|---|---|---|
| `SUPER_ADMIN` | tous | 12 |
| `TENANT_ADMIN` | tous | 12 |
| `PRINCIPAL` | utilisateurs, parents, classes, matières, doublons, appréciations, périodes, tarifs | 8 |
| `SECRETARY` | parents, classes, matières, doublons | 4 |
| `CLASS_TEACHER` | parents, classes, matières | 3 |
| `TEACHER` | classes, matières | 2 |
| `ACCOUNTANT` | parents, tarifs | 2 |
| `COUNSELOR` | parents | 1 |
| `NURSE` | — | 0 |
| `PARENT` | — | 0 |
| `STUDENT` | — | 0 |

> Un rôle à **0 onglet** n'a rien à faire sur l'écran : la page le redirige
> vers `/dashboard` (voir 4.4).

### 4.4 Où c'est appliqué, concrètement

**Côté serveur — la page** (`src/app/(dashboard)/parametres/page.tsx`) :

```tsx
const allowedTabs = allowedParametresTabs(session.user.role);
if (allowedTabs.length === 0) redirect("/dashboard");
// …
<ParametresTabs … allowedTabs={allowedTabs} />
```

**Côté client — le composant** (`src/components/parametres/ParametresTabs.tsx`) :
les groupes d'onglets sont filtrés par `allowedTabs`, un groupe devenu vide
disparaît, et l'onglet actif par défaut est le premier autorisé.

```tsx
const groups = tabGroups
  .map((g) => ({ ...g, tabs: g.tabs.filter((t) => !allowedTabs || allowedTabs.includes(t.id)) }))
  .filter((g) => g.tabs.length > 0);
const firstTab = groups[0]?.tabs[0]?.id ?? "etablissement";
```

Trois garanties se cumulent :

1. **le type** empêche un onglet sans permission (compilation) ;
2. **la page** ne transmet que les onglets autorisés → le composant ne peut pas
   les afficher même si son code change ;
3. **les actions serveur** de chaque onglet (`src/lib/actions/parametres.ts`)
   refusent de toute façon toute écriture : `Permission refusée` si le rôle n'est
   pas dans la liste attendue. Masquer un onglet n'est jamais la protection.

Différence assumée, à connaître : la prop `canManage` (boutons de création /
édition) reste calculée sur les **rôles de direction**
(`TENANT_ADMIN` / `SUPER_ADMIN` / `PRINCIPAL`). Un secrétariat voit donc les
onglets parents / classes / matières **en lecture** alors que le serveur lui
autorise l'écriture sur les parents. C'est conservateur (jamais permissif) et
c'est le chantier **UI1** d'`AUDIT_RBAC_ROLES.md` : faire dériver ces boutons de
la même matrice.

---

## 5. Les gardes, et laquelle utiliser

| Contexte | Garde | Comportement |
|---|---|---|
| Route API, un seul privilège | `checkPermission(role, "module:action")` | `NextResponse` 403 auditée, ou `null` |
| Route API, « l'un **ou** l'autre » | `checkAnyPermission(role, [...])` | idem (OU logique) — ex. `POST /api/rh/[id]` : `rh:write` **ou** `paie:write` |
| Route API, cas général | `authorize({ permission })` | union discriminée : `gate.ok`, puis `gate.tenantId` / `gate.role` |
| Outillage plateforme | `authorizeSuperAdmin()` | 403 si le rôle n'est pas `SUPER_ADMIN` |
| Page, permission de module | `guardPage(session, "module:read")` | redirige `/login`, `/select-tenant` ou `/dashboard` |
| Page, rôles explicites | `guardRoles(session, ["TENANT_ADMIN", …])` | idem + liste de rôles |
| Page, **réservée au personnel** | `guardStaff(session, "module:read")` | idem + refuse `PARENT` / `STUDENT` |

Exemple de route (le motif à recopier) :

```ts
const session = await auth();
if (!session?.user?.tenantId) {
  return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
}
const denied = checkPermission(session.user.role, "eleves:write");
if (denied) return denied;
```

Exemple de page :

```tsx
const session = await auth();
if (!session?.user?.tenantId) redirect("/login");
guardPage(session, "eleves:read");
```

> `checkPermission` journalise chaque refus (`auditFire` → `auditLog`). Un
> contrôle de rôle écrit « à la main » ne journalise rien : préférer une
> permission dédiée, comme `etablissement:write` l'a fait pour
> `signature-cachet`.

### Quand `guardStaff` plutôt que `guardPage` ?

Une famille (`PARENT`, `STUDENT`) détient `absences:read`, `notes:read`,
`bulletins:read`… Ces permissions ouvrent la **lecture** de ses propres données,
pas l'accès aux **écrans de suivi de l'établissement**. Un écran dont les
requêtes ne peuvent pas être bornées à un élève (grille de saisie, liste
nominative de classe, suivi global des absences) passe donc sur `guardStaff`.
C'est le cas de `/notes`, `/notes/bulletins`, `/absences`, `/absences/appel`.

Un futur « espace famille » (mes notes, mes absences, mes factures) sera un
**module dédié** appliquant `eleveScopeFilter` — jamais une exception à la garde.

---

## 6. Le second axe : le périmètre (sans lui, la permission ne suffit pas)

`src/lib/site-scope.ts` décide **quelles lignes** un rôle peut lire, selon son
`SiteScope` : `ALL` (direction), `SITES` (personnel rattaché à des sites),
`RELATION` (familles), `NONE` (provisionnement incomplet → rien).

| Helper | Ce qu'il couvre | À utiliser pour |
|---|---|---|
| `siteFilterForModel("modele", claims)` | le site uniquement | données de personnel/direction |
| `personalScopeFilter(claims, "eleve")` | le périmètre personnel (parent → ses enfants, élève → lui-même) | modèle ayant une relation **directe** vers `Eleve` |
| `eleveScopeFilter(claims, "eleve")` | **site + personnel** | toute route accessible à `PARENT` / `STUDENT` |
| `mergeFilters(a, b, …)` | fusion **sans perte** des fragments `AND` | dès qu'on combine deux filtres |

> ⚠️ **Piège n° 1.** Pour `PARENT` et `STUDENT`, `siteFilterForModel` renvoie
> **`{}`** (leur périmètre n'est pas le site). Une route qui n'applique que
> `siteFilterForModel` expose donc **tout le tenant** à une famille.
>
> ⚠️ **Piège n° 2.** `personalScopeFilter` n'accepte qu'une relation **d'un seul
> niveau** vers `Eleve`. Pour un modèle plus profond (`Paiement → Facture →
> Eleve`), il faut un contrôle d'appartenance explicite.

Deux traitements possibles pour une famille, selon la nature de la ressource :

| Nature | Traitement | Exemple |
|---|---|---|
| Donnée **personnelle** de l'élève | filtre de périmètre → la famille voit ses enfants | `bulletins/list`, `factures/[id]/pdf`, `absences-chart` |
| **Artefact de classe / outil de personnel** | refus explicite `403` (API) ou `guardStaff` (page) | `bulletins/matrice`, `rapport-classe`, `feuille-presence`, `/notes`, `/absences` |

---

## 7. Ce qui verrouille ces règles (tests)

| Fichier | Cas | Ce qu'il empêche de réintroduire |
|---|---|---|
| `src/lib/rbac.test.ts` | 13 | `STUDENT` avec `cours:write` ; familles en écriture ; réélargissement de `notes:*` ; retour de `bulletins:publish` au PP ; `rh:*` au comptable ; arbitrages A1/B1/C1/D1 |
| `src/lib/parametres-tabs.test.ts` | 6 | un onglet visible par un rôle qui n'y a pas droit ; un onglet devenu invisible pour tous ; une famille qui entre dans `/parametres` |
| `src/app/api/rbac-mutations.test.ts` | 21 | les routes P0/P1 sans garde ; les artefacts de classe ouverts aux familles ; les documents financiers ouverts à tout rôle ; `finance:write` accordé par `finance:read` |

```bash
npx vitest run src/lib/rbac.test.ts src/lib/parametres-tabs.test.ts \
  src/app/api/rbac-mutations.test.ts     # 40 cas RBAC
npx vitest run                            # suite complète
npx tsc --noEmit && npx next lint         # avant commit
```

---

## 8. Recettes

### 8.1 Ajouter un onglet aux Paramètres

1. Créer le composant d'onglet dans `src/components/parametres/`.
2. Ajouter son identifiant au type `ParametresTab` **et** à
   `PARAMETRES_TAB_PERMISSIONS` (`src/lib/parametres-tabs.ts`) → le compilateur
   refuse un onglet sans permission.
3. Déclarer le `TabsTrigger`/`TabsContent` dans `ParametresTabs.tsx`.
4. Ajouter le cas de test correspondant dans `parametres-tabs.test.ts`.

### 8.2 Ajouter une permission

1. L'ajouter aux rôles concernés dans `ROLE_PERMISSIONS` (`src/lib/rbac.ts`).
2. Poser la garde : `checkPermission(role, "module:action")`.
3. **Ne pas** élargir un `module:*` existant pour « aller plus vite » : préférer
   l'action explicite (cf. `notes:read`/`notes:write`).
4. Ajouter un cas dans `rbac.test.ts` (accordé **et** refusé).

### 8.3 Restreindre un rôle

Modifier sa liste dans `ROLE_PERMISSIONS`, puis vérifier les trois impacts :
l'API (403), la page (`guardPage` → redirection), l'UI (`allowedTabs`, menu).
Lancer la suite : les tests RBAC échouent là où une capacité a disparu.

### 8.4 Ajouter une route API ou une page

- Route : `auth()` → 401 si pas de tenant → `checkPermission` → **puis**
  `siteFilterForModel` / `eleveScopeFilter` dans le `where`.
- Page : `auth()` → `redirect("/login")` → `guardPage` (ou `guardStaff`).
- Vérifier avec les commandes de l'annexe qu'aucune route/page ne reste sans
  garde.

### 8.5 Checklist de revue « accès »

- [ ] La route/la page a une garde **de permission ou de rôle** (pas seulement
      `auth()`).
- [ ] Le `where` Prisma porte un filtre de **périmètre** adapté au rôle le plus
      faible qui peut atteindre l'endpoint.
- [ ] Un rôle à périmètre personnel ne peut pas lire de données nominatives
      d'un tiers (tester `PARENT`).
- [ ] Les refus passent par `checkPermission`/`checkAnyPermission` (donc
      **audités**), pas par un `if (role !== …)` ad hoc.
- [ ] L'UI ne montre que ce que le serveur accepte (`allowedTabs`, menu) — sans
      en faire la protection.

---

## 9. Pièges connus et divergences restantes

| # | Piège | Conséquence | Parade |
|---|---|---|---|
| 1 | Un `module:*` couvre **toute** action du module, même future | élargissement silencieux des droits | actions explicites (`notes:read` + `notes:write`) |
| 2 | `siteFilterForModel` est **neutre** pour `PARENT`/`STUDENT` | fuite de tout le tenant | `eleveScopeFilter` sur toute route accessible aux familles |
| 3 | Une permission ne borne pas les **lignes** | un parent lisant `bulletins/matrice` verrait la classe | garde (403 / `guardStaff`) ou filtre de périmètre |
| 4 | L'UI n'est pas une protection | boutons/onglets visibles ≠ droit | la garde serveur décide ; l'UI reflète la matrice |
| 5 | Contrôle de rôle écrit à la main | refus **non journalisé** | permission dédiée + `checkPermission` |

Divergences encore ouvertes (voir `AUDIT_RBAC_ROLES.md` § 8 P2) :

- **UI1** — les boutons/modales des onglets et des vues suivent `canManage`
  (rôles de direction) et non la matrice : un secrétariat peut voir
  parents / classes / matières en lecture alors que le serveur lui autorise
  l'écriture sur les parents. Conservateur, jamais permissif.
- **UI2** — la `Sidebar` filtre ses entrées par des listes `roles:` codées en
  dur (`src/components/layout/Sidebar.tsx`) et non par `ROLE_PERMISSIONS` :
  un rôle peut donc voir une entrée de menu qui le redirige ensuite
  (`/notes`, `/absences` pour une famille). La cible est de faire dériver le
  menu de la matrice, comme les onglets des Paramètres le font.
- **P1 § 5.2** — les lectures nominatives restantes (`dashboard` agrégats,
  `emploi-du-temps`, `messages`) sont bornées par site/périmètre mais méritent
  une revue « rôle le plus faible » lors du prochain passage.

---

## 10. Annexe — vérifier l'état réel

```bash
# 1. Routes API sans aucun contrôle de permission
for f in $(find src/app/api -name 'route.ts'); do
  grep -qE 'checkPermission\(|checkAnyPermission\(|authorize\(|authorizeSuperAdmin|role !== |role === ' "$f" \
    || echo "NO-PERM-CHECK: $f"
done

# 2. Pages du dashboard sans garde
grep -L -E 'guardPage|guardRoles|guardStaff' $(find 'src/app/(dashboard)' -name page.tsx)

# 3. Mode d'emploi des onglets
cat src/lib/parametres-tabs.ts

# 4. Matrice des permissions par rôle
sed -n '/export const ROLE_PERMISSIONS/,/^};/p' src/lib/rbac.ts

# 5. Tests RBAC (doivent tous passer)
npx vitest run src/lib/rbac.test.ts src/lib/parametres-tabs.test.ts \
  src/app/api/rbac-mutations.test.ts
```

### Fichiers de référence

| Fichier | Contenu |
|---|---|
| `src/lib/rbac.ts` | `ROLE_PERMISSIONS`, `roleHasPermission`, `checkPermission`, `checkAnyPermission`, `authorize`, `authorizeSuperAdmin` |
| `src/lib/parametres-tabs.ts` | type `ParametresTab`, `PARAMETRES_TAB_PERMISSIONS`, `allowedParametresTabs` |
| `src/lib/guard-page.ts` | `guardPage`, `guardRoles`, `guardStaff` |
| `src/lib/site-scope.ts` | `resolveSiteScope`, `siteFilterForModel`, `personalScopeFilter`, `eleveScopeFilter`, `mergeFilters`, `isRelationScopedRole` |
| `src/components/parametres/ParametresTabs.tsx` | rendu des onglets filtrés (`allowedTabs`) |
| `src/components/layout/Sidebar.tsx` | menu (encore piloté par des listes `roles:` — UI2) |
| `docs/AUDIT_RBAC_ROLES.md` | audit complet (constats, décisions A1/B1/C1/D1, état d'application) |




