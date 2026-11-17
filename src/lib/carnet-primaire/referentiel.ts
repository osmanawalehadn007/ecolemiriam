/**
 * Référentiel des carnets de l'enseignement fondamental (école de base),
 * 1ère à 5ème année. Transcrit des modèles Word « CARNET DE LA … ANNEE ».
 *
 * Deux formats coexistent :
 * - `competences` (1ère, 2ème) : chaque ligne de compétence est évaluée
 *   A (acquis), EVA (en voie d'acquisition) ou NA (non acquis) par module.
 * - `points` (3ème à 5ème) : chaque domaine reçoit une note sur son barème
 *   (/40, /20, /10) par module. Le total des barèmes vaut 200.
 *
 * Dans les deux cas, la note générale d'un module est sur 10 et la moyenne
 * générale annuelle est la moyenne des modules renseignés.
 */

export const NIVEAUX_CARNET = ["1ère", "2ème", "3ème", "4ème", "5ème"] as const;
export type NiveauCarnet = (typeof NIVEAUX_CARNET)[number];

export const MODULES = [1, 2, 3, 4] as const;
export type Module = (typeof MODULES)[number];

export interface Domaine {
  code: string;
  libelle: string;
  /** Lignes de compétence (CB1, CB2, …) telles qu'imprimées sur le carnet. */
  lignes: string[];
  /** Barème du domaine — présent uniquement dans le format `points`. */
  bareme?: number;
}

export type FormatCarnet = "competences" | "points";

export interface CarnetDef {
  niveau: NiveauCarnet;
  format: FormatCarnet;
  domaines: Domaine[];
}

const DOMAINES_1ERE: Domaine[] = [
  {
    code: "ARABE",
    libelle: "Compétence de langue en arabe",
    lignes: [
      "Mémorisation du saint CORAN et l'alphabet.",
      "Produire un message oral et se faire comprendre.",
      "Écrire correctement les lettres alphabétiques.",
    ],
  },
  {
    code: "EMCI",
    libelle: "Éducation morale, civique et islamique",
    lignes: [
      "Maîtriser les règles de base de la politesse et de la conduite.",
      "Refuser les abus, identifier les émotions.",
      "Connaître ses droits, accomplir ses devoirs.",
    ],
  },
  {
    code: "MATHS",
    libelle: "Compétences de mathématiques",
    lignes: [
      "Pré-mathématiques : résoudre une situation nécessitant le tri, la comparaison et le rangement d'objets.",
      "Nombre et calcul : résoudre des situations-problèmes d'écriture et de rangement des nombres de 1 à 20.",
      "Géométrie : résoudre une situation-problème pour se situer, situer des objets ou s'orienter dans l'espace.",
      "Grandeur et mesure : reproduire selon le même modèle ou en codant un élément répétitif visuel.",
    ],
  },
  {
    code: "FRANCAIS",
    libelle: "Compétences de langue : français",
    lignes: [
      "Lecture : lire des lettres, combiner des syllabes pour former des mots, lire un texte simple d'une à trois phrases.",
      "Écriture : copier, reproduire, compléter et produire un écrit signifiant d'une à trois phrases.",
      "Langage : produire un message oral, comprendre et se faire comprendre oralement.",
    ],
  },
  {
    code: "EMT_TICE",
    libelle: "Compétences EMT / TICE",
    lignes: [
      "Réaliser un assemblage de mêmes formes sur un support plat.",
      "Décorer une surface (plane ou en volume) par impression.",
      "Tracer à main levée des lignes graphiques en respectant la surface donnée.",
    ],
  },
];

