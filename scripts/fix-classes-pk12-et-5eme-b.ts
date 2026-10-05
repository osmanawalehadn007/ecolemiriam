/**
 * École Miriam — Classes de maternelle de l'ANNEXE PK12 et « 5ème Année B »
 * ==========================================================================
 *
 * Deux corrections de données, constatées le 05/10/2026 :
 *
 *   1. ANNEXE PK12 avait deux classes de maternelle homonymes à la casse près,
 *      « Garderie » et « GARDERIE ». Ce sont deux classes distinctes : elles
 *      deviennent « GRANDE SECTION A » et « GRANDE SECTION B » (même graphie
 *      que les classes du Campus Maternelle). Élèves, structure et niveau ne
 *      changent pas.
 *   2. « 5ème Année B » (Campus Central) n'était rattachée à aucune structure :
 *      elle sortait « hors catégorie » dans l'emploi du temps et l'appel. Elle
 *      est rattachée à la structure PRIMAIRE de son site.
 *
 * Idempotent : relancé, il ne fait plus rien.
 *
 *   npx tsx scripts/fix-classes-pk12-et-5eme-b.ts          # simulation
 *   npx tsx scripts/fix-classes-pk12-et-5eme-b.ts --apply  # écriture
 */

import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";

dotenv.config();

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });

const SITE_PK12_ID = "cmsiugk680001zbboqyg5egb6"; // ANNEXE PK12
const SITE_CENTRAL_ID = "cmsd80smv0001zbfn76yxe0gw"; // Campus Central
const ANNEE = "2026-2027";

// La comparaison est sensible à la casse : c'est elle qui distingue les deux classes.
const RENOMMAGES = [
  { ancien: "Garderie", nouveau: "GRANDE SECTION A" },
  { ancien: "GARDERIE", nouveau: "GRANDE SECTION B" },
];

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(`Mode : ${apply ? "ÉCRITURE" : "SIMULATION"}\n`);

  const pk12 = await prisma.site.findUnique({ where: { id: SITE_PK12_ID }, select: { tenantId: true, nom: true } });
  if (!pk12) throw new Error("Site ANNEXE PK12 introuvable");
  const tenantId = pk12.tenantId;

  const renommages: { id: string; ancien: string; nouveau: string; eleves: number }[] = [];
  for (const r of RENOMMAGES) {
    const classe = await prisma.classe.findFirst({
      where: { tenantId, siteId: SITE_PK12_ID, annee: ANNEE, nom: r.ancien },
      select: { id: true, _count: { select: { eleves: true } } },
    });
    if (!classe) {
      console.log(`· « ${r.ancien} » (${pk12.nom}) : introuvable, déjà renommée ?`);
      continue;
    }
    const prise = await prisma.classe.findFirst({
      where: { tenantId, siteId: SITE_PK12_ID, annee: ANNEE, nom: r.nouveau },
      select: { id: true },
    });
    if (prise) throw new Error(`« ${r.nouveau} » existe déjà sur ${pk12.nom}`);
    console.log(`· « ${r.ancien} » → « ${r.nouveau} » (${classe._count.eleves} élève(s))`);
    renommages.push({ id: classe.id, ancien: r.ancien, nouveau: r.nouveau, eleves: classe._count.eleves });
  }

  const primaire = await prisma.structure.findFirst({
    where: { tenantId, siteId: SITE_CENTRAL_ID, type: "PRIMAIRE" },
    select: { id: true },
  });
  if (!primaire) throw new Error("Structure PRIMAIRE du Campus Central introuvable");
  const cinquiemeB = await prisma.classe.findFirst({
    where: { tenantId, siteId: SITE_CENTRAL_ID, annee: ANNEE, nom: "5ème Année B", structureId: null },
    select: { id: true, _count: { select: { eleves: true } } },
  });
  if (cinquiemeB) {
    console.log(`· « 5ème Année B » → structure Primaire (${cinquiemeB._count.eleves} élève(s))`);
  } else {
    console.log("· « 5ème Année B » : déjà rattachée à une structure");
  }

  if (renommages.length === 0 && !cinquiemeB) {
    console.log("\nRien à faire.");
    return;
  }
  if (!apply) {
    console.log("\nSimulation : rien n'a été écrit. Relancer avec --apply.");
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const r of renommages) {
      await tx.classe.update({ where: { id: r.id }, data: { nom: r.nouveau } });
    }
    if (cinquiemeB) {
      await tx.classe.update({ where: { id: cinquiemeB.id }, data: { structureId: primaire.id } });
    }
    await tx.auditLog.create({
      data: {
        tenantId,
        action: "maintenance.fix-classes-pk12-et-5eme-b",
        verdict: "ALLOWED",
        resource: "classes",
        reason:
          `${renommages.length} classe(s) de maternelle renommée(s) sur ${pk12.nom}` +
          (cinquiemeB ? " ; « 5ème Année B » rattachée à la structure Primaire du Campus Central." : "."),
        metadata: {
          script: "fix-classes-pk12-et-5eme-b.ts",
          renommages,
          rattachement: cinquiemeB ? { classeId: cinquiemeB.id, structureId: primaire.id } : null,
        },
      },
    });
  });
  console.log("\nÉcrit.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
