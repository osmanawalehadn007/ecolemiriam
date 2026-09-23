# 📚 Guide de Formation EcolPro — Espace Enseignant

**Version :** 1.0 — Septembre 2026
**Public :** Enseignants (rôles `TEACHER` et `CLASS_TEACHER`)
**Objectif :** Vous permettre de maîtriser la plateforme EcolPro en une session de formation, puis en autonomie.

---

## Sommaire

1. [Présentation générale](#1-présentation-générale)
2. [Connexion à la plateforme](#2-connexion-à-la-plateforme)
3. [Votre périmètre : classes et matières](#3-votre-périmètre--classes-et-matières)
4. [Créer un cours en ligne (LMS)](#4-créer-un-cours-en-ligne-lms)
5. [Ajouter du contenu à un cours (dont le contenu TEXTE)](#5-ajouter-du-contenu-à-un-cours-dont-le-contenu-texte)
6. [Saisir les notes d'une évaluation](#6-saisir-les-notes-dune-évaluation)
7. [Créer une évaluation](#7-créer-une-évaluation)
8. [Examens et sessions d'examen](#8-examens-et-sessions-dexamen)
9. [Emploi du temps, absences et appel](#9-emploi-du-temps-absences-et-appel)
10. [Bonnes pratiques et erreurs fréquentes](#10-bonnes-pratiques-et-erreurs-fréquentes)
11. [Déroulé de la session de formation](#11-déroulé-de-la-session-de-formation)

---

## 1. Présentation générale

EcolPro est la plateforme de gestion scolaire de votre établissement. En tant qu'enseignant, vous y avez accès à :

| Module | Ce que vous pouvez faire |
|---|---|
| **Tableau de bord** | Vue d'ensemble de vos classes et de vos activités |
| **Notes** | Saisie des notes par classe, matière et évaluation |
| **Évaluations** | Création de contrôles, devoirs, examens et TP |
| **Cours en ligne (LMS)** | Publication de cours avec vidéos, documents, textes et quiz |
| **Emploi du temps** | Consultation de vos créneaux de cours |
| **Appel / Vie scolaire** | Pointage des présences et absences |
| **Messages** | Communication avec l'administration, les élèves et les parents |

> 🔑 **Principe fondamental :** la plateforme vous **reconnaît automatiquement**. Dès votre connexion, EcolPro identifie qui vous êtes, quelles classes vous enseignez et quelles matières vous dispensez. Vous ne voyez et ne sélectionnez **jamais** les classes ou matières d'autres enseignants.

---

## 2. Connexion à la plateforme

### Étapes

1. Ouvrez votre navigateur et rendez-vous sur l'adresse fournie par l'établissement.
2. Saisissez votre **adresse e-mail professionnelle** (ex. `awa.diallo@lycee-demo.ecolpro.app`).
3. Saisissez votre **mot de passe**.
4. Cliquez sur **Se connecter**.

### Après la connexion

- Votre **nom** s'affiche en haut à droite de l'écran.
- Un **sélecteur de site** (si l'établissement a plusieurs sites) apparaît en haut de la page — vous êtes automatiquement positionné sur votre site de rattachement.
- En cas d'oubli de mot de passe, contactez le secrétariat ou l'administrateur de l'établissement.

> 💡 **Astuce :** sur mobile, une application EcolPro est disponible avec les mêmes fonctionnalités essentielles (appel, notes, emploi du temps, messages).

---

## 3. Votre périmètre : classes et matières

### Comment la plateforme vous reconnaît

EcolPro détermine automatiquement votre périmètre pédagogique à partir de **deux sources** :

1. **Votre emploi du temps** : chaque créneau de cours vous associe à une **classe** et une **matière**.
2. **Votre rôle de professeur principal** : si vous êtes prof principal d'une classe, celle-ci est également ajoutée à votre périmètre.

### Ce que cela implique concrètement

| Module | Ce que la plateforme filtre automatiquement |
|---|---|
| **Cours (LMS)** | Listes **Matière** et **Classe cible** limitées à votre périmètre |
| **Notes** | Les 3 sélecteurs en cascade (classe → matière → évaluation) ne proposent que votre périmètre |
| **Bulletins** | Vous ne consultez que les bulletins de vos classes |
| **Évaluations** | Liste des évaluations + champs **Classe** et **Matière** limités à votre périmètre (et pré-remplis si vous n'avez qu'une classe/matière) |
| **Examens** | Liste des **sessions** limitée à vos matières et aux niveaux de vos classes ; modale de session limitée à vos matières |
| **Absences** | Statistiques et liste des absences limitées à vos classes |
| **Appel** | Sélecteur de classe limité à vos classes |
| **Emploi du temps** | Vous consultez **votre** planning (en lecture seule : pas de création ni de suppression) |
| **Vie scolaire** | Incidents et élèves limités à vos classes |
| **Élèves** | Annuaire limité aux élèves de **vos** classes |
| **Parents** | Uniquement les familles dont un enfant suit vos cours |
| **Orientation** | Fiches limitées aux élèves de vos classes |
| **Analytique** | Graphiques et classements limités à votre périmètre |
| **Messages** | Uniquement vos conversations |

> 🔒 **Double protection.** Le filtrage est appliqué **deux fois** : à l'affichage (vous ne voyez que votre périmètre) **et** sur le serveur (toute requête hors périmètre est refusée, même si quelqu'un modifie manuellement l'adresse ou le formulaire). Vous ne pouvez donc jamais lire ni écrire de données concernant les classes d'un collègue.

> 📱 **Application mobile — alignée depuis le 23 septembre 2026.** Le filtrage décrit ci-dessus s'applique **à l'identique sur l'application mobile** : les écrans mobiles (appel, notes, élèves, absences, emploi du temps, incidents, vie scolaire) ne présentent que **vos** classes et **vos** matières. Les corrections ayant été faites côté serveur, aucun mise à jour de l'application n'est nécessaire : si votre mobile affiche encore des données d'une classe qui n'est pas la vôtre, **faites-le remonter** — c'est un défaut, pas un fonctionnement prévu.

> ℹ️ **Deux exceptions, par nature et non par oubli :**
> - Le **prochain examen** affiché sur votre tableau de bord est celui de l'établissement : un examen est une période d'épreuves, il n'est rattaché à aucune classe.
> - Le **chiffre d'affaires** de l'établissement ne vous est jamais transmis : cette donnée est réservée à la direction.

---

## 4. Créer un cours en ligne (LMS)

La page **Cours** vous permet de publier des cours accessibles en ligne à vos élèves.

### Accéder à la création

1. Dans le menu, cliquez sur **Cours**.
2. Cliquez sur le bouton **« Nouveau cours »** (en haut à droite).

### La fenêtre de création

Une **fenêtre modale** s'ouvre, avec un fond assombri opaque qui isole le formulaire du reste de la page : les lignes et données de la page d'arrière-plan **ne se superposent plus** au formulaire. En haut de la fenêtre, votre **nom d'enseignant est automatiquement affiché** — vous n'avez rien à saisir pour vous identifier.

### Remplir le formulaire

| Champ | Comment le remplir |
|---|---|
| **Titre du cours** *(obligatoire)* | Saisissez un titre clair. Ex. : *« Introduction aux mathématiques »* |
| **Description** | Objectifs et contenu du cours |
| **Niveau** | Choisissez : Débutant, Intermédiaire ou Avancé |
| **Durée estimée** | En minutes (ex. : 60) |
| **Matière** | ⭐ **Liste déroulante pré-remplie avec VOS matières uniquement.** Sélectionnez dans la liste — plus besoin de taper le nom à la main. |
| **Classe cible** | ⭐ **Liste déroulante pré-remplie avec VOS classes uniquement.** Vous ne voyez que les classes qui vous sont attribuées. |
| **Statut** | *Brouillon* (visible par vous seul) ou *Publié* (visible par les élèves) |

### Finaliser

- Cliquez sur **« Créer le cours »**.
- Le cours apparaît en tête de votre liste.
- Pour abandonner : cliquez sur **« Annuler »** ou cliquez simplement sur la zone sombre **en dehors** de la fenêtre.

---

## 5. Ajouter du contenu à un cours (dont le contenu TEXTE)

Un cours peut contenir plusieurs types de contenus organisés en chapitres.

### Étapes

1. Ouvrez le cours souhaité depuis la liste.
2. Cliquez sur **« Ajouter un contenu »**.
3. Dans la fenêtre qui s'ouvre, renseignez :
   - **Titre du contenu** (ex. : *Chapitre 1 — Introduction*)
   - **Type de contenu** — cliquez sur l'une des 5 icônes :
     - 🎬 **Vidéo** → collez une URL (YouTube, etc.)
     - 📄 **Document** → collez un lien vers un fichier
     - 🔗 **Lien** → toute ressource en ligne
     - 📝 **Texte** → rédigez directement le contenu dans la zone de texte prévue
     - ❓ **Quiz** → rédigez au format :
       ```
       Q1: La capitale du Sénégal ?
       A) Saint-Louis
       B) Dakar
       C) Thiès
       Réponse: B
       ```
   - **Durée estimée** en minutes

### Cas particulier du contenu TEXTE

Lorsque vous choisissez le type **Texte** :

- Une **zone de saisie** s'affiche automatiquement.
- Le cours est **déjà rattaché à votre matière et à votre classe** (choisies à l'étape précédente) — la plateforme ne vous redemande pas ces informations.
- Rédigez votre contenu librement : chapitres, exercices, corrigés…

> 💡 **Point important :** la matière et la classe sont **reconnues automatiquement** à partir de votre profil d'enseignant. Si les listes vous semblent vides ou incomplètes, signalez-le à l'administration (emploi du temps non à jour).


- Dans les **listes déroulantes de classes**, vous ne voyez **que vos propres classes**. Exemple : si vous enseignez les Mathématiques en 6ème A et 5ème B, seules ces deux classes apparaissent.
- Dans les **listes de matières**, seules **vos matières** sont proposées.
- Il est **impossible d'accéder** aux notes ou données d'une classe qui ne vous est pas attribuée — c'est une protection volontaire.


---

## 6. Saisir les notes d'une évaluation

La page **Notes** est organisée en **trois sélecteurs en cascade** :

### Étape 1 — Sélectionner la classe
Ouvrez la première liste : seules **vos classes** y figurent. Sélectionnez-en une.

### Étape 2 — Sélectionner la matière
Ouvrez la deuxième liste : seules **vos matières** y figurent.

### Étape 3 — Sélectionner l'évaluation
La troisième liste (grisée jusque-là) s'active dès que classe et matière sont choisies. Elle affiche les évaluations existantes (Contrôle, Devoir, Examen, TP).

### Saisir la grille de notes

Une fois l'évaluation choisie, une **grille de saisie** apparaît avec la liste de tous les élèves de la classe :

1. Saisissez la note de chaque élève dans la colonne **Valeur**.
2. Ajoutez éventuellement un **commentaire** (ex. : *« Bon effort »*, *« À revoir »*).
3. La saisie est **enregistrée à votre nom** — la plateforme conserve la trace de qui a saisi chaque note.
4. Les moyennes par matière se recalculent automatiquement.

> 🔒 **Sécurité :** vous ne pouvez modifier que les notes que **vous** avez saisies. Toute correction d'une note saisie par un autre enseignant nécessite l'arbitrage de l'administration.

---

## 7. Créer une évaluation

Avant de saisir des notes, il faut créer l'évaluation.

1. Allez sur la page **Évaluations**.
2. Cliquez sur **« Ajouter un examen »** — une fenêtre modale s'ouvre.
3. Remplissez :
   - **Titre** (ex. : *Contrôle n°1 — Théorème de Pythagore*)
   - **Type** : Contrôle / Devoir / Examen / TP
   - **Classe** — ⭐ seules vos classes sont proposées, et si vous n'en avez qu'une, elle est **déjà présélectionnée**
   - **Matière** — ⭐ seules vos matières sont proposées, et si vous n'en avez qu'une, elle est **déjà présélectionnée**
   - **Période** (trimestre/semestre)
   - **Date et heure**, **Durée**, **Coefficient**
   - **Description** (facultatif — chapitre du programme, consignes…)
4. Cliquez sur **Enregistrer**.

> 🔒 **Protection :** même en cas de manipulation anormale, la plateforme refuse côté serveur toute évaluation créée hors de votre périmètre (message : *« Vous ne pouvez créer une évaluation que pour vos classes et vos matières »*).

L'évaluation apparaît ensuite dans le tableau, et devient sélectionnable dans la page **Notes** pour la saisie.

---

## 8. Examens et sessions d'examen

La page **Examens & Délibérations** sert à la programmation des épreuves de l'établissement.

### Ce que vous voyez

- La liste des **examens** programmés (période d'examen : intitulé, dates de début et de fin, statut).
- Sous chaque examen, les **sessions** (épreuves datées) : matière, date, horaires, salle, niveau.

> 🔑 **Reconnaissance automatique :** parmi toutes les sessions de l'établissement, la plateforme ne vous affiche que celles relevant de **votre périmètre** — les matières que vous enseignez et les niveaux de vos classes. Vous ne voyez pas les épreuves de vos collègues.

### Programmer une session d'épreuve

1. Ouvrez la page **Examens & Délibérations**.
2. Repérez l'examen concerné et dépliez-le (clic sur la carte).
3. Cliquez sur **« Ajouter une session »** — une fenêtre modale s'ouvre.
4. Remplissez :
   - **Matière** — ⭐ la liste ne contient que **les matières que vous enseignez** (plus une entrée « Autre »)
   - **Date** de l'épreuve
   - **Heure de début** et **heure de fin**
   - **Salle** (ex. *Salle 04*)
   - **Niveau** — ⭐ ce champ vous **suggère automatiquement les niveaux de vos classes** (dès que vous commencez à taper, une liste apparaît : 6ème, 5ème, 4ème…)
5. Cliquez sur **Ajouter**.

> 🔒 **Protection :** toute tentative de programmer une session pour une matière ou un niveau hors de votre périmètre est refusée par la plateforme :
> - *« Vous ne pouvez programmer une session que pour les matières que vous enseignez »*
> - *« Le niveau sélectionné ne correspond à aucune de vos classes »*

### Faire évoluer le statut d'un examen

Sur chaque examen, vous pouvez faire passer le statut : **Programmé → En cours → Terminé** (ou **Annulé**). Ces boutons sont réservés aux personnes habilitées ; si vous ne les voyez pas, c'est que l'administration garde la main sur cette étape.

---

## 9. Emploi du temps, absences et appel

### Emploi du temps

- Consultez vos créneaux de la semaine : classe, matière, salle, horaires.
- La page s'ouvre en **lecture seule** pour un enseignant : vous voyez **votre** planning, sans les boutons de création, de suppression ni les suggestions automatiques. Toute modification du planning passe par l'administration.
- C'est **votre emploi du temps qui définit votre périmètre** (classes + matières) pour **toutes** les pages de la plateforme (cours, notes, évaluations, examens, appel, élèves, vie scolaire…) — vérifiez-le en début d'année ou après tout changement de planning.

### Consulter les absences

La page **Absences** affiche les statistiques et les dernières absences — **uniquement de vos classes** :

- Absences du jour, de la semaine, non justifiées
- Liste des dernières absences (élève, classe, statut)

### Appel / Vie scolaire

1. Ouvrez le module **Appel** (bouton **« Faire l'appel »** depuis la page Absences, ou menu latéral).
2. Sélectionnez la classe du créneau courant — ⭐ **seules vos classes apparaissent dans la liste**. Si vous êtes prof principal, votre classe principale est en première position.
3. Pointez chaque élève : **Présent** / **Absent** / **Retard**.
4. Validez — les absences sont transmises à la vie scolaire et visibles par les parents.

> 🔒 **Protection :** même en cas de manipulation anormale, la plateforme refuse un appel sur une classe qui n'est pas la vôtre (message : *« Vous ne pouvez faire l'appel que pour vos propres classes »*).

---

## 10. Bonnes pratiques et erreurs fréquentes

### ✅ Bonnes pratiques

- **Publiez** vos cours (statut « Publié ») dès qu'ils sont prêts — les élèves sont notifiés.
- Saisissez les notes **dans les 48h** suivant l'évaluation.
- Utilisez des **titres explicites** pour cours et évaluations (chapitre, numéro).
- Vérifiez votre **emploi du temps** en début de semestre : c'est lui qui alimente vos listes.

### ⚠️ Erreurs fréquentes

| Problème | Cause probable | Solution |
|---|---|---|
| Ma classe n'apparaît pas dans la liste | Emploi du temps non à jour | Contactez l'administration |
| Ma matière n'apparaît pas | Idem | Contactez l'administration |
| Je ne peux pas modifier une note | Note saisie par un autre enseignant | Passez par l'administration |
| Je ne vois pas toutes les sessions d'examen | Filtrage automatique sur votre périmètre | Normal : vous ne voyez que vos matières et vos niveaux |
| « Matière non autorisée » en créant une session | Matière choisie hors de votre périmètre | Choisissez une matière de votre liste (vérifiez votre emploi du temps) |
| Je ne peux pas créer de créneau dans l'emploi du temps | La page est en lecture seule pour les enseignants | Demandez la modification à l'administration |
| Je ne vois pas tous les élèves de l'établissement | Annuaire limité à vos classes | Normal : c'est une protection, pas un bug |
| La fenêtre de création semble « transparente » | Ancienne version / cache navigateur | Rechargez la page (Ctrl+R / Cmd+R) |
| Je ne reçois pas les messages | Notifications désactivées | Vérifiez les paramètres de votre compte |

---

## 11. Déroulé de la session de formation

Durée recommandée : **2 heures** (théorie : 30 min / pratique : 90 min)

### Phase 1 — Découverte (30 min)
- [ ] Connexion collective de chaque participant
- [ ] Visite guidée du tableau de bord
- [ ] Explication du périmètre « classes + matières automatiques » (section 3)

### Phase 2 — Exercice pratique 1 : le cours en ligne (30 min)
- [ ] Chaque enseignant crée un cours avec **sa** matière et **sa** classe
- [ ] Ajout d'un contenu **Texte** (rédaction d'un chapitre d'essai)
- [ ] Ajout d'un **Quiz** simple
- [ ] Publication du cours

### Phase 3 — Exercice pratique 2 : les notes (30 min)
- [ ] Création d'une évaluation (contrôle)
- [ ] Saisie des notes sur 3 élèves au minimum
- [ ] Vérification des moyennes

### Phase 4 — Exercices pratiques 3 & 4 : examens et appel (15 min)
- [ ] Programmer une **session d'examen** (vérifier que la liste des matières ne contient que les siennes et que le champ Niveau suggère ses classes)
- [ ] Vérifier que la liste d'examen ne montre que **ses** sessions
- [ ] Réalisation d'un appel complet — vérifier que seules **ses** classes sont proposées

### Phase 5 — Questions & évaluation (15 min)
- [ ] Tour de table questions/réponses
- [ ] Remise de ce guide (PDF imprimé ou lien)
- [ ] Indication du contact support de l'établissement

---

## 📞 Support

En cas de difficulté après la formation :

- **Support de proximité :** l'administrateur EcolPro de votre établissement (secrétariat / direction)
- **Problème technique :** contactez l'équipe technique via le module **Messages** (canal « Support »)

*Document EcolPro — tous droits réservés.*

