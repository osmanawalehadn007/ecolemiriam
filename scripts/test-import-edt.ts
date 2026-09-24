/**
 * Test d'import d'emploi du temps — simule l'API sans authentification.
 * Parse le fichier .docx, applique le matching et le snapping, affiche le résultat.
 */

import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import {
  parseScheduleFile,
  snapCreneauToGrid,
  gridStepForStructure,
} from "../src/lib/emploi-du-temps/import-parser";
import { fuzzyFindStrict, normalizeText } from "../src/lib/text-match";

const prisma = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
const TENANT_ID = "cms8kt0b40001zbi3o63y7c5v";

function parseMatiereNiveau(raw: string): { nom: string; niveau: string | null } {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(.+?)\s+(\d+)$/);
  if (match) return { nom: match[1].trim(), niveau: match[2] };
  return { nom: trimmed, niveau: null };
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

async function main() {
  // 1. Trouver la classe 1èreA
  const classe = await prisma.classe.findFirst({
    where: { tenantId: TENANT_ID, nom: "1èreA" },
    select: { id: true, nom: true, niveau: true, structure: { select: { type: true } } },
  });
  if (!classe) {
    console.log("Classe 1èreA introuvable!");
    return;
  }
  console.log(`=== Classe cible: ${classe.nom} (niveau=${classe.niveau}, structure=${classe.structure?.type}) ===\n`);

  // 2. Parser le fichier .docx
  const filePath = "/Users/awalehosman/Downloads/EMPLOI DU TEMPS 1ère  A.A  Matin.docx";
  const buffer = fs.readFileSync(filePath);
  const parseResult = await parseScheduleFile(buffer, "EMPLOI DU TEMPS 1ère A Matin.docx");

  console.log(`Format detecte: ${parseResult.format}`);
  console.log(`Creneaux bruts extraits: ${parseResult.rawCreneaux.length}`);
  if (parseResult.errors.length > 0) {
    console.log(`Erreurs: ${parseResult.errors.join(", ")}`);
  }
  if (parseResult.docxMetadata) {
    console.log(`Metadonnees DOCX: classe="${parseResult.docxMetadata.classe}", annee="${parseResult.docxMetadata.annee}"`);
  }

  // 3. Charger les matières existantes
  const matieres = await prisma.matiere.findMany({
    where: { tenantId: TENANT_ID },
    select: { id: true, nom: true, code: true, niveau: true },
  });
  const matiereByNorm = new Map<string, { id: string; nom: string }>();
  for (const m of matieres) {
    matiereByNorm.set(normalizeText(m.nom), { id: m.id, nom: m.nom });
    if (m.niveau) matiereByNorm.set(`${normalizeText(m.nom)}::${m.niveau}`, { id: m.id, nom: m.nom });
    if (m.code) matiereByNorm.set(normalizeText(m.code), { id: m.id, nom: m.nom });
  }
  const matiereCandidates = matieres.map((m) => ({ id: m.id, nom: m.nom }));

  console.log(`\nMatieres en base: ${matieres.length}`);
  for (const m of matieres) {
    console.log(`  - ${m.nom} (code=${m.code}, niveau=${m.niveau ?? "null"})`);
  }

  // 4. Simuler le matching + snapping
  const stepMinutes = gridStepForStructure(classe.structure?.type);
  console.log(`\nPas de grille: ${stepMinutes} min\n`);

  const createdMatieres = new Map<string, { nom: string; code: string }>();
  const results: {
    jour: string; debut: string; fin: string; duree: number;
    matiereRaw: string; matiereMatched: string; matched: boolean; created: boolean;
    isEvaluation: boolean; warnings: string[];
  }[] = [];

  for (const raw of parseResult.rawCreneaux) {
    const warnings = [...raw.warnings];
    const snapped = snapCreneauToGrid(raw.heureDebut, raw.heureFin, stepMinutes);
    warnings.push(...snapped.warnings);
    const duree = timeToMinutes(snapped.heureFin) - timeToMinutes(snapped.heureDebut);

    if (raw.isEvaluation) {
      results.push({
        jour: raw.jour, debut: snapped.heureDebut, fin: snapped.heureFin, duree,
        matiereRaw: raw.matiere, matiereMatched: "Évaluation", matched: true, created: false,
        isEvaluation: true, warnings,
      });
      continue;
    }

    let matiereNom = raw.matiere;
    let matched = false;
    let created = false;

    if (raw.matiere) {
      const parsed = parseMatiereNiveau(raw.matiere);
      const normFull = normalizeText(raw.matiere);
      const normBase = normalizeText(parsed.nom);
      const normWithNiveau = parsed.niveau ? `${normBase}::${parsed.niveau}` : normBase;

      // 1) Recherche exacte: nom complet, puis nom+niveau, puis nom base
      const exact = matiereByNorm.get(normFull) ?? matiereByNorm.get(normWithNiveau) ?? matiereByNorm.get(normBase);
      if (exact) {
        matiereNom = exact.nom;
        matched = true;
      } else {
        // 2) Fuzzy strict
        const fuzzy = fuzzyFindStrict(matiereCandidates, parsed.nom);
        if (fuzzy.length === 1) {
          matiereNom = fuzzy[0].nom;
          matched = true;
        } else if (fuzzy.length > 1) {
          matiereNom = fuzzy[0].nom;
          matched = true;
          warnings.push(`Matiere ambigue -> ${fuzzy[0].nom} (${fuzzy.length} matchs)`);
        } else {
          // 3) Auto-création
          const nomToCreate = parsed.niveau ? raw.matiere : parsed.nom;
          const norm = normalizeText(nomToCreate);
          const code = norm.substring(0, 4).toUpperCase().replace(/[^A-Z0-9]/g, "X").padEnd(4, "0");
          created = true;
          matiereNom = nomToCreate;
          warnings.push(`Matiere creee automatiquement (code: ${code})`);
          createdMatieres.set(norm, { nom: nomToCreate, code });
        }
      }
    }

    results.push({
      jour: raw.jour, debut: snapped.heureDebut, fin: snapped.heureFin, duree,
      matiereRaw: raw.matiere, matiereMatched: matiereNom, matched, created,
      isEvaluation: false, warnings,
    });
  }

  // 5. Afficher le résultat
  console.log("\n===========================================================");
  console.log("  RESULTAT DE L IMPORT (APERCUU)");
  console.log("===========================================================\n");

  const jours = ["DIMANCHE", "LUNDI", "MARDI", "MERCREDI", "JEUDI"];
  for (const jour of jours) {
    const slots = results.filter((r) => r.jour === jour);
    if (slots.length === 0) continue;
    console.log(`\n--- ${jour} (${slots.length} creneaux) ---`);
    for (const s of slots) {
      const status = s.isEvaluation ? "[EVAL]" : s.created ? "[NEW]" : s.matched ? "[OK]" : "[ERR]";
      const warn = s.warnings.length > 0 ? `  WARN: ${s.warnings.join("; ")}` : "";
      console.log(`  ${status} ${s.debut}-${s.fin} (${s.duree}min)  "${s.matiereRaw}" -> "${s.matiereMatched}"${warn}`);
    }
  }

  // 6. Statistiques
  const stats = {
    total: results.length,
    matched: results.filter((r) => r.matched && !r.created).length,
    created: results.filter((r) => r.created).length,
    evaluations: results.filter((r) => r.isEvaluation).length,
    warnings: results.filter((r) => r.warnings.length > 0).length,
  };
  console.log("\n===========================================================");
  console.log("  STATISTIQUES");
  console.log("===========================================================");
  console.log(`  Total creneaux:     ${stats.total}`);
  console.log(`  Matieres matchees:  ${stats.matched}`);
  console.log(`  Matieres creees:    ${stats.created}`);
  console.log(`  Evaluations:        ${stats.evaluations}`);
  console.log(`  Avec avertissement: ${stats.warnings}`);

  // 7. Matières créées
  if (createdMatieres.size > 0) {
    console.log(`\n--- Matieres qui seraient auto-creees (${createdMatieres.size}) ---`);
    for (const [, m] of createdMatieres) {
      console.log(`  [NEW] ${m.nom} (code: ${m.code})`);
    }
  }

  // 8. Comparaison avec le .docx original
  console.log("\n===========================================================");
  console.log("  COMPARAISON AVEC LE .DOCX ORIGINAL");
  console.log("===========================================================\n");

  const docx: Record<string, [string, string, string][]> = {
    DIMANCHE: [
      ["07:30", "08:10", "Lecture 40 min"], ["08:10", "08:50", "Lecture 1 30 ou 40 min"],
      ["08:50", "09:20", "ANGLAIS 20 ou 30 min"], ["09:20", "10:00", "Langage 2 30 ou 40 min"],
      ["10:00", "10:20", "RECREATION 20min"], ["10:20", "11:30", "MATHEMATIQUES 50 a 60 min"],
      ["11:30", "12:00", "LECTURE 2 20 ou 30 min"], ["12:00", "12:20", "EMT (ecriture) 15 ou 20 min"],
      ["12:20", "12:45", "EMCI 20 ou 25 min"],
    ],
    LUNDI: [
      ["07:30", "08:10", "Lecture 40min"], ["08:10", "08:50", "ARABE 30 ou 40 min"],
      ["08:50", "09:20", "Ecriture 1 / copie 20 ou 30 min"], ["09:20", "10:00", "Graphisme 1 30 ou 40 min"],
      ["10:00", "10:20", "RECREATION 20min"], ["10:20", "11:30", "MATHEMATIQUES 50 a 60 min"],
      ["11:30", "12:00", "Production ecrite 1 20 ou 30 min"], ["12:00", "12:20", "Lecture 3 15 ou 20 min"],
      ["12:20", "12:45", "POESIE/ CHANT 2 20 ou 25 min"],
    ],
    MARDI: [
      ["07:30", "08:10", "Lecture 40 min"], ["08:10", "08:50", "Lecture 4 30 ou 40 min"],
      ["08:50", "09:20", "Ecriture 2 / copie 20 ou 30 min"], ["09:20", "10:00", "Graphisme 1 30 ou 40 min"],
      ["10:00", "10:20", "RECREATION 20min"], ["10:20", "11:30", "MATHEMATIQUES 50 a 60 min"],
      ["11:30", "12:00", "Lecture plaisir 20 ou 30 min"], ["12:00", "12:20", "Dictee 1 15 ou 20 min"],
      ["12:20", "12:45", "EMCI 20 ou 25 min"],
    ],
    MERCREDI: [
      ["07:30", "08:10", "Lecture 40 min"], ["08:10", "08:50", "Lecture 5 30 ou 40 min"],
      ["08:50", "09:20", "Graphisme 3 20 ou 30 min"], ["09:20", "10:00", "Langage 6 30 ou 40 min"],
      ["10:00", "10:20", "RECREATION 20min"], ["10:20", "11:30", "MATHEMATIQUES 50 a 60 min"],
      ["11:30", "12:00", "Ecriture 2 / copie 20 ou 30 min"], ["12:00", "12:20", "Poesie/chant 15 ou 20 min"],
      ["12:20", "12:45", "EMT (ecriture) 20 ou 25 min"],
    ],
    JEUDI: [
      ["07:30", "08:10", "Lecture 6 40 min"], ["08:10", "08:50", "langage 7 30 ou 40 min"],
      ["08:50", "09:20", "Graphisme 4 20 ou 30 min"], ["09:20", "10:00", "Evaluation de Francais 30 ou 40 min"],
      ["10:00", "10:20", "RECREATION 20min"], ["10:20", "11:30", "Evaluation de MATHS 50 a 60 min"],
      ["11:30", "12:00", "Production ecrite 3 20 ou 30 min"], ["12:00", "12:20", "Dictee 2 15 ou 20 min"],
      ["12:20", "12:45", "Ecriture 4 20 ou 25 min"],
    ],
  };

  let horairesCorrect = 0;
  let horairesTotal = 0;
  for (const jour of jours) {
    const docxSlots = docx[jour] || [];
    const importSlots = results.filter((r) => r.jour === jour);
    for (const d of docxSlots) {
      if (d[2].toLowerCase().includes("recreation")) continue;
      horairesTotal++;
      const importSlot = importSlots.find((s) => s.debut === d[0] && s.fin === d[1]);
      if (importSlot) {
        horairesCorrect++;
      } else {
        console.log(`  [DIFF] ${jour}: ${d[0]}-${d[1]} "${d[2]}" non trouve dans l import`);
      }
    }
  }
  console.log(`\n  Horaires preserves: ${horairesCorrect}/${horairesTotal} (${Math.round(horairesCorrect / horairesTotal * 100)}%)`);

  // Vérifier que les matières numérotées sont préservées
  const matieresNumerotees = results.filter((r) => /\d+$/.test(r.matiereRaw) && !r.isEvaluation);
  const matieresNumeroteesPreservees = matieresNumerotees.filter((r) => r.matiereMatched === r.matiereRaw || r.matiereMatched === r.matiereRaw.replace(/\s+\d+$/, ""));
  console.log(`  Matieres numerotees preservees: ${matieresNumeroteesPreservees.length}/${matieresNumerotees.length}`);
  for (const m of matieresNumerotees) {
    const ok = m.matiereMatched === m.matiereRaw;
    console.log(`    ${ok ? "[OK]" : "[CHG]"} "${m.matiereRaw}" -> "${m.matiereMatched}"`);
  }

  // Vérifier que les durées sont nettoyées
  const matieresAvecDuree = results.filter((r) => /\d+\s*min/i.test(r.matiereRaw));
  const matieresDureeNettoyee = matieresAvecDuree.filter((r) => !/\d+\s*min/i.test(r.matiereMatched));
  console.log(`  Durees nettoyees des noms: ${matieresDureeNettoyee.length}/${matieresAvecDuree.length}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
