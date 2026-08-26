/**
 * École Miriam — Import du personnel (staff non-enseignant)
 * ==========================================================
 *
 * Lecture d'un fichier Excel et construction d'un plan d'import
 * pour les membres du personnel : secrétaires, gestionnaires,
 * comptables, infirmiers, conseillers, surveillants.
 */

import ExcelJS from "exceljs";
import { createHash } from "crypto";
import { profileColumns, inferColumnMapping } from "@/lib/column-inference";

// ------------------------------------------------------------
// Types
// ------------------------------------------------------------

export interface PersonnelRow {
  ligne: number;
  nom: string;
  email: string;
  telephone?: string;
  site: string;
  role: string;
  fonction?: string;
}

export interface ParsePersonnelResult {
  rows: PersonnelRow[];
  erreurs: { ligne: number; message: string }[];
  hash: string;
}

export type PersonnelVerdict =
  | "NOUVEAU"
  | "EMAIL_EXISTANT"
  | "SITE_INCONNU"
  | "ROLE_INCONNU"
  | "ERREUR";

export type PersonnelAction = "CREER" | "IGNORER";

export interface PersonnelLignePlan {
  ligne: number;
  nom: string;
  email: string;
  telephone?: string;
  site: string;
  role: string;
  fonction?: string;
  verdict: PersonnelVerdict;
  message: string;
  action: PersonnelAction;
  siteId?: string;
  resolvedRole?: string;
}

export interface PersonnelPlanImport {
  hash: string;
  lignes: PersonnelLignePlan[];
  resume: {
    total: number;
    aCreer: number;
    aIgnorer: number;
    erreurs: number;
    sitesInconnus: number;
    rolesInconnus: number;
  };
  dejaImporte?: { date: string; par: string | null };
  sitesInconnus: string[];
  rolesInconnus: string[];
}

// ------------------------------------------------------------
// Mapping des rôles textuels → enum Role
// ------------------------------------------------------------

const ROLE_MAP: Record<string, string> = {
  SECRETAIRE: "SECRETARY",
  SECRETARY: "SECRETARY",
  SECRÉTAIRE: "SECRETARY",
  GESTIONNAIRE: "ACCOUNTANT",
  COMPTABLE: "ACCOUNTANT",
  ACCOUNTANT: "ACCOUNTANT",
  INFIRMIER: "NURSE",
  INFIRMIERE: "NURSE",
  NURSE: "NURSE",
  CONSEILLER: "COUNSELOR",
  CONSEILLERE: "COUNSELOR",
  COUNSELOR: "COUNSELOR",
  CPE: "COUNSELOR",
  SURVEILLANT: "PRINCIPAL",
  SURVEILLANTE: "PRINCIPAL",
};

export function resolveRole(roleText: string): string | undefined {
  const normalized = roleText.trim().toUpperCase();
  return ROLE_MAP[normalized];
}

// ------------------------------------------------------------
// Parsing
// ------------------------------------------------------------

function fileHash(buffer: ArrayBuffer): string {
  return createHash("sha256").update(Buffer.from(buffer)).digest("hex");
}

