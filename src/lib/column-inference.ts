/**
 * École Miriam — Inférence de colonnes par analyse du header + des données
 * =======================================================================
 *
 * Au lieu de se fier uniquement au titre des colonnes (qui peut être en
 * n'importe quelle langue, abrégé, ou absent), ce module analyse **à la fois**
 * le header et le **contenu réel** des cellules pour déduire quel champ
 * chaque colonne représente.
 *
 * Principe :
 *   1. Profiler chaque colonne : header + échantillon de données (10 valeurs)
 *   2. Pour chaque type cible (email, téléphone, nom, site, contrat, matière),
 *      scorer chaque colonne selon :
 *        - headerScore : correspondance floue du titre (0-1)
 *        - dataScore   : correspondance du pattern des données (0-1)
 *   3. Score total = headerScore * 0.35 + dataScore * 0.65
 *      (les données sont plus fiables que le titre)
 *   4. Assigner la meilleure colonne à chaque champ, avec résolution
 *      des conflits (une colonne ne peut être assignée qu'à un seul champ)
 *
 * Avantages :
 *   - "Prénom" ne sera plus confondu avec "Nom" (les données d'un prénom
 *     sont des mots uniques, celles d'un nom complet sont des mots composés)
 *   - Une colonne "Contact" avec des emails sera reconnue comme email
 *     même si le titre ne dit pas "email"
 *   - Une colonne sans titre mais remplie d'emails sera détectée
 *   - Une colonne "Infos" avec des numéros de téléphone sera détectée
 */

// ------------------------------------------------------------
// Types
// ------------------------------------------------------------

/** Profil d'une colonne après lecture du fichier. */
export interface ColumnProfile {
  /** Index de la colonne (0-based). */
  index: number;
  /** Titre de la colonne (ligne 1), lowercased + trimmed. */
  header: string;
  /** Jusqu'à 10 valeurs non-vides échantillonnées. */
  samples: string[];
  /** Nombre total de valeurs non-vides dans la colonne. */
  nonEmptyCount: number;
}

/** Les champs cibles que nous voulons identifier. */
export type TargetField =
  | "nom"
  | "email"
  | "telephone"
  | "matiere"
  | "site"
  | "tempsPlein"
  | "classe";

/** Résultat de l'inférence : mapping field → index de colonne. */
export type ColumnMapping = Partial<Record<TargetField, number>>;

/** Détail du scoring pour debug/affichage. */
export interface ColumnScore {
  field: TargetField;
  columnIndex: number;
  header: string;
  headerScore: number;
  dataScore: number;
  totalScore: number;
  reason: string;
}

// ------------------------------------------------------------
// Détecteurs de type par les données
// ------------------------------------------------------------

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Compte les chiffres dans une string (pour détecter téléphone). */
function digitCount(s: string): number {
  return (s.match(/\d/g) || []).length;
}

/** Une valeur ressemble-t-elle à un email ? */
function looksLikeEmail(value: string): boolean {
  return EMAIL_REGEX.test(value.trim());
}

/** Une valeur ressemble-t-elle à un numéro de téléphone ? */
function looksLikePhone(value: string): boolean {
  const v = value.trim();
  // Au moins 8 chiffres, peut contenir +, espaces, tirets, parenthèses
  if (digitCount(v) < 8) return false;
  // Pas d'arobase (sinon c'est un email)
  if (v.includes("@")) return false;
  // Contient majoritairement des chiffres et séparateurs
  const clean = v.replace(/[+\d\s\-().]/g, "");
  return clean.length <= 2; // tolère 1-2 lettres (ex: "Tel:", "Fax:")
}

/** Une valeur ressemble-t-elle à une date ? */
function looksLikeDate(value: string): boolean {
  const v = value.trim();
  // JJ/MM/AAAA ou AAAA-MM-JJ
  if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/.test(v)) return true;
  if (/^\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}$/.test(v)) return true;
  return false;
}

