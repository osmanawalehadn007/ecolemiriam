/**
 * Réorganisation des classes selon le système djiboutien.
 *
 * Système djiboutien :
 *   Maternelle : Maternelle, PS, MS, GS
 *   Primaire   : 1ère à 5ème année
 *   Collège    : 6ème à 9ème année
 *   Lycée      : Seconde, Première, Terminale
 *
 * Actions :
 * 1. Normaliser les valeurs de niveau ("0" → "Maternelle", "1" → "1ère")
 * 2. Créer les structures manquantes (LYCEE pour Warabaleh)
 * 3. Assigner chaque classe à la bonne structure
 * 4. Nettoyer les noms (espaces trailing)
 * 5. Supprimer le doublon 6ème1 vide à Warabaleh
 */

import { PrismaClient, StructureType } from "@prisma/client";

const prisma = new PrismaClient({
  datasourceUrl: process.env.DIRECT_URL,
});

const TENANT_ID = "cms8kt0b40001zbi3o63y7c5v";

// Mapping niveau → StructureType (système djiboutien)
function niveauToStructureType(niveau: string): StructureType | null {
  const n = niveau.toLowerCase().trim();
  // Maternelle
  if (["maternelle", "0", "ps", "ms", "gs"].includes(n)) return "MATERNELLE";
  // Primaire : 1ère à 5ème année
  if (["1ère", "1ere", "1er", "2ème", "2eme", "3ème", "3eme", "4ème", "4eme", "5ème", "5eme"].includes(n)) return "PRIMAIRE";
  // Collège : 6ème à 9ème année
  if (["6ème", "6eme", "6e", "7ème", "7eme", "7e", "8ème", "8eme", "8e", "9ème", "9eme", "9e"].includes(n)) return "COLLEGE";
  // Lycée
  if (["seconde", "2nde", "2nd", "première", "premiere", "terminale", "term", "tle"].includes(n)) return "LYCEE";
  return null;
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  RÉORGANISATION DES CLASSES — Système djiboutien");
  console.log("═══════════════════════════════════════════════════════════\n");

  // ── 1. Récupérer toutes les classes ──────────────────────────
  const classes = await prisma.classe.findMany({
    where: { tenantId: TENANT_ID },
    select: {
      id: true, nom: true, niveau: true, siteId: true, structureId: true,
      _count: { select: { eleves: true } },
    },
    orderBy: [{ siteId: "asc" }, { niveau: "asc" }, { nom: "asc" }],
  });
  console.log(`→ ${classes.length} classes trouvées\n`);

  // ── 2. Récupérer toutes les structures existantes ────────────
  const structures = await prisma.structure.findMany({
    where: { tenantId: TENANT_ID },
    select: { id: true, type: true, nom: true, siteId: true },
  });
  console.log(`→ ${structures.length} structures existantes\n`);

  // Index: siteId → StructureType → structureId
  const structureIndex = new Map<string, Map<string, string>>();
  for (const s of structures) {
    const siteKey = s.siteId ?? "__null__";
    if (!structureIndex.has(siteKey)) structureIndex.set(siteKey, new Map());
    structureIndex.get(siteKey)!.set(s.type, s.id);
  }

  // ── 3. Identifier les structures manquantes ──────────────────
  const sitesNeedingLycee = new Set<string | null>();
  for (const c of classes) {
    const structType = niveauToStructureType(c.niveau);
    if (structType === "LYCEE") {
      const siteKey = c.siteId ?? "__null__";
      if (!structureIndex.get(siteKey)?.has("LYCEE")) {
        sitesNeedingLycee.add(c.siteId);
      }
    }
  }

  // ── 4. Créer les structures LYCEE manquantes ─────────────────
  for (const siteId of sitesNeedingLycee) {
    const site = siteId ? await prisma.site.findUnique({ where: { id: siteId }, select: { nom: true } }) : null;
    console.log(`→ Création structure LYCEE pour ${site?.nom ?? "sans site"}…`);
    const created = await prisma.structure.create({
      data: {
        tenantId: TENANT_ID,
        siteId,
        type: "LYCEE",
        nom: "Lycée",
        actif: true,
      },
    });
    const siteKey = siteId ?? "__null__";
    if (!structureIndex.has(siteKey)) structureIndex.set(siteKey, new Map());
    structureIndex.get(siteKey)!.set("LYCEE", created.id);
    console.log(`  ✓ Structure créée: ${created.id}\n`);
  }

  // ── 5. Supprimer le doublon 6ème1 vide à Warabaleh ───────────
  const dup6eme1 = classes.filter(
    (c) => c.nom === "6ème1" && c.niveau === "6ème" && c._count.eleves === 0
  );
  for (const c of dup6eme1) {
    console.log(`→ Suppression doublon 6ème1 vide (id=${c.id}, 0 élèves)…`);
    await prisma.classe.delete({ where: { id: c.id } });
    console.log(`  ✓ Supprimé\n`);
  }

  // ── 6. Normaliser niveaux + assigner structures + nettoyer noms ──
  let updated = 0;
  for (const c of classes) {
    // Skip deleted duplicates
    if (dup6eme1.some((d) => d.id === c.id)) continue;

    const updates: { niveau?: string; structureId?: string | null; nom?: string } = {};

    // 6a. Normaliser niveau
    if (c.niveau === "0") {
      updates.niveau = "Maternelle";
    } else if (c.niveau === "1") {
      updates.niveau = "1ère";
    }

    // 6b. Nettoyer nom (espaces trailing/leading)
    const trimmedNom = c.nom.trim();
    if (trimmedNom !== c.nom) {
      updates.nom = trimmedNom;
    }

    // 6c. Assigner la bonne structure
    const normalizedNiveau = updates.niveau ?? c.niveau;
    const structType = niveauToStructureType(normalizedNiveau);
    if (structType) {
      const siteKey = c.siteId ?? "__null__";
      const correctStructureId = structureIndex.get(siteKey)?.get(structType);
      if (correctStructureId && correctStructureId !== c.structureId) {
        updates.structureId = correctStructureId;
      }
    }

    if (Object.keys(updates).length > 0) {
      await prisma.classe.update({ where: { id: c.id }, data: updates });
      updated++;
      const changes: string[] = [];
      if (updates.niveau) changes.push(`niveau: "${c.niveau}" → "${updates.niveau}"`);
      if (updates.nom) changes.push(`nom: "${c.nom}" → "${updates.nom}"`);
      if (updates.structureId) {
        const oldStruct = c.structureId ? structures.find((s) => s.id === c.structureId)?.type ?? "?" : "NULL";
        const newStruct = structType ?? "?";
        changes.push(`structure: ${oldStruct} → ${newStruct}`);
      }
      console.log(`  ✓ ${trimmedNom}: ${changes.join(", ")}`);
    }
  }

  console.log(`\n→ ${updated} classe(s) mise(s) à jour\n`);

  // ── 7. Vérification finale ───────────────────────────────────
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  VÉRIFICATION FINALE");
  console.log("═══════════════════════════════════════════════════════════\n");

  const finalClasses = await prisma.classe.findMany({
    where: { tenantId: TENANT_ID },
    select: {
      nom: true, niveau: true,
      site: { select: { nom: true } },
      structure: { select: { type: true } },
      _count: { select: { eleves: true } },
    },
    orderBy: [{ site: { nom: "asc" } }, { niveau: "asc" }, { nom: "asc" }],
  });

  const bySite = new Map<string, typeof finalClasses>();
  for (const c of finalClasses) {
    const siteNom = c.site?.nom ?? "Sans site";
    if (!bySite.has(siteNom)) bySite.set(siteNom, []);
    bySite.get(siteNom)!.push(c);
  }

  for (const [siteNom, siteClasses] of bySite) {
    console.log(`\n━━━ ${siteNom} (${siteClasses.length} classes) ━━━`);
    for (const c of siteClasses) {
      const structType = (c.structure?.type ?? "NULL").padEnd(12);
      console.log(`  ${structType}  niveau="${c.niveau}"  nom="${c.nom}"  élèves=${c._count.eleves}`);
    }
  }

  const finalStructures = await prisma.structure.findMany({
    where: { tenantId: TENANT_ID },
    select: { type: true, nom: true, site: { select: { nom: true } } },
    orderBy: [{ site: { nom: "asc" } }, { type: "asc" }],
  });
  console.log(`\n━━━ Structures (${finalStructures.length}) ━━━`);
  for (const s of finalStructures) {
    console.log(`  ${s.site?.nom ?? "Sans site"} → ${s.type} (${s.nom})`);
  }

  await prisma.$disconnect();
  console.log("\n✅ Réorganisation terminée!");
}

main().catch((e) => {
  console.error("❌ Erreur:", e);
  process.exit(1);
});