export async function parsePersonnelWorkbook(
  buffer: ArrayBuffer,
  knownSites: string[] = [],
): Promise<ParsePersonnelResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("Aucune feuille trouvée dans le fichier");

  const profiles = profileColumns(sheet);

  // Inférer le mapping — on réutilise le système générique
  // puis on ajoute la déduction de "role" et "fonction" manuellement
  const { mapping: colMap } = inferColumnMapping(profiles, knownSites, []);

  // Détection spécifique pour "role" et "fonction" (non gérés par column-inference)
  const normalized = profiles.map((p) => p.header);
  const findRole = (): number | undefined => {
    // Pass 1 : exact
    const exactIdx = normalized.findIndex((h) =>
      ["role", "rôle", "poste", "fonction", "emploi", "statut"].includes(h)
    );
    if (exactIdx >= 0) return exactIdx;
    // Pass 2 : commence par
    const prefixIdx = normalized.findIndex((h) =>
      h.startsWith("role ") || h.startsWith("rôle ") || h.startsWith("poste ") || h.startsWith("fonction ")
    );
    if (prefixIdx >= 0) return prefixIdx;
    return undefined;
  };

  const findFonction = (): number | undefined => {
    const exactIdx = normalized.findIndex((h) =>
      ["fonction", "intitulé", "intitule", "description poste", "job title"].includes(h)
    );
    if (exactIdx >= 0) return exactIdx;
    return undefined;
  };

  const roleCol = findRole();
  const fonctionCol = findFonction();

  // Vérifier qu'on a au moins les colonnes essentielles
  const colonnesReconnues = [
    colMap.nom !== undefined ? "nom" : null,
    colMap.email !== undefined ? "email" : null,
    colMap.site !== undefined ? "site" : null,
    roleCol !== undefined ? "role" : null,
  ].filter(Boolean);

  if (colonnesReconnues.length === 0) {
    const headersList = profiles.map((p) => p.header).filter(Boolean).join(", ") || "(vides)";
    throw new Error(
      `Le fichier et les en-têtes ne correspondent pas au format attendu. ` +
      `En-têtes attendus : Nom, Email, Site d'affectation, Rôle, Téléphone, Fonction. ` +
      `Colonnes trouvées : ${headersList}. ` +
      `Téléchargez le modèle d'exemple depuis l'écran d'import, remplissez-le avec vos données, puis réessayez.`
    );
  }

  const colonnesManquantes: string[] = [];
  if (colMap.nom === undefined) colonnesManquantes.push("Nom");
  if (colMap.email === undefined) colonnesManquantes.push("Email");
  if (colMap.site === undefined) colonnesManquantes.push("Site d'affectation");
  if (roleCol === undefined) colonnesManquantes.push("Rôle");
  if (colonnesManquantes.length > 0) {
    throw new Error(
      `Colonnes obligatoires manquantes : ${colonnesManquantes.join(", ")}. ` +
      `Champs reconnus : ${colonnesReconnues.join(", ")}. ` +
      `Téléchargez le modèle d'exemple depuis l'écran d'import.`
    );
  }

  const rows: PersonnelRow[] = [];
  const erreurs: { ligne: number; message: string }[] = [];
  const emailsVus = new Set<string>();

  for (let i = 2; i <= sheet.rowCount; i++) {
    const row = sheet.getRow(i);
    let hasAnyValue = false;
    const cellValues: string[] = [];

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

    if (!hasAnyValue) continue;

    const get = (idx: number | undefined): string | undefined => {
      if (idx === undefined) return undefined;
      const v = cellValues[idx];
      return v && v.length > 0 ? v : undefined;
    };

    const nom = get(colMap.nom);
    const email = get(colMap.email);
    const site = get(colMap.site);
    const role = get(roleCol);
    const telephone = get(colMap.telephone);
    const fonction = get(fonctionCol);

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
    if (!role) {
      erreurs.push({ ligne: i, message: `Rôle manquant pour ${nom}` });
      continue;
    }

    const emailLower = email.toLowerCase();
    if (emailsVus.has(emailLower)) {
      erreurs.push({ ligne: i, message: `Email en double dans le fichier : ${email}` });
      continue;
    }
    emailsVus.add(emailLower);

    rows.push({
      ligne: i,
      nom,
      email: emailLower,
      telephone,
      site,
      role,
      fonction,
    });
  }

  return { rows, erreurs, hash: fileHash(buffer) };
}

// ------------------------------------------------------------
// Analyse
// ------------------------------------------------------------

export interface PersonnelSiteExistant {
  id: string;
  nom: string;
}

export function analyzePersonnelImport(
  rows: PersonnelRow[],
  erreurs: { ligne: number; message: string }[],
  emailsExistants: Set<string>,
  sites: PersonnelSiteExistant[],
  hash: string,
): PersonnelPlanImport {
  const siteByNom = new Map<string, PersonnelSiteExistant>();
  for (const s of sites) {
    siteByNom.set(s.nom.toLowerCase().trim(), s);
  }

  const sitesInconnusSet = new Set<string>();
  const rolesInconnusSet = new Set<string>();

  const lignesErreur: PersonnelLignePlan[] = erreurs.map((e) => ({
    ligne: e.ligne,
    nom: "",
    email: "",
    site: "",
    role: "",
    verdict: "ERREUR",
    message: e.message,
    action: "IGNORER",
  }));

  const lignes: PersonnelLignePlan[] = rows.map((r) => {
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

    // 3. Rôle inconnu ?
    const resolvedRole = resolveRole(r.role);
    if (!resolvedRole) {
      rolesInconnusSet.add(r.role);
      return {
        ...r,
        verdict: "ROLE_INCONNU",
        message: `Rôle « ${r.role} » non reconnu. Rôles acceptés : SECRETAIRE, GESTIONNAIRE, COMPTABLE, INFIRMIER, CONSEILLER, SURVEILLANT`,
        action: "IGNORER",
      };
    }

    // 4. Tout est bon → nouveau
    return {
      ...r,
      verdict: "NOUVEAU",
      message: "Nouveau membre du personnel — sera créé",
      action: "CREER",
      siteId: site.id,
      resolvedRole,
    };
  });

  const toutesLignes = [...lignesErreur, ...lignes];

  const resume = {
    total: toutesLignes.length,
    aCreer: toutesLignes.filter((l) => l.action === "CREER").length,
    aIgnorer: toutesLignes.filter((l) => l.action === "IGNORER").length,
    erreurs: lignesErreur.length,
    sitesInconnus: sitesInconnusSet.size,
    rolesInconnus: rolesInconnusSet.size,
  };

  return {
    hash,
    lignes: toutesLignes,
    resume,
    sitesInconnus: [...sitesInconnusSet],
    rolesInconnus: [...rolesInconnusSet],
  };
}
