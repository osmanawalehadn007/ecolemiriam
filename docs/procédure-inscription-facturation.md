# Procédure d'inscription avec facturation — Spécification exacte implémentée

## Vue d'ensemble du flux

Le processus d'inscription est un **workflow à statuts** piloté par le modèle `Candidature`, avec génération automatique de facture au passage à `ADMIS` et création de l'élève au passage à `INSCRIT` (après paiement). Le flux complet :

```
SOUMISE → DOSSIER_COMPLET → EN_EXAMEN → ADMIS (génère facture) → [paiement] → INSCRIT (crée l'élève)
```

**Fichiers clés à examiner :**

- `src/app/api/admissions/route.ts` — POST création candidature + GET liste
- `src/app/api/admissions/[id]/route.ts` — PATCH transitions de statut (cœur du système)
- `src/lib/admissions/mois-scolarite.ts` — logique du mois facturé
- `src/lib/admissions/pieces-justificatives.ts` — pièces requises
- `src/components/admissions/AdmissionsView.tsx` — UI complète
- `src/lib/actions/facture.ts` — `enregistrerPaiement`
- `src/app/(dashboard)/admissions/page.tsx` — page serveur

---

## 1. Création de la candidature (POST `/api/admissions`)

### Import automatique des classes

Les classes sont **chargées côté serveur** dans `admissions/page.tsx` (lignes 37-48) via `prisma.classe.findMany` filtré par `tenantId` + `siteFilterForModel("classe", session.user)`, avec `select: { id, nom, niveau, site: { select: { nom } } }`. Elles sont passées au composant `AdmissionsView` puis au `CandidatureForm`.

**Nuance critique — classeId vs classeVoulue :**

- Le formulaire envoie `classeId` (l'ID de la classe sélectionnée dans le `<select>`) — voir `AdmissionsView.tsx` lignes 163-179.
- Si aucune classe n'existe en DB (`classes.length === 0`), un `<Input>` texte libre affiche `classeVoulue` à la place (ligne 181).
- Côté serveur (POST route.ts lignes 109-129), si `classeId` est fourni ET qu'une session dashboard existe, on **résout la classe** par :

  ```ts
  prisma.classe.findFirst({
    where: { id: data.classeId, tenantId, ...siteFilterForModel("classe", session.user) },
    select: { nom: true, siteId: true },
  })
  ```

  Le `classeVoulue` est alors **dérivé du nom de la classe**, et surtout **le `siteId` de la candidature est hérité du `siteId` de la classe** (ligne 128 : `siteId = classe.siteId`).

- **Garde-fou** : si la classe n'est pas trouvée dans le périmètre de l'utilisateur → erreur 400 « Classe introuvable ou hors de votre périmètre ».
- En soumission **publique** (pas de session), `classeVoulue` est en texte libre, `siteId` reste `null`.

**Nuance multi-sites** (`AdmissionsView.tsx` ligne 90) : si plusieurs sites sont présents dans la liste des classes, le nom du site est affiché à côté du nom de classe dans le `<select>` pour lever l'ambiguïté entre classes homonymes. On ne dédoublonne **pas** par nom (deux sites peuvent avoir une classe homonyme).

**Rate limiting** : 5 candidatures / 5 min par IP (POST route.ts lignes 63-70).

**Résolution du tenant** : via session dashboard, sinon via le subdomain du host (`host.split(".")[0]` → `prisma.tenant.findUnique({ where: { slug } })`).

---

## 2. Transitions de statut (PATCH `/api/admissions/[id]`)

### Schéma de validation (`UpdateSchema`, lignes 13-23)

- `statut` : enum `["SOUMISE", "DOSSIER_COMPLET", "EN_EXAMEN", "ADMIS", "REFUSE", "INSCRIT", "ANNULE"]`
- `moisScolarite` : string au format `"YYYY-MM"` validé par `isMoisScolariteValide` (regex `/^\d{4}-(0[1-9]|1[0-2])$/`). **Utilisé uniquement au passage à ADMIS**.

### Permission

`checkPermission(session.user.role, "admissions:write")`. Le statut `INSCRIT` est accessible au **comptable** (`ACCOUNTANT`) en bout-en-bout — voir `AdmissionsView.tsx` lignes 327-330 (`canConfirmEnrollment` = `TENANT_ADMIN` | `SUPER_ADMIN` | `ACCOUNTANT`).

### Gate pièces justificatives (passage à EN_EXAMEN, lignes 58-70)

- 3 pièces **obligatoires** : `acte_naissance`, `photo_identite`, `carte_identite_parent` (voir `pieces-justificatives.ts`).
- 2 pièces **optionnelles** : `bulletin_precedent`, `certificat_transfert`.
- On **fusionne** les documents existants avec ceux envoyés dans le PATCH (dédoublonnage par `nom`), puis `piecesRequisesPresentes` vérifie la présence de tous les IDs obligatoires.
- Côté UI, le bouton « Convocation examen » est **désactivé** si pièces manquantes (`AdmissionsView.tsx` lignes 339-343), avec un libellé différent (`summonExamMissingDocs`).

---

## 3. Génération automatique de la facture (passage à ADMIS)

**Condition** : `data.statut === "ADMIS" && candidature.statut !== "ADMIS"` (ligne 81) — donc seulement à la **première** transition vers ADMIS (idempotent).

### Étapes exactes (lignes 81-168)

**a) Idempotence** — on vérifie qu'aucune facture n'existe déjà pour cette candidature :

