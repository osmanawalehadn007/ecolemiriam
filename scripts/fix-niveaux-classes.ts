/**
 * Corrige les noms de niveaux incohérents dans les classes :
 * - "6" → "6ème" (Warabaleh)
 * - "1ère année" → "1ère" (Campus Central)
 *
 * Usage: npx tsx scripts/fix-niveaux-classes.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
  datasourceUrl: process.env.DIRECT_URL,
});

const TENANT_ID = "cms8kt0b40001zbi3o63y7c5v";

async function main() {
  // 1. Lister les classes affectées avant correction
  const classes6 = await prisma.classe.findMany({
    where: { tenantId: TENANT_ID, niveau: "6" },
    select: { id: true, nom: true, niveau: true, siteId: true, annee: true },
  });
  console.log(`\n=== Classes avec niveau "6" (${classes6.length}) ===`);
  for (const c of classes6) {
    console.log(`  ${c.id} | ${c.nom} | annee=${c.annee} | siteId=${c.siteId}`);
  }

  const classes1ereAnnee = await prisma.classe.findMany({
    where: { tenantId: TENANT_ID, niveau: "1ère année" },
    select: { id: true, nom: true, niveau: true, siteId: true, annee: true },
  });
  console.log(`\n=== Classes avec niveau "1ère année" (${classes1ereAnnee.length}) ===`);
  for (const c of classes1ereAnnee) {
    console.log(`  ${c.id} | ${c.nom} | annee=${c.annee} | siteId=${c.siteId}`);
  }

  // 2. Corriger
  if (classes6.length > 0) {
    const res1 = await prisma.classe.updateMany({
      where: { tenantId: TENANT_ID, niveau: "6" },
      data: { niveau: "6ème" },
    });
    console.log(`\n✅ ${res1.count} classe(s) corrigée(s): "6" → "6ème"`);
  }

  if (classes1ereAnnee.length > 0) {
    const res2 = await prisma.classe.updateMany({
      where: { tenantId: TENANT_ID, niveau: "1ère année" },
      data: { niveau: "1ère" },
    });
    console.log(`✅ ${res2.count} classe(s) corrigée(s): "1ère année" → "1ère"`);
  }

  // 3. Vérifier aussi s'il y a d'autres variantes problématiques
  const allNiveaux = await prisma.classe.findMany({
    where: { tenantId: TENANT_ID, annee: "2026-2027" },
    select: { niveau: true },
    distinct: ["niveau"],
    orderBy: { niveau: "asc" },
  });
  console.log(`\n=== Tous les niveaux distincts après correction (2026-2027) ===`);
  for (const c of allNiveaux) {
    console.log(`  - "${c.niveau}"`);
  }

  // 4. Vérifier les doublons de tarifs globaux "6ème"
  const tarifs6eme = await prisma.tarifNiveau.findMany({
    where: { tenantId: TENANT_ID, annee: "2026-2027", niveau: "6ème", siteId: null },
    select: { id: true, mensualite: true, fraisInscription: true, actif: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  console.log(`\n=== Tarifs globaux "6ème" (${tarifs6eme.length}) ===`);
  for (const t of tarifs6eme) {
    console.log(`  ${t.id} | mensualité=${t.mensualite} | inscription=${t.fraisInscription} | actif=${t.actif} | créé=${t.createdAt.toISOString()}`);
  }
  if (tarifs6eme.length > 1) {
    // Supprimer le doublon le plus récent
    const toDelete = tarifs6eme[tarifs6eme.length - 1];
    console.log(`  → Suppression du doublon ${toDelete.id}`);
    await prisma.tarifNiveau.delete({ where: { id: toDelete.id } });
    console.log(`  ✅ Doublon supprimé`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
