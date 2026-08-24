/**
 * École Miriam — Helper d'import des indisponibilités enseignants (côté serveur)
 * ============================================================================
 * Parse un fichier CSV/Excel et produit un plan de prévisualisation :
 * pour chaque ligne, on matche l'enseignant par nom ou email, on valide les
 * horaires et on signale les conflits. Aucune écriture en base — l'écriture
 * se fait dans la route /api/import/indisponibilites après confirmation.
 */

import ExcelJS from "exceljs";
import Papa from "papaparse";
import prisma from "@/lib/prisma";
import { createHash } from "crypto";

export type Jour = "DIMANCHE" | "LUNDI" | "MARDI" | "MERCREDI" | "JEUDI" | "VENDREDI" | "SAMEDI";

const JOUR_MAP: Record<string, Jour> = {
  "DIMANCHE": "DIMANCHE", "DIM": "DIMANCHE", "SUNDAY": "DIMANCHE", "SUN": "DIMANCHE",
  "LUNDI": "LUNDI", "LUN": "LUNDI", "MONDAY": "LUNDI", "MON": "LUNDI",
  "MARDI": "MARDI", "MAR": "MARDI", "TUESDAY": "MARDI", "TUE": "MARDI",
  "MERCREDI": "MERCREDI", "MER": "MERCREDI", "WEDNESDAY": "MERCREDI", "WED": "MERCREDI",
  "JEUDI": "JEUDI", "JEU": "JEUDI", "THURSDAY": "JEUDI", "THU": "JEUDI",
  "VENDREDI": "VENDREDI", "VEN": "VENDREDI", "FRIDAY": "VENDREDI", "FRI": "VENDREDI",
  "SAMEDI": "SAMEDI", "SAM": "SAMEDI", "SATURDAY": "SAMEDI", "SAT": "SAMEDI",
};

export interface LigneIndispo {
  ligne: number;
  enseignantNom: string;
  enseignantEmail?: string;
  jour: string;
  heureDebut: string;
  heureFin: string;
  note?: string;
}

export interface LignePlan {
  ligne: number;
  enseignantNom: string;
  enseignantEmail?: string;
  jour: Jour;
  heureDebut: string;
  heureFin: string;
  note?: string;
  enseignantId: string | null;
  statut: "OK" | "IGNORER" | "ERREUR";
  raison: string;
}

export interface PlanImport {
  hash: string;
  lignes: LignePlan[];
  total: number;
  ok: number;
  erreurs: number;
  ignores: number;
}

function normalizeJour(raw: string): Jour | null {
  const key = raw.trim().toUpperCase();
  return JOUR_MAP[key] ?? null;
}

function normalizeHeure(raw: string): string | null {
  const s = String(raw).trim();
  // Accepte "8:00", "08:00", "8h00", "08h00", "8.00"
  const cleaned = s.replace(/[hH]/, ":").replace(/\./, ":");
  const m = cleaned.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

async function parseBuffer(buffer: ArrayBuffer): Promise<Record<string, string>[]> {
  // Détecter Excel par magic bytes (PK\x03\x04 = zip/xlsx)
  const bytes = new Uint8Array(buffer.slice(0, 4));
  const isXlsx = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;

  if (isXlsx) {
    return await parseXlsx(buffer);
  }
  // Sinon CSV
  const text = Buffer.from(buffer).toString("utf-8");
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });
  return (result.data as Record<string, string>[]).filter((r) =>
    Object.values(r).some((v) => v && String(v).trim())
  );
}

async function parseXlsx(buffer: ArrayBuffer): Promise<Record<string, string>[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheet = wb.worksheets[0];
  if (!sheet) return [];

  const headers: string[] = [];
  sheet.getRow(1).eachCell((cell, col) => {
    headers[col - 1] = String(cell.value ?? "").trim();
  });

  const rows: Record<string, string>[] = [];
  for (let i = 2; i <= sheet.rowCount; i++) {
    const raw: Record<string, string> = {};
    sheet.getRow(i).eachCell((cell, col) => {
      const h = headers[col - 1];
      if (h) raw[h] = String(cell.value ?? "").trim();
    });
    if (Object.values(raw).some((v) => v)) rows.push(raw);
  }
  return rows;
}