```ts
prisma.facture.findFirst({ where: { candidatureId: candidature.id, tenantId } })
```

**b) Résolution du niveau tarifaire** (lignes 89-103) — **NUANCE MAJEURE** :

- `TarifNiveau` est indexé par **NIVEAU** pédagogique (`"Terminale"`, `"CM2"`…), alors que `candidature.classeVoulue` contient le **NOM** de la classe (`"Terminale A"`).
- On résout d'abord la classe par :

  ```ts
  prisma.classe.findFirst({
    where: { tenantId, nom: candidature.classeVoulue, ...(candidature.siteId ? { siteId: candidature.siteId } : {}) },
    select: { niveau: true },
  })
  ```

  pour récupérer son `niveau`.
- **Fallback** : si la classe n'est pas trouvée (candidature publique en texte libre), on utilise `classeVoulue` tel quel comme niveau.

**c) Recherche du tarif** (lignes 110-119) :

```ts
prisma.tarifNiveau.findFirst({
  where: {
    tenantId,
    niveau: niveauTarif,
    annee: candidature.annee,
    actif: true,
    OR: [{ siteId: candidature.siteId ?? null }, { siteId: null }],
  },
  orderBy: { siteId: { sort: "desc", nulls: "last" } }, // privilégier le tarif spécifique au site
})
```

**Nuance** : le `OR` accepte soit un tarif spécifique au site, soit un tarif partagé (`siteId: null`). L'`orderBy: { siteId: { sort: "desc", nulls: "last" } }` fait que **le tarif spécifique au site gagne** s'il existe. Sans `nulls: "last"`, Postgres trie les NULLs en premier en `DESC` — le tarif partagé écraserait le tarif spécifique (bug corrigé le 2026-09-07).

**d) Garde-fou tarif** (lignes 124-136) — **BLOCAGE HARD** :

- `fraisInscription = tarif?.fraisInscription ?? 0`
- `mensualite = tarif?.mensualite ?? 0`
- `montantTotal = fraisInscription + mensualite`
- Si `!tarif || montantTotal <= 0` → **erreur 400** avec message explicite demandant de configurer les tarifs dans Paramètres → Tarifs. **L'admission est refusée**, aucune facture vide n'est créée.

**e) Choix du mois de scolarité** (lignes 142-143) :

- `moisScolarite = data.moisScolarite ?? moisScolariteDefaut()`
- `moisScolariteDefaut()` (voir `mois-scolarite.ts` lignes 52-59) : en août (mois 7) ou septembre (mois 8) → `"YYYY-09"` ; sinon → mois en cours `"YYYY-MM"`.
- Côté UI, un **modal `AdmitMoisModal`** s'ouvre avant l'admission (`AdmissionsView.tsx` lignes 540-550, 599) proposant les 12 mois de l'année scolaire via `optionsMoisScolarite()` (septembre → août), avec le défaut pré-sélectionné.
- `formatMoisScolarite("2026-09")` → `"Septembre 2026"` (utilisé dans le libellé de la facture).

**f) Numéro de facture** (lignes 147-150) :

```ts
const factureCount = await prisma.facture.count({ where: { tenantId } });
const numeroFacture = `FAC-${new Date().getFullYear()}-${String(factureCount + 1).padStart(5, "0")}`;
```

Format : `FAC-2026-00028`. **NUANCE** : c'est un count global tenant + 1, pas un sequence DB — il peut y avoir des collisions si deux admissions concurrentes (race condition non gérée).

