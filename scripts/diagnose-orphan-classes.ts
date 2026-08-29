/**
 * École Miriam — Diagnostic & correction des classes orphelines (siteId NULL)
 * =======================================================================
 *
 * Problème :
 *   Des classes créées avec `siteId = NULL` apparaissent dans le sélecteur
 *   de classe du formulaire d'inscription, même pour les utilisateurs
 *   site-scopés (le modèle `classe` n'est pas dans SHARED_NULL_MODELS, donc
 *   ces classes sont normalement exclues — mais un TENANT_ADMIN en vue
 *   « Tous les sites » les voit, et peut les sélectionner par erreur).
 *
 *   Cause racine : import d'élèves sans site sélectionné (avant le garde-fou
 *   `requireSiteIdForCreate`), ou création manuelle sans site.
 *
 * Usage :
 *   npx tsx scripts/diagnose-orphan-classes.ts          # diagnostic seul
 *   npx tsx scripts/diagnose-orphan-classes.ts --fix     # corriger (assigner au site majoritaire des élèves)
 *   npx tsx scripts/diagnose-orphan-classes.ts --fix --site-id <ID>  # forcer un site spécifique
 *
 * Prérequis : tunnel SSH vers le VPS actif (./scripts/start-vps-tunnel.sh)
 *             + DIRECT_URL dans .env (port 15432, rôle owner)
 */

import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";

dotenv.config();

const directUrl = process.env.DIRECT_URL;
if (!directUrl) {
  console.error("❌ DIRECT_URL manquant dans .env");
  process.exit(1);
}

const prisma = new PrismaClient({
  datasources: {
    db: { url: directUrl },
  },
  log: ["error"],
});

async function main() {
  const args = process.argv.slice(2);
  const shouldFix = args.includes("--fix");
  const forcedSiteId = args.find((a) => !a.startsWith("--") && a !== "--fix");

  // 1. Lister les classes orphelines
  const orphelines = await prisma.classe.findMany({
    where: { siteId: null },
    select: {
      id: true,
      nom: true,
      niveau: true,
      annee: true,
      tenantId: true,
      _count: { select: { eleves: true } },
    },
    orderBy: { nom: "asc" },
  });

  if (orphelines.length === 0) {
    console.log("✅ Aucune classe orpheline (siteId NULL) trouvée.");
    await prisma.$disconnect();
    return;
  }

  console.log(`\n⚠️  ${orphelines.length} classe(s) orpheline(s) trouvée(s) :\n`);
  console.log("─".repeat(80));

  for (const c of orphelines) {
    console.log(`  ID:       ${c.id}`);
    console.log(`  Nom:      ${c.nom}`);
    console.log(`  Niveau:   ${c.niveau}`);
    console.log(`  Année:    ${c.annee}`);
    console.log(`  Élèves:   ${c._count.eleves}`);

    if (shouldFix) {
      // Déterminer le site : forcé, ou déduit du site majoritaire des élèves
      let siteIdToAssign = forcedSiteId ?? null;

      if (!siteIdToAssign && c._count.eleves > 0) {
        // Trouver le site le plus représenté parmi les élèves de cette classe
        const eleves = await prisma.eleve.findMany({
          where: { classeId: c.id },
          select: { siteId: true },
        });
        const siteCounts = eleves.reduce<Record<string, number>>((acc, e) => {
          if (e.siteId) acc[e.siteId] = (acc[e.siteId] ?? 0) + 1;
          return acc;
        }, {});
        const sorted = Object.entries(siteCounts).sort((a, b) => b[1] - a[1]);
        if (sorted.length > 0) {
          siteIdToAssign = sorted[0][0];
          const site = await prisma.site.findUnique({
            where: { id: siteIdToAssign },
            select: { nom: true },
          });
          console.log(`  → Site déduit: ${site?.nom ?? siteIdToAssign} (${sorted[0][1]} élève(s))`);
        }
      }

      if (!siteIdToAssign) {
        // Aucun élève pour déduire le site → chercher un site du tenant
        const site = await prisma.site.findFirst({
          where: { tenantId: c.tenantId },
          orderBy: { nom: "asc" },
        });
        if (site) {
          siteIdToAssign = site.id;
          console.log(`  → Site par défaut (premier du tenant): ${site.nom}`);
        } else {
          console.log(`  ❌ Aucun site trouvé pour ce tenant — skipping`);
          console.log("─".repeat(80));
          continue;
        }
      }

      await prisma.classe.update({
        where: { id: c.id },
        data: { siteId: siteIdToAssign },
      });
      console.log(`  ✅ Classe rattachée au site ${siteIdToAssign}`);
    }

    console.log("─".repeat(80));
  }

  if (!shouldFix) {
    console.log(`\nPour corriger : npx tsx scripts/diagnose-orphan-classes.ts --fix`);
    console.log(`Pour forcer un site : npx tsx scripts/diagnose-orphan-classes.ts --fix --site-id <ID>`);
  } else {
    console.log(`\n✅ Correction terminée.`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("Erreur:", e);
  process.exit(1);
});
