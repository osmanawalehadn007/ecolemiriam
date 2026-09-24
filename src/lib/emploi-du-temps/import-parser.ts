/**
 * École Miriam — Parsing d'import d'emploi du temps
 * ====================================================
 * Lit un fichier Excel (.xlsx) ou CSV et extrait une liste de créneaux
 * « bruts » (jour, heureDebut, heureFin, matière, enseignant, salle).
 *
 * Deux formats sont reconnus automatiquement :
 *
 *  1. Format LISTE (round-trip avec l'export Excel existant) :
 *     Colonnes : Jour | Heure début | Heure fin | Matière | Classe | Enseignant | Salle
 *     Une ligne = un créneau. C'est le format produit par /api/emploi-du-temps/export.
 *
 *  2. Format GRILLE (tableau visuel tel qu'un directeur le reçoit) :
 *     Première colonne : Horaire (ex: "08:00-09:00")
 *     Colonnes suivantes : jours (Lundi, Mardi, … Samedi)
 *     Cellule : "Mathématiques / M. Ahmed / Salle 1" (séparateurs : / | \n ;)
 *
 * Le snapping à la grille affichée (pas de 10 min pour maternel/primaire,
 * 30 min pour collège/lycée) se fait via snapTimeToGrid().
 */

import ExcelJS from "exceljs";
import Papa from "papaparse";
import JSZip from "jszip";
import { normalizeText, normalizeHeure } from "@/lib/text-match";
import {
  GRID_STEP_FINE,
  GRID_STEP_STANDARD,
  DAY_START,
  DAY_END,
  FINE_GRID_TYPES,
} from "@/lib/emploi-du-temps/grid-config";

// ──────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────

export type Jour = "DIMANCHE" | "LUNDI" | "MARDI" | "MERCREDI" | "JEUDI" | "VENDREDI" | "SAMEDI";

/** Mapping libellé français → enum Jour. */
const JOUR_LABELS: Record<string, Jour> = {
  dimanche: "DIMANCHE", dim: "DIMANCHE", sun: "DIMANCHE",
  lundi: "LUNDI", lun: "LUNDI", mon: "LUNDI",
  mardi: "MARDI", mar: "MARDI", tue: "MARDI",
  mercredi: "MERCREDI", mer: "MERCREDI", wed: "MERCREDI",
  jeudi: "JEUDI", jeu: "JEUDI", thu: "JEUDI",
  vendredi: "VENDREDI", ven: "VENDREDI", fri: "VENDREDI",
  samedi: "SAMEDI", sam: "SAMEDI", sat: "SAMEDI",
};

/** Créneau brut extrait du fichier (noms textuels, pas encore résolus en IDs). */
export interface RawCreneau {
  jour: Jour;
  heureDebut: string; // "HH:MM"
  heureFin: string; // "HH:MM"
  matiere: string;
  enseignant: string | null;
  salle: string | null;
  /** Ligne d'origine dans le fichier (pour les messages d'erreur). */
  sourceLine: number;
  /** Avertissements de snapping/normalisation. */
  warnings: string[];
  /** True si ce créneau est une évaluation/examen (pas un cours de matière). */
  isEvaluation: boolean;
}

export interface ParseResult {
  format: "list" | "grid" | "unknown";
  rawCreneaux: RawCreneau[];
  errors: string[];
  /** Métadonnées extraites d'un .docx (classe, année scolaire, texte). */
  docxMetadata?: DocxMetadata;
}

// ──────────────────────────────────────────────────────────────
// Nettoyage des noms de matières
// ──────────────────────────────────────────────────────────────

/**
 * Regex capturant les annotations de durée dans les cellules de grille.
 * Exemples matchés : "40 min", "30 ou 40 min", "50 à 60 min", "15 ou 20 min",
 * "20 ou 25 min", "20min", "40min".
 */
const DURATION_PATTERN = /\s+\d+\s*(?:à|a|ou|or)\s*\d*\s*min\b|\s+\d+\s*min\b/gi;