const DOMAINES_2EME: Domaine[] = [
  {
    code: "SCIENCES",
    libelle: "Sciences expérimentales",
    lignes: [
      "Identifier les parties de son corps et l'hygiène corporelle.",
      "Identifier, reconnaître et nommer les animaux et les végétaux de son milieu.",
      "Identifier des objets matériels familiers et en effectuer des collections selon des critères simples.",
    ],
  },
  {
    code: "EMCI",
    libelle: "Éducation morale, civique et islamique",
    lignes: [
      "Être élève en classe et à l'école : maîtriser les règles de vie.",
      "Prendre soin de soi.",
      "Connaître ses droits, accomplir ses devoirs, être citoyen.",
    ],
  },
  {
    code: "ARABE",
    libelle: "Compétence de langue en arabe",
    lignes: [
      "Assiduité et ponctualité.",
      "Participer en classe.",
      "Écouter et écrire l'alphabet, comprendre, travailler en groupe.",
    ],
  },
  {
    code: "FRANCAIS",
    libelle: "Compétences de langue : français",
    lignes: [
      "Lecture : combiner des syllabes, déchiffrer des mots nouveaux, lire à haute voix un texte d'une à six phrases, comprendre le sens du texte.",
      "Écriture : copier, reproduire, compléter et produire un écrit signifiant d'une à cinq phrases.",
      "Langage : produire un message oral cohérent, se faire comprendre oralement, poser et répondre à une question complexe.",
    ],
  },
  {
    code: "MATHS",
    libelle: "Compétences de mathématiques",
    lignes: [
      "Nombre et calcul : résoudre des situations-problèmes de lecture, d'écriture et de rangement des nombres de 1 à 99 ; construire une table d'addition.",
      "Géométrie : se situer, situer des objets ou s'orienter dans l'espace ; reconnaître et reproduire une ligne droite, courbe ou brisée.",
      "Grandeur et mesures : reproduire selon le même modèle ou en codant un élément répétitif visuel.",
    ],
  },
  {
    code: "EMT_TICE",
    libelle: "Compétences EMT / TICE",
    lignes: [
      "Introduire la technique du modelage ; coder et décoder la tablette.",
      "Visionner et observer une image (support) ; manipuler les applications de jeux.",
      "Assembler des dessins, construction 3D ; utiliser un outil de transfert de documents.",
    ],
  },
];

const DOMAINES_POINTS_3EME: Domaine[] = [
  {
    code: "FRANCAIS",
    libelle: "Compétences de base : français",
    bareme: 40,
    lignes: [
      "Lecture : comprendre un texte en mobilisant des stratégies de compréhension littérale et différentielle ; lire à haute voix un texte simple.",
      "Écriture : copier correctement un texte de deux à trois phrases en écriture cursive ; produire un texte de deux à quatre phrases.",
      "Production orale : manifester la compréhension des récits entendus ; participer à des échanges interactifs. Outils de langue : notions lexicales, orthographiques et grammaticales.",
    ],
  },
  {
    code: "ARABE",
    libelle: "Compétences de base : arabe",
    bareme: 20,
    lignes: [
      "Écouter les conversations et répondre aux questions sur un sujet familier.",
      "Lire les lettres, les syllabes, les mots et les phrases et comprendre leur signification.",
      "Écrire des lettres, des mots et des phrases familiers.",
    ],
  },
  {
    code: "ANGLAIS",
    libelle: "Compétences de base : anglais",
    bareme: 20,
    lignes: [
      "Saluer, compter de un à douze, lire les jours et les mois.",
      "Poser des questions sur les objets de la classe, exprimer des instructions, nommer les membres de la famille.",
      "Reconnaître les parties du corps, les formes et les couleurs ; prononcer les lettres de l'alphabet.",
    ],
  },
  {
    code: "MATHS",
    libelle: "Compétences de base : mathématiques",
    bareme: 40,
    lignes: [
      "Numération : résoudre une situation mobilisant les trois opérations (+ ; − ; ×) avec des entiers de 0 à 999.",
      "Géométrie : résoudre une situation-problème faisant appel à la représentation et à la construction d'une figure.",
      "Mesure : résoudre une situation-problème de rangement et de classement d'événements dans le temps ou d'objets.",
    ],
  },
  {
    code: "HISTOIRE",
    libelle: "Compétences de base : histoire",
    bareme: 10,
    lignes: [
      "Se repérer dans l'espace et utiliser un lexique historique pour lire une photo ou une frise chronologique.",
      "Décrire une photo et répondre à des questions sur le fait, le lieu et la date ; comparer deux documents.",
    ],
  },
  {
    code: "GEOGRAPHIE",
    libelle: "Compétences de base : géographie",
    bareme: 10,
    lignes: [
      "Se situer dans le temps et utiliser un lexique géographique pour lire un plan ou une carte.",
      "Décrire un paysage, comprendre et analyser un document simple.",
    ],
  },
  {
    code: "SCIENCES",
    libelle: "Compétences de base : sciences expérimentales",
    bareme: 20,
    lignes: [
      "Identifier les os du squelette, les articulations et le rôle des muscles dans le mouvement.",
      "Identifier les besoins alimentaires des animaux et des plantes et distinguer les étapes de leur développement.",
      "Identifier les objets d'une collection type.",
    ],
  },
  {
    code: "EMCI",
    libelle: "Compétences de base : éducation morale, civique et islamique",
    bareme: 20,
    lignes: [
      "Prendre soin de soi-même et obéir aux préceptes de l'islam.",
      "Manifester un comportement libre et responsable.",
    ],
  },
  {
    code: "EMT",
    libelle: "Compétences de base : éducation manuelle et technique",
    bareme: 10,
    lignes: [
      "Réaliser à partir de matériaux utiles une composition graphique décorative ou une représentation picturale simple.",
      "Réaliser des objets, des personnages de son quotidien, de son environnement ou de son imagination.",
    ],
  },
  {
    code: "TICE",
    libelle: "Compétences de base : TICE",
    bareme: 10,
    lignes: [
      "Identifier, décrire et distinguer les éléments d'une tablette.",
      "Exploiter l'interface d'un logiciel éducatif.",
    ],
  },
];