/**
 * Cherche la colonne correspondante parmi plusieurs candidats (insensible à la casse).
 */
function findCol(row: Record<string, string>, candidates: string[]): string | null {
  const keys = Object.keys(row).map((k) => k.toLowerCase().trim());
  for (const c of candidates) {
    const cl = c.toLowerCase();
    const idx = keys.findIndex((k) => k === cl || k.includes(cl));
    if (idx >= 0) return Object.keys(row)[idx];
  }
  return null;
}

export async function preparerPlanIndispo(
  tenantId: string,
  buffer: ArrayBuffer
): Promise<PlanImport> {
  const rows = await parseBuffer(buffer);

  // Récupérer tous les enseignants du tenant pour le matching
  const enseignants = await prisma.enseignant.findMany({
    where: { tenantId },
    include: { user: { select: { name: true, email: true } } },
  });

  type EnseignantWithUser = (typeof enseignants)[number];

  // Index par nom (normalisé) et email
  const byName = new Map<string, EnseignantWithUser[]>();
  const byEmail = new Map<string, EnseignantWithUser>();
  for (const e of enseignants) {
    const nom = (e.user.name ?? "").toLowerCase().trim();
    if (nom) {
      if (!byName.has(nom)) byName.set(nom, []);
      byName.get(nom)!.push(e);
    }
    const email = (e.user.email ?? "").toLowerCase().trim();
    if (email) byEmail.set(email, e);
  }

  const lignes: LignePlan[] = [];
  let ok = 0, erreurs = 0, ignores = 0;

  rows.forEach((row, i) => {
    const ligneNum = i + 2; // +1 pour l'en-tête, +1 pour 1-based

    const colEns = findCol(row, ["enseignant", "professeur", "prof", "nom", "name"]);
    const colEmail = findCol(row, ["email", "mail", "courriel"]);
    const colJour = findCol(row, ["jour", "day"]);
    const colDebut = findCol(row, ["debut", "start", "heure debut", "heure debut", "debut"]);
    const colFin = findCol(row, ["fin", "end", "heure fin", "heurefin", "fin"]);
    const colNote = findCol(row, ["note", "commentaire", "motif", "raison"]);

    const ensNom = colEns ? (row[colEns] ?? "").trim() : "";
    const ensEmail = colEmail ? (row[colEmail] ?? "").trim().toLowerCase() : "";
    const jourRaw = colJour ? (row[colJour] ?? "").trim() : "";
    const debutRaw = colDebut ? (row[colDebut] ?? "").trim() : "";
    const finRaw = colFin ? (row[colFin] ?? "").trim() : "";
    const note = colNote ? (row[colNote] ?? "").trim() : undefined;

    if (!ensNom && !ensEmail) {
      lignes.push({ ligne: ligneNum, enseignantNom: "", jour: "LUNDI", heureDebut: "", heureFin: "", statut: "ERREUR", raison: "Enseignant manquant", enseignantId: null });
      erreurs++;
      return;
    }

    // Matching enseignant
    let matched: EnseignantWithUser | undefined = ensEmail ? byEmail.get(ensEmail) : undefined;
    if (!matched) {
      const candidates = byName.get(ensNom.toLowerCase());
      if (candidates && candidates.length === 1) {
        matched = candidates[0];
      } else if (candidates && candidates.length > 1) {
        lignes.push({ ligne: ligneNum, enseignantNom: ensNom, enseignantEmail: ensEmail || undefined, jour: "LUNDI", heureDebut: debutRaw, heureFin: finRaw, note, statut: "ERREUR", raison: `Plusieurs enseignants nommés « ${ensNom} » — précisez l'email`, enseignantId: null });
        erreurs++;
        return;
      }
    }

    if (!matched) {
      lignes.push({ ligne: ligneNum, enseignantNom: ensNom, enseignantEmail: ensEmail || undefined, jour: "LUNDI", heureDebut: debutRaw, heureFin: finRaw, note, statut: "ERREUR", raison: `Enseignant « ${ensNom || ensEmail} » introuvable`, enseignantId: null });
      erreurs++;
      return;
    }

    // Valider jour
    const jour = normalizeJour(jourRaw);
    if (!jour) {
      lignes.push({ ligne: ligneNum, enseignantNom: matched.user.name ?? ensNom, enseignantEmail: matched.user.email ?? undefined, jour: "LUNDI", heureDebut: debutRaw, heureFin: finRaw, note, statut: "ERREUR", raison: `Jour « ${jourRaw} » invalide`, enseignantId: matched.id });
      erreurs++;
      return;
    }

    // Valider horaires
    const debut = normalizeHeure(debutRaw);
    const fin = normalizeHeure(finRaw);
    if (!debut || !fin) {
      lignes.push({ ligne: ligneNum, enseignantNom: matched.user.name ?? ensNom, enseignantEmail: matched.user.email ?? undefined, jour, heureDebut: debutRaw, heureFin: finRaw, note, statut: "ERREUR", raison: `Horaires invalides (« ${debutRaw} » → « ${finRaw} »)`, enseignantId: matched.id });
      erreurs++;
      return;
    }
    if (debut >= fin) {
      lignes.push({ ligne: ligneNum, enseignantNom: matched.user.name ?? ensNom, enseignantEmail: matched.user.email ?? undefined, jour, heureDebut: debut, heureFin: fin, note, statut: "ERREUR", raison: "Heure de début ≥ heure de fin", enseignantId: matched.id });
      erreurs++;
      return;
    }

    lignes.push({
      ligne: ligneNum,
      enseignantNom: matched.user.name ?? ensNom,
      enseignantEmail: matched.user.email ?? undefined,
      jour,
      heureDebut: debut,
      heureFin: fin,
      note: note || undefined,
      enseignantId: matched.id,
      statut: "OK",
      raison: "Sera importé",
    });
    ok++;
  });

  const hash = createHash("sha256").update(Buffer.from(buffer)).digest("hex").slice(0, 16);

  return { hash, lignes, total: lignes.length, ok, erreurs, ignores };
}