/**
 * Nettoie le nom d'une matière en supprimant les annotations de durée
 * et les parenthèses explicatives.
 *
 * Ex: "Lecture 40 min"           → "Lecture"
 *     "EMT (écriture) 15 ou 20"  → "EMT (écriture)"
 *     "MATHEMATIQUES 50 à 60 min" → "MATHEMATIQUES"
 *     "Dictée 1 15 ou 20 min"    → "Dictée 1"
 */
export function cleanMatiereName(raw: string): string {
  let cleaned = raw;
  // 1. Supprimer les annotations de durée ("40 min", "30 ou 40 min", etc.)
  cleaned = cleaned.replace(DURATION_PATTERN, "");
  // 2. Supprimer les fragments orphelins "15 ou 20" sans "min" (ex: "Dictée 1 15  ou 20 min")
  cleaned = cleaned.replace(/\s+\d+\s+ou\s+\d+\s*$/i, "");
  // 3. Trim des espaces multiples restants
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  return cleaned;
}

// ──────────────────────────────────────────────────────────────
// Détection des temps libres (récréation, pause)
// ──────────────────────────────────────────────────────────────

/**
 * Mots-clés indiquant un temps libre (pas un cours).
 * Détectés dans le contenu d'une cellule, indépendamment de la casse.
 */
const RECREATION_KEYWORDS = [
  "recreation", "récréation", "recre", "récré",
  "pause", "recess", "break",
  "dejeuner", "déjeuner", "lunch",
  "libre", "free",
];

/**
 * Vérifie si une cellule correspond à un temps libre (récréation, pause déjeuner…).
 * Ces créneaux sont ignorés lors de l'import (pas de cours créé).
 */
function isRecreation(cellText: string): boolean {
  const norm = normalizeText(cellText);
  return RECREATION_KEYWORDS.some((kw) => norm.includes(normalizeText(kw)));
}

/**
 * Mots-clés indiquant une évaluation/examen (pas un cours de matière).
 * Pour le primaire, "évaluation" est un temps d'évaluation régulière.
 */
const EVALUATION_KEYWORDS = [
  "evaluation", "évaluation", "eval", "éval",
  "examen", "exam", "test", "controle", "contrôle",
  "devoir", "composition", "interrogation",
];

/**
 * Vérifie si une cellule correspond à une évaluation/examen.
 * Ces créneaux sont marqués `isEvaluation = true` et ne nécessitent pas
 * de matière dans la DB.
 */
function isEvaluation(cellText: string): boolean {
  const norm = normalizeText(cellText);
  return EVALUATION_KEYWORDS.some((kw) => norm.includes(normalizeText(kw)));
}

