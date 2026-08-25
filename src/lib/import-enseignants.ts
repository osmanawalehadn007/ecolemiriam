/**
 * École Miriam — Analyse d'un import d'enseignants
 * =============================================
 *
 * Lecture du fichier Excel et construction d'un **plan d'import** : pour chaque
 * ligne, ce qui sera fait et pourquoi. Aucune écriture ici.
 *
 * Module partagé par les deux étapes de l'import :
 *
 *   1. `/api/import/enseignants/analyze` — produit le plan, n'écrit rien ;
 *   2. `/api/import/enseignants`         — rejoue l'analyse et applique le plan.
 *
 * L'import crée des enseignants « nus » (User + Enseignant + EnseignantMatiere
 * si la matière est reconnue + EnseignantSite). L'affectation aux classes se
 * fait dans un second temps via l'onglet « Affectation enseignants » ou via
 * l'emploi du temps.
 */

import ExcelJS from "exceljs";
import { createHash } from "crypto";
import { profileColumns, inferColumnMapping } from "@/lib/column-inference";

// ------------------------------------------------------------
// Lecture du fichier
// ------------------------------------------------------------

export interface ParsedRow {
  /** Numéro de ligne dans le fichier, pour que l'utilisateur s'y retrouve. */
  ligne: number;
  nom: string;
  email: string;
  telephone?: string;
  matiere?: string;
  site: string;
  tempsPlein: boolean; // true = temps plein, false = temps partiel
}

/**
 * Matching de colonnes par mot entier (pas par sous-chaîne).
 *
 * Stratégie en 3 passes pour maximiser la robustesse face aux fichiers
 * "messy" (colonnes mélangées, extras, ordre aléatoire) :
 *
 *   1. Match exact (insensible à la casse) — "nom" == "nom"
 *   2. Match par préfixe de mot — "nom" match "nom de famille" mais PAS "prénom"
 *   3. Fallback : aucune colonne trouvée → undefined (la ligne sera en erreur)
 *
 * On évite ainsi les faux positifs du type :
 *   - "prénom" contient "nom" → ne match plus la colonne "nom"
 *   - "atelier" contient "tel" → ne match plus "téléphone"
 *   - "site web" avant "site d'affectation" → priorité au plus long match
 */
export function buildColumnMapping(headers: string[]): Record<string, string> {
  // Normaliser les headers : lowercased + trimmed
  const normalized = headers.map((h) => h.toLowerCase().trim());

  // Vérifie si un header commence par un des patterns (match par mot de début)
  const startsWith = (patterns: string[]): string | undefined => {
    // Pass 1 : match exact
    for (const p of patterns) {
      const found = normalized.find((h) => h === p);
      if (found) return headers[normalized.indexOf(found)];
    }
    // Pass 2 : commence par "pattern " (avec espace) ou "pattern_"
    // → "nom de famille" match "nom", mais "prénom" ne match PAS "nom"
    for (const p of patterns) {
      const found = normalized.find((h) => h.startsWith(p + " ") || h.startsWith(p + "_") || h.startsWith(p + "-"));
      if (found) return headers[normalized.indexOf(found)];
    }
    return undefined;
  };

  // Pour "site" : on veut "site d'affectation" mais PAS "site web"
  // → on priorise les patterns qui contiennent "affectation" ou "campus"
  const findSite = (): string | undefined => {
    // Pass 1 : exact "site" ou "campus"
    const exact = normalized.find((h) => h === "site" || h === "campus");
    if (exact) return headers[normalized.indexOf(exact)];
    // Pass 2 : "site d'affectation", "campus central", etc.
    const withQualifier = normalized.find((h) =>
      h.startsWith("site ") && (h.includes("affect") || h.includes("rattach") || h.includes("affectation"))
    );
    if (withQualifier) return headers[normalized.indexOf(withQualifier)];
    // Pass 3 : n'importe quelle colonne "site ..." qui n'est pas "site web"
    const siteNotWeb = normalized.find((h) => h.startsWith("site ") && !h.includes("web") && !h.includes("internet"));
    if (siteNotWeb) return headers[normalized.indexOf(siteNotWeb)];
    // Pass 4 : "campus ..."
    const campus = normalized.find((h) => h.startsWith("campus"));
    if (campus) return headers[normalized.indexOf(campus)];
    return undefined;
  };

  // Pour "tempsPlein" : on veut "temps", "plein", "partiel", "contrat"
  // mais PAS "type de salle" ou "type d'établissement"
  const findTemps = (): string | undefined => {
    // Pass 1 : exact
    const exact = normalized.find((h) =>
      ["temps", "plein", "partiel", "contrat", "full-time", "fulltime", "part-time", "parttime", "cdi", "cdd"].includes(h)
    );
    if (exact) return headers[normalized.indexOf(exact)];
    // Pass 2 : "temps plein", "temps partiel", "type de contrat", "type contrat"
    const qualified = normalized.find((h) =>
      h.startsWith("temps ") ||
      (h.startsWith("type ") && (h.includes("contrat") || h.includes("emploi"))) ||
      h.startsWith("contrat ") ||
      h.startsWith("full") ||
      h.startsWith("part")
    );
    if (qualified) return headers[normalized.indexOf(qualified)];
    return undefined;
  };

  // Pour "téléphone" : on veut "tel" mais PAS "atelier", "hôtel", "niveau"
  const findTel = (): string | undefined => {
    // Pass 1 : exact
    const exact = normalized.find((h) =>
      ["telephone", "téléphone", "tel", "phone", "mobile", "contact"].includes(h)
    );
    if (exact) return headers[normalized.indexOf(exact)];
    // Pass 2 : "téléphone ...", "tel ...", "phone ...", "numéro de téléphone"
    const qualified = normalized.find((h) =>
      h.startsWith("telephone ") ||
      h.startsWith("téléphone ") ||
      h.startsWith("tel ") ||
      h.startsWith("tél ") ||
      h.startsWith("phone ") ||
      h.startsWith("mobile ") ||
      h.startsWith("numéro ") ||
      h.startsWith("contact ")
    );
    if (qualified) return headers[normalized.indexOf(qualified)];
    return undefined;
  };

  return {
    nom: startsWith(["nom", "name", "lastname", "surname"]) ?? "",
    email: startsWith(["email", "mail", "courriel", "e-mail"]) ?? "",
    telephone: findTel() ?? "",
    matiere: startsWith(["matiere", "matière", "subject", "discipline", "spécialité", "specialite"]) ?? "",
    site: findSite() ?? "",
    tempsPlein: findTemps() ?? "",
  };
}