/**
 * Applique le plan : crée les indisponibilités pour les lignes OK.
 * Remplace (deleteMany + createMany) les indisponibilités d'import pour les
 * enseignants concernés, afin d'éviter les doublons lors d'un réimport.
 */
export async function appliquerPlanIndispo(
  tenantId: string,
  siteId: string | null,
  plan: PlanImport
): Promise<{ created: number; enseignantsConcernes: string[] }> {
  const lignesOk = plan.lignes.filter((l) => l.statut === "OK" && l.enseignantId);
  if (lignesOk.length === 0) {
    return { created: 0, enseignantsConcernes: [] };
  }

  const enseignantIds = [...new Set(lignesOk.map((l) => l.enseignantId!))];

  // Supprimer les anciennes indisponibilités d'import pour ces enseignants
  // (on conserve les saisies manuelles source = "MANUEL")
  await prisma.indisponibiliteEnseignant.deleteMany({
    where: {
      tenantId,
      enseignantId: { in: enseignantIds },
      source: "IMPORT",
    },
  });

  const data = lignesOk.map((l) => ({
    tenantId,
    siteId,
    enseignantId: l.enseignantId!,
    jour: l.jour as never,
    heureDebut: l.heureDebut,
    heureFin: l.heureFin,
    source: "IMPORT" as const,
    note: l.note ?? null,
  }));

  await prisma.indisponibiliteEnseignant.createMany({ data });

  return { created: data.length, enseignantsConcernes: enseignantIds };
}