// ──────────────────────────────────────────────────────────────
// Utilitaires temps
// ──────────────────────────────────────────────────────────────

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function minutesToTime(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Résout un libellé de jour ("Lundi", "lun", "Monday"…) vers l'enum Jour. */
export function resolveJour(raw: string): Jour | null {
  const n = normalizeText(raw);
  if (JOUR_LABELS[n]) return JOUR_LABELS[n];
  // Recherche par préfixe (ex: "lundi" contient déjà, mais "lun." → "lun")
  for (const [label, jour] of Object.entries(JOUR_LABELS)) {
    if (n.startsWith(label) || label.startsWith(n)) return jour;
  }
  return null;
}

/**
 * Snap une heure vers le slot de grille le plus proche.
 * @param time  Heure source "HH:MM"
 * @param stepMinutes  Pas de grille (10 ou 30)
 * @param direction  "down" pour un début (arrondi inférieur), "up" pour une fin (arrondi supérieur)
 * @param dayStart  Heure de début de journée ("07:00")
 * @returns  { time: "HH:MM", snapped: boolean, deltaMin: number }
 */
export function snapTimeToGrid(
  time: string,
  stepMinutes: number,
  direction: "down" | "up",
  dayStart: string = DAY_START,
  dayEnd: string = DAY_END,
): { time: string; snapped: boolean; deltaMin: number } {
  const tMin = timeToMinutes(time);
  const startMin = timeToMinutes(dayStart);
  const endMin = timeToMinutes(dayEnd);

  // Bornage dans la plage horaire
  const clamped = Math.max(startMin, Math.min(endMin, tMin));

  const offset = clamped - startMin;
  const slotIdx = Math.floor(offset / stepMinutes);
  const slotMin = startMin + slotIdx * stepMinutes;
  const nextSlotMin = slotMin + stepMinutes;

  let snappedMin: number;
  if (direction === "down") {
    snappedMin = slotMin;
  } else {
    // "up" : si on est exactement sur un slot, on y reste ; sinon slot suivant
    snappedMin = clamped === slotMin ? slotMin : nextSlotMin;
  }

  // Re-borner (le slot suivant peut dépasser dayEnd)
  snappedMin = Math.min(snappedMin, endMin);

  const delta = snappedMin - tMin;
  return {
    time: minutesToTime(snappedMin),
    snapped: delta === 0,
    deltaMin: delta,
  };
}

/** Détermine le pas de grille selon le type de structure de la classe. */
export function gridStepForStructure(structureType: string | null | undefined): number {
  return structureType && FINE_GRID_TYPES.has(structureType) ? GRID_STEP_FINE : GRID_STEP_STANDARD;
}

// ──────────────────────────────────────────────────────────────
// Parsing CSV / Excel → matrice de cellules
// ──────────────────────────────────────────────────────────────

type CellMatrix = string[][];

async function parseExcel(buffer: Buffer | ArrayBuffer | Uint8Array): Promise<CellMatrix> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const rows: string[][] = [];
  ws.eachRow((row) => {
    const values: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      values[colNumber - 1] = cellValueToString(cell.value);
    });
    rows.push(values);
  });
  return rows;
}

function cellValueToString(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "1" : "0";
  if (v instanceof Date) {
    // Une cellule "heure" peut arriver en tant que Date (Excel stocke les heures
    // comme fraction de jour) — on extrait HH:MM.
    const h = v.getHours();
    const m = v.getMinutes();
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }
  // Hyperlink / formule : on prend le texte résultat
  if (typeof v === "object" && "text" in v && typeof (v as { text: unknown }).text === "string") {
    return (v as { text: string }).text.trim();
  }
  if (typeof v === "object" && "result" in v && (v as { result: unknown }).result != null) {
    return String((v as { result: unknown }).result).trim();
  }
  return String(v).trim();
}

function parseCsv(text: string): CellMatrix {
  const result = Papa.parse<string[]>(text, {
    skipEmptyLines: true,
    delimiter: "", // auto-détection
  });
  return (result.data as string[][]).map((row) => row.map((c) => (c ?? "").trim()));
}

// ──────────────────────────────────────────────────────────────
// Parsing .docx (Word) → matrice de cellules + métadonnées
// ──────────────────────────────────────────────────────────────

/** Métadonnées extraites du texte autour des tables dans un .docx. */
export interface DocxMetadata {
  /** Nom de classe détecté (ex: "6ème A") ou null. */
  classe: string | null;
  /** Année scolaire détectée (ex: "2026-2027") ou null. */
  annee: string | null;
  /** Lignes de texte brut hors table (pour debug/affichage). */
  textLines: string[];
}

/** Résultat du parsing .docx : tables + métadonnées. */
interface DocxParseResult {
  tables: CellMatrix[];
  metadata: DocxMetadata;
}

/**
 * Parse un fichier .docx (archive OOXML) et extrait :
 *  - les tables Word (convertis en CellMatrix, comme Excel/CSV)
 *  - le texte environnant (paragraphes hors table) pour détecter la classe, l'année, etc.
 *
 * Un .docx est un ZIP contenant `word/document.xml`. Les tables y sont
 * stockées comme `<w:tbl>` > `<w:tr>` (lignes) > `<w:tc>` (cellules),
 * le texte étant dans des `<w:t>`.
 */