/** Une valeur ressemble-t-elle à un type de contrat ? */
function looksLikeContractType(value: string): boolean {
  const v = value.trim().toLowerCase();
  const contractKeywords = [
    "plein", "partiel", "cdi", "cdd", "vacation", "full", "part",
    "ft", "pt", "tp", "pp", "100%", "temps", "contrat",
  ];
  return contractKeywords.some((k) => v === k || v.startsWith(k));
}

/** Une valeur ressemble-t-elle à un nom propre ? */
function looksLikeName(value: string): boolean {
  const v = value.trim();
  if (v.length < 2) return false;
  // Pas d'email, pas de téléphone, pas de date
  if (looksLikeEmail(v)) return false;
  if (looksLikePhone(v)) return false;
  if (looksLikeDate(v)) return false;
  // Pas de chiffres (sauf cas très rares)
  if (/\d/.test(v)) return false;
  // Pas de caractères spéciaux inhabituels
  if (/[<>{}[\]\\]/.test(v)) return false;
  // Majoritairement des lettres et espaces
  const letters = (v.match(/[a-zA-ZÀ-ÿ]/g) || []).length;
  return letters >= v.length * 0.6;
}

/** Une valeur ressemble-t-elle à un nom de site/lieu ? */
function looksLikeSite(value: string): boolean {
  const v = value.trim();
  if (v.length < 3) return false;
  if (looksLikeEmail(v)) return false;
  if (looksLikePhone(v)) return false;
  if (looksLikeDate(v)) return false;
  if (looksLikeContractType(v)) return false;
  // Un site est généralement un texte court sans chiffres
  if (/\d/.test(v)) return false;
  // Mais plus long qu'un simple prénom (souvent "Campus Central", "Annexe PK12")
  // Note: "PK12" contient des chiffres — on tolère si le reste est textuel
  const letters = (v.match(/[a-zA-ZÀ-ÿ]/g) || []).length;
  return letters >= v.length * 0.5;
}

/** Une valeur ressemble-t-elle à un nom de matière ? */
function looksLikeSubject(value: string): boolean {
  const v = value.trim();
  if (v.length < 2) return false;
  if (looksLikeEmail(v)) return false;
  if (looksLikePhone(v)) return false;
  if (looksLikeDate(v)) return false;
  if (looksLikeContractType(v)) return false;
  // Une matière est un texte (Mathématiques, Physique, SVT, EPS...)
  if (/[<>{}[\]\\@]/.test(v)) return false;
  const letters = (v.match(/[a-zA-ZÀ-ÿ]/g) || []).length;
  return letters >= v.length * 0.5;
}

/** Une valeur ressemble-t-elle à un nom de classe ? */
function looksLikeClassName(value: string): boolean {
  const v = value.trim();
  if (v.length < 2) return false;
  if (looksLikeEmail(v)) return false;
  if (looksLikePhone(v)) return false;
  if (looksLikeDate(v)) return false;
  if (looksLikeContractType(v)) return false;
  // Un nom de classe contient souvent des chiffres + lettres :
  // "1ère A", "CM2", "PS/MS", "Terminale S", "6ème1"
  // On accepte les chiffres (contrairement à looksLikeName/looksLikeSite)
  if (/[<>{}[\]\\@]/.test(v)) return false;
  const letters = (v.match(/[a-zA-ZÀ-ÿ]/g) || []).length;
  return letters >= v.length * 0.3;
}

// ------------------------------------------------------------
// Scoring des données
// ------------------------------------------------------------

/**
 * Calcule un score 0-1 indiquant à quel point les données d'une colonne
 * correspondent à un type donné.
 */