/** Empreinte du contenu — sert à reconnaître un fichier déjà importé. */
export function fileHash(buffer: ArrayBuffer): string {
  return createHash("sha256").update(Buffer.from(buffer)).digest("hex");
}

export interface ParseResult {
  rows: ParsedRow[];
  /** Lignes inexploitables : nom ou email ou site absents. */
  erreurs: { ligne: number; message: string }[];
  hash: string;
}

/**
 * Détecte si une valeur texte correspond à « temps plein » ou « temps partiel ».
 * Accepte : Plein, TP, Full, Full-time, CDI / Partiel, PP, Part-time, CDD, Vacation
 */
function parseTempsPlein(value: string | undefined): boolean | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  // Temps plein
  if (["plein", "tp", "full", "full-time", "full time", "fulltime", "cdi", "temps plein", "100%"].some((k) => v === k || v.startsWith(k + " ") || v.startsWith(k + "-"))) {
    return true;
  }
  // Temps partiel
  if (["partiel", "pp", "part", "part-time", "part time", "parttime", "cdd", "vacation", "temps partiel"].some((k) => v === k || v.startsWith(k + " ") || v.startsWith(k + "-"))) {
    return false;
  }
  // Match exact pour les valeurs courtes (évite "tp" dans un mot quelconque)
  if (v === "plein" || v === "tp" || v === "full" || v === "cdi" || v === "ft") return true;
  if (v === "partiel" || v === "pp" || v === "part" || v === "cdd" || v === "pt" || v === "vacation") return false;
  return null;
}