async function parseDocx(buffer: Buffer): Promise<DocxParseResult> {
  const zip = await JSZip.loadAsync(buffer);
  const docFile = zip.file("word/document.xml");
  if (!docFile) {
    throw new Error("word/document.xml introuvable dans l'archive .docx");
  }
  const xml = await docFile.async("string");

  // ── Extraire le texte des paragraphes qui ne sont PAS dans une table ──
  // On retire d'abord les <w:tbl>...</w:tbl> du XML, puis on récupère les <w:t>
  const xmlSansTables = xml.replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g, "");
  const textLines: string[] = [];
  // Split sur <w:p> pour récupérer chaque paragraphe
  const paras = xmlSansTables.split(/<w:p[\s>]/);
  for (const p of paras) {
    const tMatches = p.match(/<w:t[^>]*>([^<]*)<\/w:t>/g);
    if (tMatches) {
      const line = tMatches.map((t) => t.replace(/<[^>]+>/g, "")).join("");
      if (line.trim()) textLines.push(line.trim());
    }
  }

  // ── Détecter la classe et l'année dans le texte ──
  let classe: string | null = null;
  let annee: string | null = null;
  for (const line of textLines) {
    if (!classe) {
      const m = line.match(/classe\s*[:\-]\s*(.+?)(?:\s*[-—]|$)/i);
      if (m) classe = m[1].trim();
    }
    if (!annee) {
      const m = line.match(/ann[eé]e\s*scolaire\s*[:\-]\s*(\d{4}\s*[-–—]\s*\d{4})/i);
      if (m) annee = m[1].replace(/\s+/g, "").trim();
    }
  }

  // ── Extraire les tables ──
  const tables: CellMatrix[] = [];
  const tblMatches = xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g);
  if (tblMatches) {
    for (const tblXml of tblMatches) {
      const rows: string[][] = [];
      const trMatches = tblXml.match(/<w:tr[\s>][\s\S]*?<\/w:tr>/g);
      if (!trMatches) continue;

      for (const trXml of trMatches) {
        const cells: string[] = [];
        const tcMatches = trXml.match(/<w:tc>[\s\S]*?<\/w:tc>/g);
        if (!tcMatches) continue;

        for (const tcXml of tcMatches) {
          // Une cellule peut contenir plusieurs <w:p> — on concatène avec un espace
          const tMatches = tcXml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g);
          let cellText = "";
          if (tMatches) {
            cellText = tMatches.map((t) => t.replace(/<[^>]+>/g, "")).join(" ");
          }
          cells.push(cellText.trim());
        }
        rows.push(cells);
      }
      if (rows.length > 0) tables.push(rows);
    }
  }

  return {
    tables,
    metadata: { classe, annee, textLines },
  };
}

// ──────────────────────────────────────────────────────────────
// Détection du format
// ──────────────────────────────────────────────────────────────

interface HeaderInfo {
  format: "list" | "grid" | "unknown";
  /** Pour le format liste : index des colonnes. */
  colJour?: number;
  colDebut?: number;
  colFin?: number;
  colMatiere?: number;
  colClasse?: number;
  colEnseignant?: number;
  colSalle?: number;
  /** Pour le format grille : index de la colonne horaire + mapping colonne→Jour. */
  colHoraire?: number;
  dayColumns?: { col: number; jour: Jour }[];
}

