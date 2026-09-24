/**
 * Import réel d'emploi du temps pour la classe 1èreA.
 * Supprime les anciens créneaux et crée les nouveaux depuis le .docx.
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
  console.log(`Classe cible: ${classe.nom} (id=${classe.id}, niveau=${classe.niveau})`);

  // 2. Année courante
  const annee = await prisma.anneesScolaires.findFirst({
    where: { tenantId: TENANT_ID, isCurrent: true },
    select: { libelle: true },
  });
  if (!annee) {
    console.log("Aucune annee courante!");
    return;
  }
  console.log(`Annee courante: ${annee.libelle}`);

  // 3. Parser le fichier .docx
  const filePath = "/Users/awalehosman/Downloads/EMPLOI DU TEMPS 1ère  A.A  Matin.docx";
  const buffer = fs.readFileSync(filePath);
  const parseResult = await parseScheduleFile(buffer, "EMPLOI DU TEMPS 1ère A Matin.docx");
  console.log(`Creneaux bruts: ${parseResult.rawCreneaux.length}`);

  // 4. Charger les matières
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

  // 5. Matching + snapping
  const stepMinutes = gridStepForStructure(classe.structure?.type);
  const creneauxToCreate: {
    matiereId: string;
    jour: string;
    heureDebut: string;
    heureFin: string;
    salle: string | null;
  }[] = [];

  // Trouver/créer la matière Évaluation
  let evaluationMatiereId: string | null = null;
  const evalNorm = normalizeText("Évaluation");
  const evalExisting = matiereByNorm.get(evalNorm);
  if (evalExisting) {
    evaluationMatiereId = evalExisting.id;
  } else {
    const created = await prisma.matiere.create({
      data: { tenantId: TENANT_ID, nom: "Évaluation", code: "EVAL", coefficient: 1 },
    });
    evaluationMatiereId = created.id;
    console.log(`Matiere Evaluation creee: ${created.id}`);
  }

  for (const raw of parseResult.rawCreneaux) {
    const snapped = snapCreneauToGrid(raw.heureDebut, raw.heureFin, stepMinutes);

    if (raw.isEvaluation) {
      if (evaluationMatiereId) {
        creneauxToCreate.push({
          matiereId: evaluationMatiereId,
          jour: raw.jour,
          heureDebut: snapped.heureDebut,
          heureFin: snapped.heureFin,
          salle: null,
        });
      }
      continue;
    }

    if (!raw.matiere) continue;

    const parsed = parseMatiereNiveau(raw.matiere);
    const normFull = normalizeText(raw.matiere);
    const normBase = normalizeText(parsed.nom);
    const normWithNiveau = parsed.niveau ? `${normBase}::${parsed.niveau}` : normBase;

    const exact = matiereByNorm.get(normFull) ?? matiereByNorm.get(normWithNiveau) ?? matiereByNorm.get(normBase);
    if (exact) {
      creneauxToCreate.push({
        matiereId: exact.id,
        jour: raw.jour,
        heureDebut: snapped.heureDebut,
        heureFin: snapped.heureFin,
        salle: null,
      });
    } else {
      const fuzzy = fuzzyFindStrict(matiereCandidates, parsed.nom);
      if (fuzzy.length >= 1) {
        creneauxToCreate.push({
          matiereId: fuzzy[0].id,
          jour: raw.jour,
          heureDebut: snapped.heureDebut,
          heureFin: snapped.heureFin,
          salle: null,
        });
      } else {
        // Auto-créer
        const nomToCreate = parsed.niveau ? raw.matiere : parsed.nom;
        const norm = normalizeText(nomToCreate);
        const code = norm.substring(0, 4).toUpperCase().replace(/[^A-Z0-9]/g, "X").padEnd(4, "0");
        const created = await prisma.matiere.create({
          data: { tenantId: TENANT_ID, nom: nomToCreate, code, coefficient: 1, ...(parsed.niveau ? { niveau: parsed.niveau } : {}) },
        });
        matiereByNorm.set(norm, { id: created.id, nom: created.nom });
        console.log(`Matiere creee: ${nomToCreate} (code: ${code})`);
        creneauxToCreate.push({
          matiereId: created.id,
          jour: raw.jour,
          heureDebut: snapped.heureDebut,
          heureFin: snapped.heureFin,
          salle: null,
        });
      }
    }
  }

  console.log(`\nCreneaux a creer: ${creneauxToCreate.length}`);

  // 6. Transaction: supprimer anciens + créer nouveaux
  const result = await prisma.$transaction(
    async (tx) => {
      const deleted = await tx.emploiTemps.deleteMany({
        where: { tenantId: TENANT_ID, classeId: classe.id, annee: annee.libelle },
      });
      console.log(`Anciens creneaux supprimes: ${deleted.count}`);

      await tx.emploiTemps.createMany({
        data: creneauxToCreate.map((c) => ({
          tenantId: TENANT_ID,
          classeId: classe.id,
          matiereId: c.matiereId,
          enseignantId: null,
          jour: c.jour,
          heureDebut: c.heureDebut,
          heureFin: c.heureFin,
          salle: c.salle,
          annee: annee.libelle,
        })),
      });

      return { deleted: deleted.count, created: creneauxToCreate.length };
    },
    { timeout: 30000, maxWait: 10000 },
  );

  console.log(`\nResultat: ${result.deleted} supprimes, ${result.created} crees`);

  // 7. Vérification
  const finalCreneaux = await prisma.emploiTemps.findMany({
    where: { tenantId: TENANT_ID, classeId: classe.id, annee: annee.libelle },
    include: { matiere: { select: { nom: true } } },
    orderBy: [{ jour: "asc" }, { heureDebut: "asc" }],
  });
  console.log(`\nVerification: ${finalCreneaux.length} creneaux en base pour ${classe.nom}`);

  const jours = ["DIMANCHE", "LUNDI", "MARDI", "MERCREDI", "JEUDI"];
  for (const jour of jours) {
    const slots = finalCreneaux.filter((c) => c.jour === jour);
    if (slots.length === 0) continue;
    console.log(`\n${jour} (${slots.length}):`);
    for (const s of slots) {
      console.log(`  ${s.heureDebut}-${s.heureFin}  ${s.matiere.nom}`);
    }
  }

  await prisma.$disconnect();
  console.log("\nImport termine avec succes!");
}

main().catch((e) => {
  console.error("Erreur:", e);
  process.exit(1);
});