**g) Création de la facture** (lignes 152-164) :

```ts
prisma.facture.create({
  data: {
    tenantId,
    siteId: candidature.siteId,
    candidatureId: candidature.id,  // LIEN vers la candidature
    // eleveId: NON renseigné — l'élève n'existe pas encore
    numero: numeroFacture,
    libelle: `Frais d'inscription + Scolarité ${moisLabel} — ${prenom} ${nom} (${classeVoulue}, ${annee})`,
    montant: montantTotal,  // = fraisInscription + mensualite
    devise,  // = tarif?.devise ?? "DJF"
    statut: "EN_ATTENTE",
    createdById: session.user.id,
  },
})
```

**Points clés** :

- `eleveId` est **null** à ce stade — la facture existe **avant** l'élève. C'est le cœur de la spec « facture même si l'élève n'existe pas encore ».
- `candidatureId` fait le lien. Le modèle `Facture` a `eleveId String?` et `candidatureId String?` (schema lignes 1252-1259).
- Le **montant** = `fraisInscription + mensualite` (frais d'inscription one-time + **premier mois** de scolarité). C'est l'implémentation de « ajout automatique des frais du premier mois ».
- Le mois facturé est celui choisi, mais il n'est **stocké que dans le libellé** (pas dans le champ `mois` de la facture — celui-ci reste null).

---

## 4. Encaissement du paiement

### UI (`AdmissionsView.tsx` lignes 499-537)

- À partir du statut `ADMIS`, si la facture n'est pas soldée, un bouton « Encaisser » ouvre le `PaiementInlineModal`.
- Le modal affiche : total, déjà payé, restant à payer, avec barre de progression.
- Champs : montant (max = restant), méthode (`PAYMENT_METHODS`), référence.
- Paiement partiel possible (hint affiché si `montant < restant`).

### Action serveur `enregistrerPaiement` (`facture.ts` lignes 186-254)

- Permission `finance:write`.
- Vérifie facture non annulée, restant > 0, montant ≤ restant.
- Crée le `Paiement`, recalcule le total, met à jour le statut : `PAYEE` si `totalPaye >= montant`, sinon `EN_RETARD` si échéance dépassée.
- `revalidatePath("/facturation")` + `revalidateTag("dashboard-data")`.
- Après paiement, l'UI fait `window.location.reload()` (ligne 534) pour rafraîchir les données.

---

## 5. Création de l'élève (passage à INSCRIT)

**Condition** : `data.statut === "INSCRIT" && candidature.statut !== "INSCRIT"` (ligne 176).

### Gate de paiement (lignes 181-211) — **OBLIGATOIRE**

1. Récupère la facture liée à la candidature avec ses paiements.
2. Si **aucune facture** → erreur 400 « Le candidat doit d'abord être admis ».
3. `totalPaye = sum(paiements.montant)`.
4. `estPayee = totalPaye >= facture.montant && facture.montant > 0`.
5. Si **non payée** → erreur 400 avec détail (montant, payé, restant) + `factureId` dans la réponse. **L'inscription est bloquée**.

Côté UI (`AdmissionsView.tsx` lignes 350-366), le bouton « Confirmer l'inscription » est :

- **désactivé** si pas de facture (`confirmEnrollmentNoInvoice`),
- **activé** si `facturePayee` (`confirmEnrollment`),
- **désactivé** si facture non soldée (`confirmEnrollmentUnpaid`).

### Génération du matricule (lignes 213-229)

```ts
const anneeInscription = await getAnneeCouranteLibelle(tenantId);
const count = await prisma.eleve.count({ where: { tenantId } });
matricule = `ECL-${anneeInscription ?? new Date().getFullYear()}-${String(count + 1).padStart(4, "0")}`;
```

Format : `ECL-2026-2027-0001`. **Nuance** : `getAnneeCouranteLibelle` retourne le libellé de l'année courante configurée (ex. `"2026-2027"`), fallback sur l'année civile. Vérification d'unicité via `findUnique({ where: { tenantId_matricule } })` → erreur 409 si collision.

### Résolution de la classe (lignes 231-264) — **NUANCE IMPORTANTE**

- `candidature.classeVoulue` contient le **NOM** de la classe.
- Recherche **stricte** dans le site de la candidature : d'abord `nom + siteId + annee`, puis fallback `nom + siteId` (sans année).
- Si **aucune classe trouvée** → erreur 400 « La classe n'existe pas dans ce site. Créez la structure… ». **L'inscription est refusée** plutôt que de créer un élève orphelin ou rattaché à une classe d'un autre site.

### Transaction de création (lignes 267-322) — `prisma.$transaction`

1. **Parent** : recherche par `phone` (`tx.parent.findFirst({ where: { tenantId, phone: candidature.parentPhone } })`). Si inexistant → création avec `nom, prenom, email, phone`.
2. **Élève** : `tx.eleve.create` avec `tenantId, siteId: candidature.siteId, classeId: classeVisee.id, matricule, nom, prenom, dateNaissance, lieuNaissance, nationalite (défaut "SN"), sexe, statut: "ACTIF", anneeInscription: candidature.annee`.
3. **Lien EleveParent** : `lien: candidature.parentLien, isGardien: true`.
4. **Lien facture → élève** : `tx.facture.update({ where: { id: factureInscription.id }, data: { eleveId: eleve.id } })` — c'est ici que la facture (créée sans élève) est **rattachée rétroactivement** à l'élève nouvellement créé.

### Audit + Notifications (lignes 326-397)

- `auditFire` avec action `admissions:inscrire`, metadata (candidatureId, matricule, parentId, factureId).
- `notifyDirection` à chaque étape clé (ADMIS, INSCRIT, REFUSE) → notifie `TENANT_ADMIN` + `PRINCIPAL` (le comptable fait l'action, la direction est informée).

### Réponse (ligne 399)

```ts
{ candidature: updated, eleveCreeId, factureCreeId }
```

Côté UI (ligne 293-296), si `statut === "INSCRIT" && eleveCreeId` → toast spécial « Élève créé ».

---

## 6. Modèles Prisma concernés (à respecter exactement)

- **`Candidature`** (schema lignes 2006-2054) : `classeVoulue String` (nom, pas ID), `annee String`, `siteId String?`, `parentPhone`, `parentLien LienParente`, `documents Json?`, relation `factures Facture[]`.
- **`Facture`** (lignes 1244-1285) : `eleveId String?` (nullable — clé de la facture avant élève), `candidatureId String?`, `montant Float`, `devise String @default("DJF")`, `statut StatutFacture`, `mois String?`.
- **`TarifNiveau`** (lignes 1429-1455) : indexé par `niveau` (pas nom de classe), `fraisInscription Float`, `mensualite Float`, `fraisRenouvellement`, `fraisCantine?`, `fraisTransport?`, `actif Boolean`, **unique** sur `[tenantId, niveau, annee, siteId]`.
- **`Eleve`** (lignes 649-725) : `matricule String` (unique par tenant), `classeId String?`, `statut StatutEleve`, `anneeInscription String`, `identiteKey String?` (unique par tenant sauf NULL).
- **`Classe`** (lignes 561+) : `nom String` (« Terminale A »), `niveau String` (« Terminale »), `siteId String?`, `annee String`.
- **`Paiement`** (lignes 1287-1318) : `factureId`, `montant`, `methode`, `enregistreParId`.

---

## 7. Pièges et nuances à ne pas oublier

1. **`classeVoulue` = NOM, pas ID** — toute la logique tarifaire et de résolution de classe repose sur le nom. Le `classeId` n'est utilisé qu'à la création de candidature pour dériver le nom + le site.

2. **Résolution niveau vs nom de classe** — `TarifNiveau.niveau` ≠ `Classe.nom`. Il faut toujours passer par `Classe.niveau`. Fallback sur `classeVoulue` brut si classe introuvable (candidature publique).

3. **Tarif site-spécifique vs partagé** — le `OR: [{ siteId }, { siteId: null }]` + `orderBy: { siteId: { sort: "desc", nulls: "last" } }` est crucial. Sans le `OR`, un tarif partagé serait ignoré et la facture tomberait à 0 → blocage. Sans `nulls: "last"`, Postgres trie les NULLs en premier en `DESC` et le tarif partagé écrase le tarif spécifique (bug corrigé le 2026-09-07).

4. **Garde-fou tarif à 0** — bloque l'admission plutôt que de créer une facture inexploitable. Ne pas supprimer.

5. **Facture sans élève** — `eleveId` est null à la création, rattaché **après** création de l'élève dans la transaction INSCRIT. Ne jamais créer l'élève avant le paiement.

6. **Gate de paiement strict** — `totalPaye >= montant && montant > 0`. Paiement partiel = inscription bloquée.

7. **Résolution classe à l'inscription** — stricte par site (nom + siteId + annee, puis fallback sans année). Refus propre si introuvable, plutôt qu'élève orphelin.

8. **Idempotence facture** — vérification `factureExistante` avant création. Re-cliquer sur « Admettre » ne crée pas de doublon.

9. **Matricule race condition** — `count + 1` n'est pas atomique ; vérification `findUnique` post-génération gère la collision (erreur 409) mais n'incrémente pas automatiquement.

10. **Mois de scolarité** — stocké **uniquement dans le libellé** de la facture, pas dans le champ `mois`. Le défaut est septembre en août/septembre, sinon mois courant.

11. **Permissions** — `admissions:write` pour les transitions, `finance:write` pour l'encaissement. `INSCRIT` accessible au comptable (`ACCOUNTANT`).

12. **Notifications direction** — `notifyDirection` appelée pour ADMIS/INSCRIT/REFUSE. Le comptable agit, la direction est informée (pas l'inverse).

13. **`siteFilterForModel`** — utilisé pour `candidature` et `classe`. Les requêtes sur `facture` par `candidatureId` sont exemptées de site-filter (justifiées par les commentaires `eslint-disable`).

14. **Refresh UI après paiement** — `window.location.reload()` (pas de revalidation optimisée). Le `PaiementInlineModal` appelle `onPaid` → reload.

---

## 8. Historique des commits (ordre chronologique inverse)

```
d9eee7a fix(admissions): classe liée au site par ID + garde-fous inscription + facture affiche la candidature
2bf4895 fix(admissions): rattacher l'élève à sa classe lors de l'inscription
a4bf97e fix(admissions): la facture d'admission récupère le tarif (montant correct)
6f0c78f fix(admissions): siteId à la création + classes du site + choix mois scolarité + source unique inscription
86e13c3 feat(comptable): inscription bout-en-bout + réinscription corrigée + notifications direction
f9573a6 feat(admissions+rbac): inscription automatique + masquage boutons par permission
```

Ces commits montrent l'évolution : d'abord l'inscription automatique de base, puis l'accès comptable bout-en-bout, puis les correctifs successifs (siteId, choix du mois, tarif correct, rattachement classe, garde-fous).

---

## 9. Résumé du flux pour reproduction

```
[Candidature créée]
   ├─ classeId résolu → classeVoulue (nom) + siteId (de la classe)
   └─ statut = SOUMISE