function detectFormat(rows: CellMatrix): HeaderInfo {
  if (rows.length === 0) return { format: "unknown" };
  const header = rows[0].map((h) => normalizeText(h));

  // Format grille : une colonne "horaire"/"heure"/"horaire"/"créneau" + des jours
  const horaireIdx = header.findIndex((h) =>
    /horaire|heure|creneau|time|slot/.test(h),
  );
  if (horaireIdx >= 0) {
    const dayColumns: { col: number; jour: Jour }[] = [];
    for (let i = 0; i < header.length; i++) {
      if (i === horaireIdx) continue;
      const jour = resolveJour(header[i]);
      if (jour) dayColumns.push({ col: i, jour });
    }
    if (dayColumns.length >= 2) {
      return { format: "grid", colHoraire: horaireIdx, dayColumns };
    }
  }

  // Format liste : recherche des colonnes connues
  const findCol = (patterns: RegExp[]): number =>
    header.findIndex((h) => patterns.some((p) => p.test(h)));

  const colJour = findCol([/^jour$/, /^day$/]);
  const colDebut = findCol([/debut/, /start/, /^heure/]);
  const colFin = findCol([/fin/, /end/]);
  const colMatiere = findCol([/matiere/, /subject/, /mati/]);
  const colClasse = findCol([/classe/, /class/]);
  const colEnseignant = findCol([/enseignant/, /prof/, /teacher/]);
  const colSalle = findCol([/salle/, /room/]);

  // Il faut au minimum jour + début + fin + matière
  if (colJour >= 0 && colDebut >= 0 && colMatiere >= 0) {
    return {
      format: "list",
      colJour,
      colDebut,
      colFin: colFin >= 0 ? colFin : -1,
      colMatiere,
      colClasse: colClasse >= 0 ? colClasse : -1,
      colEnseignant: colEnseignant >= 0 ? colEnseignant : -1,
      colSalle: colSalle >= 0 ? colSalle : -1,
    };
  }

  return { format: "unknown" };
}

// ──────────────────────────────────────────────────────────────
// Extraction des créneaux bruts
// ──────────────────────────────────────────────────────────────

/** Parse une cellule de matière au format grille : "Maths / M. Ahmed / Salle 1". */
function parseGridCell(cell: string): { matiere: string; enseignant: string | null; salle: string | null } {
  // Séparateurs : / | \n ; —
  const parts = cell.split(/[/|;\n—]|-{2,}/).map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return { matiere: "", enseignant: null, salle: null };
  // Nettoyer le nom de matière : supprimer les durées ("40 min", "30 ou 40 min", etc.)
  const matiere = cleanMatiereName(parts[0]);
  const enseignant = parts.length > 1 && parts[1] ? parts[1] : null;
  const salle = parts.length > 2 && parts[2] ? parts[2] : null;
  return { matiere, enseignant, salle };
}

/** Parse une plage horaire "08:00-09:00" ou "08h00-09h00" ou "08:00 – 09:00". */
function parseTimeRange(raw: string): { debut: string | null; fin: string | null } {
  const cleaned = raw.replace(/[–—]/g, "-").trim();
  // "08:00-09:00"
  const m = cleaned.match(/(\d{1,2}\s*[h:]\s*\d{0,2})\s*[-àà]\s*(\d{1,2}\s*[h:]\s*\d{0,2})/i);
  if (m) {
    const debut = normalizeHeure(m[1]);
    const fin = normalizeHeure(m[2]);
    return { debut, fin };
  }
  // Heure seule "08:00" → début only, fin sera déduite
  const single = normalizeHeure(cleaned);
  return { debut: single, fin: null };
}

function parseListFormat(rows: CellMatrix, info: HeaderInfo): RawCreneau[] {
  const creneaux: RawCreneau[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every((c) => !c)) continue;

    const jourRaw = row[info.colJour!] ?? "";
    const jour = resolveJour(jourRaw);
    if (!jour) {
      creneaux.push({
        jour: "LUNDI", heureDebut: "08:00", heureFin: "09:00",
        matiere: "", enseignant: null, salle: null,
        sourceLine: r + 1, warnings: [`Jour non reconnu : « ${jourRaw} »`],
        isEvaluation: false,
      });
      continue;
    }

    const matiereRaw = (info.colMatiere! >= 0 ? row[info.colMatiere!] : "") ?? "";

    // Ignorer les récréations / pauses (temps libre)
    if (isRecreation(matiereRaw)) continue;

    const debut = normalizeHeure(row[info.colDebut!] ?? "");
    const fin = info.colFin! >= 0 ? normalizeHeure(row[info.colFin!] ?? "") : null;
    const enseignant = info.colEnseignant! >= 0 ? (row[info.colEnseignant!] || null) : null;
    const salle = info.colSalle! >= 0 ? (row[info.colSalle!] || null) : null;

    // Détecter si c'est une évaluation (pas une matière normale)
    const evalMode = isEvaluation(matiereRaw);

    const warnings: string[] = [];
    if (!debut) warnings.push("Heure de début invalide");
    if (info.colFin! >= 0 && !fin) warnings.push("Heure de fin invalide");

    creneaux.push({
      jour,
      heureDebut: debut ?? "08:00",
      heureFin: fin ?? "09:00",
      matiere: evalMode ? "Évaluation" : matiereRaw.trim(),
      enseignant: enseignant?.trim() || null,
      salle: salle?.trim() || null,
      sourceLine: r + 1,
      warnings,
      isEvaluation: evalMode,
    });
  }
  return creneaux;
}