const DOMAINES_POINTS_4EME: Domaine[] = [
  {
    code: "FRANCAIS",
    libelle: "Compétences de base : français",
    bareme: 40,
    lignes: [
      "Lecture : lire à haute voix un texte simple, niveaux 9 à 11, de manière fluide et expressive.",
      "Production écrite : produire un texte de différents genres de 5 à 10 phrases.",
      "Production orale : utiliser les moyens linguistiques pour produire un discours oral ou un dialogue. Outils de langue : notions lexicales, orthographiques et grammaticales.",
    ],
  },
  {
    code: "ARABE",
    libelle: "Compétences de base : arabe",
    bareme: 20,
    lignes: [
      "Production orale : communiquer avec son entourage, participer à des dialogues et décrire des scènes familières.",
      "Lecture : lire des mots, des phrases et des textes familiers, et répondre aux questions.",
      "Production écrite : écrire des phrases complètes et cohérentes sur un sujet précis.",
    ],
  },
  {
    code: "ANGLAIS",
    libelle: "Compétences de base : anglais",
    bareme: 20,
    lignes: [
      "Nommer les parties de la maison, le vocabulaire de l'école et de la météo.",
      "Nommer des animaux domestiques et sauvages ; compter jusqu'à 100.",
      "Nommer différents emplois, distinguer les habitudes saines des malsaines, écrire une phrase.",
    ],
  },
  {
    code: "MATHS",
    libelle: "Compétences de base : mathématiques",
    bareme: 40,
    lignes: [
      "Numération : résoudre des situations mobilisant les trois opérations et la division sur des entiers jusqu'à 999 999.",
      "Géométrie : décrire ou reproduire des figures simples avec les instruments adéquats (règle, équerre, compas).",
      "Mesure : évaluer et comparer des longueurs, des masses et des durées.",
    ],
  },
  {
    code: "HISTOIRE",
    libelle: "Compétences de base : histoire",
    bareme: 10,
    lignes: [
      "Évoquer les repères chronologiques, de la préhistoire à la création de la ville de Djibouti.",
    ],
  },
  {
    code: "GEOGRAPHIE",
    libelle: "Compétences de base : géographie",
    bareme: 10,
    lignes: [
      "Reconnaître les différents types de paysages (reliefs), leurs localisations et leurs descriptions.",
    ],
  },
  {
    code: "SCIENCES",
    libelle: "Compétences de base : sciences expérimentales",
    bareme: 20,
    lignes: [
      "Identifier les besoins alimentaires nécessaires à son organisme.",
      "Identifier les caractéristiques physiques nécessaires à la croissance et au développement des plantes et des animaux.",
      "Identifier les applications pratiques de quelques phénomènes physiques (électricité, magnétisme).",
    ],
  },
  {
    code: "EMCI",
    libelle: "Compétences de base : éducation morale, civique et islamique",
    bareme: 20,
    lignes: [
      "Connaître son histoire (école, famille, quartier), les valeurs de la République et les préceptes de l'islam.",
    ],
  },
  {
    code: "EMT",
    libelle: "Compétences de base : éducation manuelle et technique",
    bareme: 10,
    lignes: [
      "À partir d'une observation, représenter le réel par une reproduction bi ou tridimensionnelle.",
      "Raconter par l'image un événement simple de son environnement.",
    ],
  },
  {
    code: "TICE",
    libelle: "Compétences de base : TICE",
    bareme: 10,
    lignes: [
      "Utiliser un conjugueur et d'autres applications (interdisciplinarité) ; utiliser la robotique codée (basic).",
    ],
  },
];

