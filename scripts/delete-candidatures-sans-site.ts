/**
 * École Miriam — Suppression des candidatures sans site
 * =======================================================
 *
 * Contexte : le bug du sélecteur d'admission (non filtré par site/année) a
 * créé 10 candidatures avec siteId = NULL. Ce sont des données de test
 * (TEST_WORKFLOW, TEST_ADMISSION, test22, etc.) et des doublons (FARAH AHMED
 * ×3). Aucune n'a de facture liée.
 *
 *   npx tsx scripts/delete-candidatures-sans-site.ts          # simulation
 *   npx tsx scripts/delete-candidatures-sans-site.ts --apply  # écriture
 */

import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";

dotenv.config();

const prisma = new PrismaClient({
  datasources: {
    db: { url: (process.env.DIRECT_URL ?? "") + "&connection_limit=1&pool_timeout=60" },
  },
});

async function main() {
  const apply = process.argv.includes("--apply");
  const mode = apply ? "ÉCRITURE" : "SIMULATION";
  console.log(`Mode : ${mode}\n`);

  const sansSite = await prisma.candidature.findMany({
    where: { siteId: null },
    select: { id: true, nom: true, prenom: true, statut: true, createdAt: true, tenantId: true },
    orderBy: { createdAt: "desc" },
  });

  if (sansSite.length === 0) {
    console.log("✅ Rien à faire : aucune candidature sans site.");
    return;
  }

  console.log(`${sansSite.length} candidature(s) sans site à supprimer :\n`);
  for (const c of sansSite) {
    console.log(`  ${c.nom} ${c.prenom} | statut=${c.statut} | créé ${c.createdAt.toISOString().slice(0, 10)}`);
  }

  const ids = sansSite.map((c) => c.id);
  const tenantId = sansSite[0].tenantId;

  // Vérifier les factures liées
  const facturesCount = await prisma.facture.count({ where: { candidatureId: { in: ids } } });
  console.log(`\nFactures liées : ${facturesCount}`);

  if (!apply) {
    console.log("\nSimulation terminée. Relancer avec --apply pour écrire.");
    return;
  }

  const result = await prisma.$transaction(
    async (tx) => {
      const factures = await tx.facture.deleteMany({ where: { candidatureId: { in: ids } } });
      const deleted = await tx.candidature.deleteMany({ where: { id: { in: ids } } });
      await tx.auditLog.create({
        data: {
          tenantId,
          action: "maintenance.suppression-candidatures-sans-site",
          verdict: "ALLOWED",
          resource: "candidatures",
          resourceId: ids.join(",").slice(0, 100),
          reason:
            `Suppression de ${deleted.count} candidature(s) sans siteId — donnees de test et doublons ` +
            `issues du bug du selecteur d'admission non filtre par annee/site.`,
          metadata: {
            script: "delete-candidatures-sans-site.ts",
            candidatures: sansSite.map((c) => ({ id: c.id, nom: `${c.nom} ${c.prenom}`, statut: c.statut })),
          },
        },
      });
      return { deleted: deleted.count, factures: factures.count };
    },
    { timeout: 30000, maxWait: 60000 },
  );

  console.log(`\n✅ ${result.deleted} candidature(s) supprimée(s), ${result.factures} facture(s) liée(s) supprimée(s).`);

  const restant = await prisma.candidature.count({ where: { siteId: null } });
  const total = await prisma.candidature.count();
  console.log(`Candidatures sans site restantes : ${restant}`);
  console.log(`Total candidatures restantes : ${total}`);
}

main()
  .catch((e) => {
    console.error("Erreur:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