function parseGridFormat(rows: CellMatrix, info: HeaderInfo): RawCreneau[] {
  const creneaux: RawCreneau[] = [];
  const dayColumns = info.dayColumns!;

  // Calculer l'heure de fin par défaut depuis la ligne suivante (grille visuelle).
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every((c) => !c)) continue;

    const horaireRaw = row[info.colHoraire!] ?? "";
    const { debut, fin } = parseTimeRange(horaireRaw);
    if (!debut) continue;

    // Fin par défaut : heure de début de la ligne suivante, sinon +60 min.
    let resolvedFin = fin;
    if (!resolvedFin) {
      if (r + 1 < rows.length) {
        const nextHoraire = rows[r + 1][info.colHoraire!] ?? "";
        const next = parseTimeRange(nextHoraire);
        if (next.debut && timeToMinutes(next.debut) > timeToMinutes(debut)) {
          resolvedFin = next.debut;
        }
      }
      if (!resolvedFin) resolvedFin = minutesToTime(timeToMinutes(debut) + 60);
    }

    for (const { col, jour } of dayColumns) {
      const cell = (row[col] ?? "").trim();
      if (!cell) continue;

      // Ignorer les récréations / pauses (temps libre)
      if (isRecreation(cell)) continue;

      const { matiere, enseignant, salle } = parseGridCell(cell);
      if (!matiere) continue;

      // Détecter si c'est une évaluation (pas une matière normale)
      const evalMode = isEvaluation(cell);

      creneaux.push({
        jour,
        heureDebut: debut,
        heureFin: resolvedFin,
        matiere: evalMode ? "Évaluation" : matiere,
        enseignant,
        salle,
        sourceLine: r + 1,
        warnings: [],
        isEvaluation: evalMode,
      });
    }
  }
  return creneaux;
}

// ──────────────────────────────────────────────────────────────
// API publique
// ──────────────────────────────────────────────────────────────

/**
 * Parse un fichier Excel, CSV ou Word (.docx) en créneaux bruts.
 * @param buffer  Contenu du fichier
 * @param filename  Nom (pour détecter l'extension)
 */