[DOSSIER_COMPLET] (action manuelle)

[EN_EXAMEN] (action manuelle, gate pièces justificatives)

[ADMIS] (génère facture automatiquement)
   ├─ idempotence : pas de facture existante pour cette candidature
   ├─ résolution niveau : Classe.niveau (fallback classeVoulue)
   ├─ tarif : TarifNiveau (niveau + annee + site OU partagé, site-spécifique prioritaire)
   ├─ garde-fou : tarif manquant ou = 0 → BLOCAGE 400
   ├─ mois scolarité : choisi via modal (défaut = septembre en août/sept, sinon mois courant)
   ├─ montant = fraisInscription + mensualite (premier mois)
   ├─ facture créée avec candidatureId, eleveId = NULL, statut = EN_ATTENTE
   └─ notification direction

[Encaissement] (PaiementInlineModal → enregistrerPaiement)
   ├─ paiement partiel possible
   ├─ statut facture → PAYEE quand totalPaye >= montant
   └─ window.location.reload()

[INSCRIT] (crée l'élève, gate paiement obligatoire)
   ├─ gate : facture trouvée + totalPaye >= montant + montant > 0
   ├─ matricule : ECL-{annee}-{count+1} (vérif unicité)
   ├─ résolution classe : nom + siteId + annee (fallback sans année), refus si introuvable
   ├─ transaction :
   │   ├─ Parent (recherche par phone, sinon création)
   │   ├─ Eleve (classeId, siteId, statut ACTIF)
   │   ├─ EleveParent (lien, isGardien = true)
   │   └─ Facture.eleveId = eleve.id (rattachement rétroactif)
   ├─ auditFire + notifyDirection
   └─ retour : { candidature, eleveCreeId, factureCreeId }
```

Ce document couvre l'intégralité du processus tel qu'implémenté dans le code. Un agent coding peut reproduire le flux en suivant ces étapes et en respectant les nuances listées (notamment la distinction niveau/nom de classe, le gate de paiement, la facture sans élève, et la résolution stricte de la classe par site).