export async function parseEnseignantsWorkbook(
  buffer: ArrayBuffer,
  knownSites: string[] = [],
  knownSubjects: string[] = [],
): Promise<ParseResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("Aucune feuille trouvée dans le fichier");

  // ── Phase 1 : Profiler les colonnes (header + données) ────────
  const profiles = profileColumns(sheet);

  // ── Phase 2 : Inférer le mapping colonne → champ ──────────────
  // L'inférence combine le titre de la colonne ET le contenu réel
  // des cellules pour déterminer quel champ chaque colonne représente.
  // Cela permet de reconnaître une colonne "Contact" remplie d'emails,
  // ou une colonne sans titre mais remplie de numéros de téléphone.
  const { mapping: colMap, details: mappingDetails } = inferColumnMapping(
    profiles,
    knownSites,
    knownSubjects,
  );

  // ── Détection d'absence d'en-têtes ──────────────────────────────
  const colonnesReconnues = Object.keys(colMap).filter(
    (k) => colMap[k as keyof typeof colMap] !== undefined,
  );
  if (colonnesReconnues.length === 0) {
    // Vérifier si la ligne 2 ressemble à des données (contient un email)
    const row2 = sheet.getRow(2);
    let row2HasEmail = false;
    row2.eachCell((cell) => {
      const v = String(cell.value ?? "");
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) row2HasEmail = true;
    });
    if (row2HasEmail) {
      throw new Error(
        "Aucun en-tête reconnu dans la première ligne. " +
        "Vérifiez que la ligne 1 contient bien les noms de colonnes " +
        "(Nom, Email, Site d'affectation, Temps...). " +
        "Si la ligne 1 est un titre, supprimez-la et réessayez."
      );
    }
    const headersList = profiles.map((p) => p.header).filter(Boolean).join(", ") || "(vides)";
    throw new Error(
      `Aucune colonne reconnue. En-têtes attendus : nom, email, site d'affectation, temps. ` +
      `Colonnes trouvées : ${headersList}`
    );
  }

  // Vérifier que les colonnes obligatoires sont présentes
  const colonnesManquantes: string[] = [];
  if (colMap.nom === undefined) colonnesManquantes.push("Nom");
  if (colMap.email === undefined) colonnesManquantes.push("Email");
  if (colMap.site === undefined) colonnesManquantes.push("Site d'affectation");
  if (colMap.tempsPlein === undefined) colonnesManquantes.push("Temps (plein/partiel)");
  if (colonnesManquantes.length > 0) {
    const reconnuesList = colonnesReconnues.join(", ") || "aucun";
    throw new Error(
      `Colonnes obligatoires manquantes : ${colonnesManquantes.join(", ")}. ` +
      `Champs reconnus : ${reconnuesList}.`
    );
  }

  // ── Phase 3 : Extraire les données selon le mapping inféré ────
  const rows: ParsedRow[] = [];
  const erreurs: { ligne: number; message: string }[] = [];
  const emailsVus = new Set<string>();

  for (let i = 2; i <= sheet.rowCount; i++) {
    const row = sheet.getRow(i);
    let hasAnyValue = false;
    const cellValues: string[] = [];

    // Lire toutes les cellules de la ligne
    for (let col = 0; col < profiles.length; col++) {
      const cell = row.getCell(col + 1);
      const value = cell.value;
      if (value !== null && value !== undefined && String(value).trim() !== "") {
        hasAnyValue = true;
        const s = value instanceof Date ? value.toISOString() : String(value).trim();
        cellValues[col] = s;
      } else {
        cellValues[col] = "";
      }
    }

    // Ignorer les lignes complètement vides
    if (!hasAnyValue) continue;

    // Récupérer les valeurs selon le mapping inféré
    const get = (field: keyof typeof colMap): string | undefined => {
      const idx = colMap[field];
      if (idx === undefined) return undefined;
      const v = cellValues[idx];
      return v && v.length > 0 ? v : undefined;
    };

    const nom = get("nom");
    const email = get("email");
    const site = get("site");

    if (!nom) {
      erreurs.push({ ligne: i, message: "Nom manquant" });
      continue;
    }
    if (!email) {
      erreurs.push({ ligne: i, message: `Email manquant pour ${nom}` });
      continue;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      erreurs.push({ ligne: i, message: `Email invalide pour ${nom} : ${email}` });
      continue;
    }
    if (!site) {
      erreurs.push({ ligne: i, message: `Site d'affectation manquant pour ${nom}` });
      continue;
    }

    const emailLower = email.toLowerCase();
    if (emailsVus.has(emailLower)) {
      erreurs.push({ ligne: i, message: `Email en double dans le fichier : ${email}` });
      continue;
    }
    emailsVus.add(emailLower);

    const tempsPleinRaw = get("tempsPlein");
    const tempsPlein = parseTempsPlein(tempsPleinRaw);
    if (tempsPlein === null) {
      erreurs.push({
        ligne: i,
        message: `Valeur « temps plein/partiel » non reconnue pour ${nom} : « ${tempsPleinRaw ?? ""} ». Valeurs acceptées : Plein, Partiel, CDI, CDD, Full-time, Part-time...`,
      });
      continue;
    }

    rows.push({
      ligne: i,
      nom,
      email: emailLower,
      telephone: get("telephone"),
      matiere: get("matiere"),
      site,
      tempsPlein,
    });
  }

  return { rows, erreurs, hash: fileHash(buffer) };
}

// ------------------------------------------------------------
// Analyse
// ------------------------------------------------------------

export type Verdict =
  /** Aucun rapprochement : enseignant inconnu, prêt à créer. */
  | "NOUVEAU"
  /** Email déjà utilisé par un utilisateur existant (tous tenants confondus). */
  | "EMAIL_EXISTANT"
  /** La matière indiquée n'existe pas dans l'établissement. */
  | "MATIERE_INCONNUE"
  /** Le site indiqué n'existe pas dans l'établissement. */
  | "SITE_INCONNU"
  /** La même adresse email apparaît plusieurs fois dans le fichier. */
  | "DOUBLON_FICHIER"
  /** Ligne inexploitable en l'état. */
  | "ERREUR";