export async function parseScheduleFile(buffer: Buffer, filename: string): Promise<ParseResult> {
  let rows: CellMatrix;
  let docxMetadata: DocxMetadata | undefined;

  try {
    if (/\.xlsx$/i.test(filename)) {
      rows = await parseExcel(buffer);
    } else if (/\.doc$/i.test(filename) && !/\.docx$/i.test(filename)) {
      // .doc (format binaire OLE ancien) n'est pas un ZIP — non supporté.
      // L'utilisateur doit convertir en .docx (Format Office Open XML).
      return {
        format: "unknown",
        rawCreneaux: [],
        errors: [
          "Le format .doc (Word 97-2003) n'est pas supporté. Convertissez le fichier en .docx (Word 2007+) ou en .xlsx/.csv.",
        ],
      };
    } else if (/\.docx$/i.test(filename)) {
      // Un .docx peut contenir plusieurs tables — on prend la plus grande
      // (celle qui a le plus de colonnes, typiquement la grille horaire).
      const docxResult = await parseDocx(buffer);
      docxMetadata = docxResult.metadata;
      if (docxResult.tables.length === 0) {
        return {
          format: "unknown",
          rawCreneaux: [],
          errors: ["Aucune table trouvée dans le document Word. Le fichier doit contenir un tableau (grille horaire)."],
          docxMetadata,
        };
      }
      // Choisir la table avec le plus de colonnes (la grille horaire)
      rows = docxResult.tables.reduce((best, tbl) =>
        (tbl[0]?.length ?? 0) > (best[0]?.length ?? 0) ? tbl : best
      );
    } else if (/\.csv$/i.test(filename) || /\.txt$/i.test(filename)) {
      rows = parseCsv(buffer.toString("utf-8"));
    } else {
      // Tentative Excel puis CSV
      try {
        rows = await parseExcel(buffer);
      } catch {
        rows = parseCsv(buffer.toString("utf-8"));
      }
    }
  } catch (e) {
    return {
      format: "unknown",
      rawCreneaux: [],
      errors: [`Impossible de lire le fichier : ${e instanceof Error ? e.message : "format inconnu"}`],
    };
  }

  if (rows.length === 0) {
    return { format: "unknown", rawCreneaux: [], errors: ["Le fichier est vide"], docxMetadata };
  }

  const info = detectFormat(rows);
  if (info.format === "unknown") {
    return {
      format: "unknown",
      rawCreneaux: [],
      errors: [
        "Format non reconnu. Attendu : colonnes « Jour, Heure début, Heure fin, Matière, … » (format liste) ou une colonne « Horaire » suivie de colonnes par jour (format grille).",
      ],
      docxMetadata,
    };
  }

  const rawCreneaux = info.format === "list" ? parseListFormat(rows, info) : parseGridFormat(rows, info);

  return { format: info.format, rawCreneaux, errors: [], docxMetadata };
}

/**
 * Snap une paire début/fin vers la grille affichée.
 *
 * RÈGLE : Si l'écart entre l'heure originale et le slot de grille le plus
 * proche est ≤ SNAP_TOLERANCE_MIN (5 min), on CONSERVE l'heure originale
 * plutôt que de la déformer. Cela évite de transformer 12:45 en 12:50
 * ou 08:10 en 08:00 — des déformations qui rendent l'emploi du temps
 * importé méconnaissable par rapport au document source.
 *
 * @returns créneau snappé + avertissements si l'heure d'origine n'était pas alignée.
 */
export const SNAP_TOLERANCE_MIN = 5;

export function snapCreneauToGrid(
  heureDebut: string,
  heureFin: string,
  stepMinutes: number,
  dayStart: string = DAY_START,
  dayEnd: string = DAY_END,
): { heureDebut: string; heureFin: string; warnings: string[] } {
  const warnings: string[] = [];
  const s = snapTimeToGrid(heureDebut, stepMinutes, "down", dayStart, dayEnd);
  const e = snapTimeToGrid(heureFin, stepMinutes, "up", dayStart, dayEnd);

  // Tolérance : si l'écart est ≤ 5 min, conserver l'heure originale
  const finalDebut = Math.abs(s.deltaMin) <= SNAP_TOLERANCE_MIN ? heureDebut : s.time;
  const finalFin = Math.abs(e.deltaMin) <= SNAP_TOLERANCE_MIN ? heureFin : e.time;

  if (!s.snapped && Math.abs(s.deltaMin) > SNAP_TOLERANCE_MIN) {
    warnings.push(`Début ajusté : ${heureDebut} → ${s.time} (alignement grille ${stepMinutes} min)`);
  }
  if (!e.snapped && Math.abs(e.deltaMin) > SNAP_TOLERANCE_MIN) {
    warnings.push(`Fin ajustée : ${heureFin} → ${e.time} (alignement grille ${stepMinutes} min)`);
  }
  // Si après snapping début >= fin, forcer une durée minimale d'un slot
  if (timeToMinutes(finalFin) <= timeToMinutes(finalDebut)) {
    const fixedFin = minutesToTime(timeToMinutes(finalDebut) + stepMinutes);
    warnings.push(`Durée invalide après alignement, fin forcée à ${fixedFin}`);
    return { heureDebut: finalDebut, heureFin: fixedFin, warnings };
  }
  return { heureDebut: finalDebut, heureFin: finalFin, warnings };
}
