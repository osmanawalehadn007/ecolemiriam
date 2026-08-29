/**
 * École Miriam — Rattachement des candidatures orphelines à leur site
 * ==================================================================
 *
 * Une candidature sans `siteId` ne peut plus produire d'inscription : la
 * création de l'élève est désormais refusée faute de site (elle aurait
 * fabriqué un élève orphelin, visible depuis tous les sites).
 *
 * Ce script déduit le site à partir du nom de la classe demandée
 * (`classeVoulue`) :
 *   - le nom correspond à des classes d'UN SEUL site → rattachement ;
 *   - le nom correspond à plusieurs sites, ou à aucune classe → laissé en
 *     l'état et signalé (arbitrage humain nécessaire).
 *
 * Aucune suppression. Lecture seule sans `--apply`.
 *
 *   npx tsx scripts/fix-candidatures-sans-site.ts          # simulation
 *   npx tsx scripts/fix-candidatures-sans-site.ts --apply  # écriture
 */

import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";

dotenv.config();

const prisma = new PrismaClient({
  datasources: {
    db: { url: (process.env.DIRECT_URL ?? "") + "&connection_limit=1&pool_timeout=60" },
  },
});

const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, "").trim();

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(`Mode : ${apply ? "ÉCRITURE" : "SIMULATION"}\n`);

  const orphelines = await prisma.candidature.findMany({
    where: { siteId: null },
    select: { id: true, nom: true, prenom: true, classeVoulue: true, annee: true, statut: true, tenantId: true },
    orderBy: { createdAt: "desc" },
  });

  if (orphelines.length === 0) {
    console.log("✅ Aucune candidature sans site.");
    return;
  }

  const classes = await prisma.classe.findMany({
    select: { nom: true, annee: true, siteId: true, tenantId: true, site: { select: { nom: true } } },
  });

  const rattachables: { id: string; siteId: string; libelle: string }[] = [];
  const aArbitrer: string[] = [];

  for (const c of orphelines) {
    const candidates = classes.filter(
      (k) =>
        k.tenantId === c.tenantId &&
        k.siteId &&
        norm(k.nom) === norm(c.classeVoulue) &&
        k.annee === c.annee
    );
    const sites = new Set(candidates.map((k) => k.siteId!));

    if (sites.size === 1) {
      const siteId = [...sites][0];
      const siteNom = candidates[0].site?.nom ?? siteId;
      rattachables.push({
        id: c.id,
        siteId,
        libelle: `${c.prenom} ${c.nom} — « ${c.classeVoulue} » ${c.annee} → ${siteNom}`,
      });
    } else {
      aArbitrer.push(
        `${c.prenom} ${c.nom} — « ${c.classeVoulue} » ${c.annee} (${c.statut}) : ` +
          (sites.size === 0
            ? "aucune classe de ce nom pour cette année"
            : `${sites.size} sites possibles`)
      );
    }
  }

  console.log(`Candidatures sans site : ${orphelines.length}\n`);
  console.log(`→ ${rattachables.length} rattachable(s) sans ambiguïté :`);
  for (const r of rattachables) console.log(`   ${r.libelle}`);
  console.log(`\n→ ${aArbitrer.length} à arbitrer manuellement :`);
  for (const a of aArbitrer) console.log(`   ${a}`);

  if (!apply) {
    console.log("\nSimulation terminée. Relancer avec --apply pour écrire.");
    return;
  }

  for (const r of rattachables) {
    await prisma.candidature.update({ where: { id: r.id }, data: { siteId: r.siteId } });
  }
  console.log(`\n✅ ${rattachables.length} candidature(s) rattachée(s).`);
}

main()
  .catch((e) => {
    console.error("Erreur:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