const DOMAINES_POINTS_5EME: Domaine[] = [
  {
    code: "FRANCAIS",
    libelle: "Compétences de base : français",
    bareme: 40,
    lignes: [
      "Lecture : comprendre des textes de différents types en mobilisant des stratégies de compréhension littérale et différentielle ; lire à haute voix un texte de niveau adapté.",
      "Production écrite : rédiger un écrit d'une dizaine de phrases en respectant la ponctuation et la structure.",
      "Production orale : participer à des échanges interactifs dans des situations de communication variées. Outils de langue : notions lexicales, orthographiques et grammaticales.",
    ],
  },
  {
    code: "ARABE",
    libelle: "Compétences de base : arabe",
    bareme: 20,
    lignes: [
      "Communiquer oralement et répondre sur un sujet étudié.",
      "Lire un texte familier et répondre aux questions en repérant les informations clés.",
      "Produire des phrases cohérentes sur un sujet familier et précis.",
    ],
  },
  {
    code: "ANGLAIS",
    libelle: "Compétences de base : anglais",
    bareme: 20,
    lignes: [
      "Parler des objets, dire ce que sont les choses et ce que font les gens.",
      "Parler d'habitudes saines, des transports publics et donner des indications.",
      "Décrire la routine quotidienne, parler des saisons et du temps.",
    ],
  },
  {
    code: "MATHS",
    libelle: "Compétences de base : mathématiques",
    bareme: 40,
    lignes: [
      "Numération : traiter des situations numériques s'appuyant sur les opérations et leurs techniques de calcul.",
      "Géométrie : traiter des situations de construction et de transformation de formes géométriques dans le plan et l'espace.",
      "Mesure : traiter des situations de grandeurs, de gestion de données et de représentations (masses, angles, durées).",
    ],
  },
  {
    code: "HISTOIRE",
    libelle: "Compétences de base : histoire",
    bareme: 10,
    lignes: [
      "Réinvestir les repères historiques et utiliser le lexique adéquat pour lire une photographie ou une frise chronologique.",
      "Lire, comparer et analyser des documents historiques.",
    ],
  },
  {
    code: "GEOGRAPHIE",
    libelle: "Compétences de base : géographie",
    bareme: 10,
    lignes: [
      "Situer des lieux et des espaces les uns par rapport aux autres en utilisant la notion d'échelle géographique.",
      "Lire, décrire, comparer et analyser des documents géographiques.",
    ],
  },
  {
    code: "SCIENCES",
    libelle: "Compétences de base : sciences expérimentales",
    bareme: 20,
    lignes: [
      "Comprendre le fonctionnement des appareils digestif, respiratoire et circulatoire.",
      "Déterminer les effets des déséquilibres induits par l'homme sur le mode de vie des animaux et des végétaux.",
      "Identifier les phénomènes physiques (l'air, les combustions, l'énergie) en veillant à la sécurité.",
    ],
  },
  {
    code: "EMCI",
    libelle: "Compétences de base : éducation morale, civique et islamique",
    bareme: 20,
    lignes: [
      "Développer des valeurs de respect, de tolérance et de gestion des émotions.",
    ],
  },
  {
    code: "EMT",
    libelle: "Compétences de base : éducation manuelle et technique",
    bareme: 10,
    lignes: [
      "Interpréter une image, un événement ou une histoire simple de son environnement quotidien.",
      "Réaliser une production reflétant sa propre interprétation à partir d'un support donné.",
    ],
  },
  {
    code: "TICE",
    libelle: "Compétences de base : TICE",
    bareme: 10,
    lignes: [
      "Utiliser des applications diverses.",
      "Initier les élèves à la robotique codée (basic).",
    ],
  },
];

export const CARNETS: Record<NiveauCarnet, CarnetDef> = {
  "1ère": { niveau: "1ère", format: "competences", domaines: DOMAINES_1ERE },
  "2ème": { niveau: "2ème", format: "competences", domaines: DOMAINES_2EME },
  "3ème": { niveau: "3ème", format: "points", domaines: DOMAINES_POINTS_3EME },
  "4ème": { niveau: "4ème", format: "points", domaines: DOMAINES_POINTS_4EME },
  "5ème": { niveau: "5ème", format: "points", domaines: DOMAINES_POINTS_5EME },
};

/** Total des barèmes du format `points` : la note de module est ramenée sur 10. */
export function baremeTotal(niveau: NiveauCarnet): number {
  return CARNETS[niveau].domaines.reduce((somme, d) => somme + (d.bareme ?? 0), 0);
}

export function estNiveauCarnet(valeur: string): valeur is NiveauCarnet {
  return (NIVEAUX_CARNET as readonly string[]).includes(valeur);
}

/**
 * Normalise le libellé d'une année scolaire ("2026/2027", "2026 - 2027",
 * "2026-2027") vers "2026-2027". Renvoie null si deux années n'y figurent pas.
 */
export function normaliserAnnee(libelle: string | null | undefined): string | null {
  const m = libelle?.match(/(\d{4})\D+(\d{4})/);
  return m ? `${m[1]}-${m[2]}` : null;
}