function scoreData(samples: string[], type: TargetField): { score: number; reason: string } {
  if (samples.length === 0) return { score: 0, reason: "Aucune donnée" };

  const detector =
    type === "email" ? looksLikeEmail :
    type === "telephone" ? looksLikePhone :
    type === "tempsPlein" ? looksLikeContractType :
    type === "nom" ? looksLikeName :
    type === "site" ? looksLikeSite :
    type === "matiere" ? looksLikeSubject :
    type === "classe" ? looksLikeClassName :
    () => false;

  const matches = samples.filter(detector).length;
  const ratio = matches / samples.length;

  // Pour "nom" et "site" et "matiere" : ces types se chevauchent.
  // On affine avec des heuristiques supplémentaires.
  if (type === "nom") {
    // Un nom a généralement 1-4 mots
    const wordCounts = samples.map((s) => s.trim().split(/\s+/).length);
    const avgWords = wordCounts.reduce((a, b) => a + b, 0) / wordCounts.length;
    if (avgWords > 5) return { score: ratio * 0.5, reason: `Mots moyens: ${avgWords.toFixed(1)} (trop long pour un nom)` };
    return { score: ratio, reason: `${matches}/${samples.length} ressemblent à des noms` };
  }

  if (type === "site") {
    // Un site contient souvent des mots comme "campus", "annexe", "site", "centre"
    const siteKeywords = ["campus", "annexe", "site", "centre", "école", "ecole"];
    const hasSiteKeyword = samples.some((s) =>
      siteKeywords.some((k) => s.toLowerCase().includes(k))
    );
    if (hasSiteKeyword) return { score: Math.max(ratio, 0.7), reason: `Contient des mots-clés site (${matches}/${samples.length})` };
    return { score: ratio * 0.8, reason: `${matches}/${samples.length} ressemblent à des sites` };
  }

  if (type === "matiere") {
    // Une matière est souvent un seul mot ou un mot composé court
    const shortTexts = samples.filter((s) => s.length <= 30).length;
    return { score: ratio * (shortTexts / samples.length), reason: `${matches}/${samples.length} ressemblent à des matières` };
  }

  if (type === "tempsPlein") {
    // Pour le contrat, on veut des valeurs courtes et reconnues
    return { score: ratio, reason: `${matches}/${samples.length} sont des types de contrat` };
  }

  if (type === "classe") {
    // Un nom de classe contient souvent des chiffres ou des abréviations de niveau
    const hasNiveauKeyword = samples.some((s) =>
      /ème|ere|ère|cm|cp|ce|ps|ms|gs|crèche|creche|garderie|terminale|seconde|première|premiere/i.test(s)
    );
    if (hasNiveauKeyword) return { score: Math.max(ratio, 0.8), reason: `Contient des mots-clés niveau (${matches}/${samples.length})` };
    return { score: ratio, reason: `${matches}/${samples.length} ressemblent à des classes` };
  }

  return { score: ratio, reason: `${matches}/${samples.length} correspondent` };
}

// ------------------------------------------------------------
// Scoring du header
// ------------------------------------------------------------

/** Patterns de headers pour chaque type (insensible à la casse). */
const HEADER_PATTERNS: Record<TargetField, { exact: string[]; contains: string[] }> = {
  nom: {
    exact: ["nom", "name", "fullname", "lastname", "surname", "nom complet", "nom et prenom", "identite"],
    contains: ["nom de famille", "nom complet", "full name", "last name"],
  },
  email: {
    exact: ["email", "mail", "courriel", "e-mail", "adresse email", "adresse mail"],
    contains: ["email professionnel", "email personnel", "adresse email", "adresse mail", "e-mail"],
  },
  telephone: {
    exact: ["telephone", "téléphone", "tel", "tél", "phone", "mobile", "contact", "numéro", "numero"],
    contains: ["téléphone pro", "telephone pro", "numéro de téléphone", "numéro de contact", "phone number", "mobile number"],
  },
  matiere: {
    exact: ["matiere", "matière", "subject", "discipline", "spécialité", "specialite", "enseignement"],
    contains: ["matiere enseignée", "matière enseignée", "matiere principale", "subject taught", "domaine"],
  },
  site: {
    exact: ["site", "campus", "lieu", "affectation", "etablissement", "établissement"],
    contains: ["site d'affectation", "site de rattachement", "lieu d'affectation", "campus principal"],
  },
  tempsPlein: {
    exact: ["temps", "contrat", "plein", "partiel", "type", "statut", "regime", "régime"],
    contains: ["temps plein", "temps partiel", "type de contrat", "type contrat", "nature du contrat", "full time", "part time", "full-time", "part-time"],
  },
  classe: {
    exact: ["classe", "class", "niveau", "grade", "section", "groupe"],
    contains: ["classe enseignée", "classe principale", "niveau enseigné", "class taught", "class name", "nom de la classe"],
  },
};