export type Action = "CREER" | "IGNORER";

export interface FicheExistante {
  id: string;
  email: string;
  name: string;
}

export interface MatiereExistante {
  id: string;
  nom: string;
  code: string;
}

export interface SiteExistant {
  id: string;
  nom: string;
}

export interface LignePlan {
  ligne: number;
  nom: string;
  email: string;
  telephone?: string;
  matiere?: string;
  site: string;
  tempsPlein: boolean;
  verdict: Verdict;
  message: string;
  /** Action appliquée si l'utilisateur ne change rien. */
  action: Action;
  /** IDs résolus côté serveur (matière, site) — remplis lors de l'analyse. */
  matiereId?: string;
  siteId?: string;
}

export interface PlanImport {
  hash: string;
  lignes: LignePlan[];
  resume: {
    total: number;
    aCreer: number;
    aIgnorer: number;
    erreurs: number;
    matieresInconnues: number;
    sitesInconnus: number;
  };
  /** Import antérieur du même fichier, le cas échéant. */
  dejaImporte?: { date: string; par: string | null };
  matieresInconnues: string[];
  sitesInconnus: string[];
}

/**
 * Construit le plan d'import à partir des lignes parsées et du contexte
 * de l'établissement (emails existants, matières, sites).
 */
export function analyzeImport(
  rows: ParsedRow[],
  erreurs: { ligne: number; message: string }[],
  emailsExistants: Set<string>,
  matieres: MatiereExistante[],
  sites: SiteExistant[],
  hash: string,
): PlanImport {
  // Index pour la recherche (insensible à la casse)
  const matiereByNom = new Map<string, MatiereExistante>();
  for (const m of matieres) {
    matiereByNom.set(m.nom.toLowerCase().trim(), m);
  }
  const siteByNom = new Map<string, SiteExistant>();
  for (const s of sites) {
    siteByNom.set(s.nom.toLowerCase().trim(), s);
  }

  const matieresInconnuesSet = new Set<string>();
  const sitesInconnusSet = new Set<string>();

  // Lignes d'erreur du parsing
  const lignesErreur: LignePlan[] = erreurs.map((e) => ({
    ligne: e.ligne,
    nom: "",
    email: "",
    site: "",
    tempsPlein: true,
    verdict: "ERREUR",
    message: e.message,
    action: "IGNORER",
  }));

  const lignes: LignePlan[] = rows.map((r) => {
    // 1. Email déjà existant ?
    if (emailsExistants.has(r.email)) {
      return {
        ...r,
        verdict: "EMAIL_EXISTANT",
        message: `Un utilisateur avec l'email ${r.email} existe déjà`,
        action: "IGNORER",
      };
    }

    // 2. Site inconnu ?
    const site = siteByNom.get(r.site.toLowerCase().trim());
    if (!site) {
      sitesInconnusSet.add(r.site);
      return {
        ...r,
        verdict: "SITE_INCONNU",
        message: `Site « ${r.site} » introuvable dans l'établissement`,
        action: "IGNORER",
      };
    }

    // 3. Matière inconnue ? (optionnelle — si fournie mais inconnue, on signale)
    let matiereId: string | undefined;
    if (r.matiere) {
      const matiere = matiereByNom.get(r.matiere.toLowerCase().trim());
      if (!matiere) {
        matieresInconnuesSet.add(r.matiere);
        // La matière est optionnelle : on crée quand même l'enseignant sans matière
        return {
          ...r,
          verdict: "MATIERE_INCONNUE",
          message: `Matière « ${r.matiere} » introuvable — l'enseignant sera créé sans matière (à affecter plus tard)`,
          action: "CREER",
          siteId: site.id,
        };
      }
      matiereId = matiere.id;
    }

    // 4. Tout est bon → nouveau
    return {
      ...r,
      verdict: "NOUVEAU",
      message: "Nouvel enseignant — sera créé",
      action: "CREER",
      matiereId,
      siteId: site.id,
    };
  });

  const toutesLignes = [...lignesErreur, ...lignes];

  const resume = {
    total: toutesLignes.length,
    aCreer: toutesLignes.filter((l) => l.action === "CREER").length,
    aIgnorer: toutesLignes.filter((l) => l.action === "IGNORER").length,
    erreurs: lignesErreur.length,
    matieresInconnues: matieresInconnuesSet.size,
    sitesInconnus: sitesInconnusSet.size,
  };

  return {
    hash,
    lignes: toutesLignes,
    resume,
    matieresInconnues: [...matieresInconnuesSet],
    sitesInconnus: [...sitesInconnusSet],
  };
}