/**
 * Calcule un score 0-1 pour la correspondance du header.
 * Match exact = 1.0, match par préfixe de mot = 0.8, match par sous-chaîne = 0.5
 */
function scoreHeader(header: string, type: TargetField): { score: number; reason: string } {
  if (!header) return { score: 0, reason: "Header vide" };
  const h = header.toLowerCase().trim();
  const patterns = HEADER_PATTERNS[type];

  // Match exact
  if (patterns.exact.includes(h)) return { score: 1.0, reason: `Match exact: "${h}"` };

  // Match par "contient" (phrases composées)
  for (const p of patterns.contains) {
    if (h === p) return { score: 0.95, reason: `Match exact composé: "${h}"` };
    if (h.includes(p)) return { score: 0.85, reason: `Contient: "${p}" dans "${h}"` };
  }

  // Match par préfixe de mot : "nom" match "nom de famille" mais PAS "prénom"
  for (const p of patterns.exact) {
    if (h.startsWith(p + " ") || h.startsWith(p + "_") || h.startsWith(p + "-")) {
      return { score: 0.8, reason: `Préfixe: "${p}" dans "${h}"` };
    }
  }

  // Match par sous-chaîne (plus faible) — mais on exclut les faux positifs connus
  const falsePositives: Record<TargetField, string[]> = {
    nom: ["prénom", "prenom", "surnom", "pseudonyme", "acronyme"],
    email: ["email de secours"], // trop rare pour s'en soucier
    telephone: ["atelier", "hôtel", "hotel", "niveau", "matériel", "materiel"],
    matiere: [],
    site: ["site web", "site internet", "website"],
    tempsPlein: ["type de salle", "type d'établissement", "type etablissement"],
    classe: [],
  };

  for (const p of patterns.exact) {
    if (h.includes(p)) {
      // Vérifier les faux positifs
      const isFalsePositive = falsePositives[type].some((fp) => h.includes(fp));
      if (isFalsePositive) return { score: 0.1, reason: `Faux positif évité: "${h}"` };
      return { score: 0.5, reason: `Sous-chaîne: "${p}" dans "${h}"` };
    }
  }

  return { score: 0, reason: `Aucune correspondance: "${h}"` };
}

// ------------------------------------------------------------
// Inférence principale
// ------------------------------------------------------------

/** Poids relatifs : les données comptent plus que le header. */
const HEADER_WEIGHT = 0.35;
const DATA_WEIGHT = 0.65;

/**
 * Infère le mapping colonne → champ à partir des profils.
 *
 * Algorithme :
 *   1. Pour chaque colonne × chaque champ, calculer le score total
 *   2. Trier tous les scores par ordre décroissant
 *   3. Assigner greedy : prendre le meilleur score, marquer la colonne
 *      et le champ comme pris, passer au suivant
 *
 * Cela garantit qu'une colonne n'est assignée qu'à un seul champ, et
 * qu'un champ ne reçoit qu'une seule colonne (la meilleure).
 */
export function inferColumnMapping(
  profiles: ColumnProfile[],
  knownSites: string[] = [],
  knownSubjects: string[] = [],
): { mapping: ColumnMapping; details: ColumnScore[] } {
  // Calculer tous les scores
  const allScores: ColumnScore[] = [];
  const fields: TargetField[] = ["nom", "email", "telephone", "matiere", "site", "tempsPlein", "classe"];

  for (const profile of profiles) {
    for (const field of fields) {
      const headerResult = scoreHeader(profile.header, field);
      const dataResult = scoreData(profile.samples, field);

      // Bonus si les données correspondent à des sites/matières connus
      let bonus = 0;
      if (field === "site" && knownSites.length > 0) {
        const siteMatches = profile.samples.filter((s) =>
          knownSites.some((ks) => ks.toLowerCase() === s.toLowerCase().trim())
        ).length;
        if (siteMatches > 0) {
          bonus = (siteMatches / profile.samples.length) * 0.3;
        }
      }
      if (field === "matiere" && knownSubjects.length > 0) {
        const subjectMatches = profile.samples.filter((s) =>
          knownSubjects.some((ks) => ks.toLowerCase() === s.toLowerCase().trim())
        ).length;
        if (subjectMatches > 0) {
          bonus = (subjectMatches / profile.samples.length) * 0.3;
        }
      }

      const totalScore = Math.min(
        1.0,
        headerResult.score * HEADER_WEIGHT + dataResult.score * DATA_WEIGHT + bonus,
      );

      allScores.push({
        field,
        columnIndex: profile.index,
        header: profile.header,
        headerScore: headerResult.score,
        dataScore: dataResult.score,
        totalScore,
        reason: `H: ${headerResult.reason} | D: ${dataResult.reason}${bonus > 0 ? ` | +bonus: ${bonus.toFixed(2)}` : ""}`,
      });
    }
  }

  // Trier par score décroissant
  allScores.sort((a, b) => b.totalScore - a.totalScore);

  // Assignment greedy
  const mapping: ColumnMapping = {};
  const usedColumns = new Set<number>();
  const assignedFields = new Set<TargetField>();
  const minScore = 0.25; // en dessous, on ne fait pas l'assignation

  for (const score of allScores) {
    if (score.totalScore < minScore) break;
    if (usedColumns.has(score.columnIndex)) continue;
    if (assignedFields.has(score.field)) continue;

    mapping[score.field] = score.columnIndex;
    usedColumns.add(score.columnIndex);
    assignedFields.add(score.field);
  }

  // Détails pour debug (triés par champ)
  const details = fields.map((field) => {
    const assigned = allScores.find((s) => s.field === field && mapping[field] === s.columnIndex);
    if (assigned) return assigned;
    // Si non assigné, montrer le meilleur score quand même
    const best = allScores
      .filter((s) => s.field === field)
      .sort((a, b) => b.totalScore - a.totalScore)[0];
    return best || {
      field,
      columnIndex: -1,
      header: "(non trouvé)",
      headerScore: 0,
      dataScore: 0,
      totalScore: 0,
      reason: "Aucune colonne correspondante",
    };
  });

  return { mapping, details };
}

/**
 * Crée les profils de colonnes à partir d'une feuille ExcelJS.
 *
 * Lit la ligne 1 (headers) et échantillonne jusqu'à 10 valeurs non-vides
 * par colonne pour inférer le type.
 */
export function profileColumns(
  sheet: import("exceljs").Worksheet,
  maxSamples = 10,
): ColumnProfile[] {
  const headers: string[] = [];
  sheet.getRow(1).eachCell((cell, colNumber) => {
    headers[colNumber - 1] = String(cell.value ?? "").trim().toLowerCase();
  });

  const colCount = headers.length;
  const profiles: ColumnProfile[] = [];

  for (let col = 0; col < colCount; col++) {
    const samples: string[] = [];
    let nonEmptyCount = 0;

    // Échantillonner à partir de la ligne 2
    for (let row = 2; row <= sheet.rowCount && samples.length < maxSamples; row++) {
      const cell = sheet.getRow(row).getCell(col + 1);
      const value = cell.value;
      if (value === null || value === undefined) continue;
      const s = String(value).trim();
      if (s.length === 0) continue;
      nonEmptyCount++;
      if (samples.length < maxSamples) {
        samples.push(s);
      }
    }

    profiles.push({
      index: col,
      header: headers[col] || "",
      samples,
      nonEmptyCount,
    });
  }

  return profiles;
}
