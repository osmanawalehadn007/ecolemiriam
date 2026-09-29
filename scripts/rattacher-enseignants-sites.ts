/**
 * EcolPro — Rattrapage des enseignants sans site (EnseignantSite)
 * ============================================================
 * Le périmètre d'un enseignant se lit dans `enseignant_sites`. Jusqu'au
 * 29/09/2026, seul l'import en créait : les enseignants saisis à la main, via
 * invitation ou dont les accès ont été modifiés n'avaient aucune ligne, et
 * n'apparaissaient donc sur aucun site précis.
 *
 * Ce script déduit le(s) site(s) de chaque enseignant orphelin à partir des
 * accès de son compte (`user_sites`, sinon `users.siteId`). Un enseignant
 * dont le compte n'a aucun site est seulement signalé : à rattacher à la main
 * (Paramètres → Utilisateurs → Accès aux sites).
 *
 * LECTURE SEULE par défaut. Idempotent (`skipDuplicates`).
 *
 * Usage :
 *   export DIRECT_URL="$(grep '^DIRECT_URL=' .env | cut -d= -f2- | tr -d '\"')"
 *   npx tsx scripts/rattacher-enseignants-sites.ts            # aperçu
 *   npx tsx scripts/rattacher-enseignants-sites.ts --apply
 */
import { PrismaClient } from "@prisma/client";

const url = process.env.DIRECT_URL;
if (!url) {
  console.error("❌ DIRECT_URL manquant (rôle direct/owner, pas le pooler).");
  process.exit(1);
}

const prisma = new PrismaClient({ datasources: { db: { url } } });

async function main() {
  const apply = process.argv.includes("--apply");

  const orphelins = await prisma.enseignant.findMany({
    where: { sites: { none: {} } },
    select: {
      id: true,
      user: {
        select: {
          name: true,
          siteId: true,
          userSites: { select: { siteId: true } },
        },
      },
    },
    orderBy: { user: { name: "asc" } },
  });

  const sites = new Map(
    (await prisma.site.findMany({ select: { id: true, nom: true } })).map((s) => [s.id, s.nom])
  );

  const lignes: { enseignantId: string; siteId: string }[] = [];
  const sansSite: string[] = [];

  for (const e of orphelins) {
    const siteIds = new Set(e.user.userSites.map((us) => us.siteId));
    if (siteIds.size === 0 && e.user.siteId) siteIds.add(e.user.siteId);
    if (siteIds.size === 0) {
      sansSite.push(e.user.name);
      continue;
    }
    for (const siteId of siteIds) lignes.push({ enseignantId: e.id, siteId });
    console.log(`  ${e.user.name.padEnd(45)} → ${[...siteIds].map((id) => sites.get(id) ?? id).join(", ")}`);
  }

  console.log(`\n${orphelins.length} enseignant(s) sans site, ${lignes.length} rattachement(s) à créer.`);
  if (sansSite.length > 0) {
    console.log(`⚠️  ${sansSite.length} sans aucun site sur le compte (à traiter à la main) : ${sansSite.join(", ")}`);
  }

  if (!apply) {
    console.log("\nAperçu uniquement. Relancer avec --apply pour écrire.");
    return;
  }

  const { count } = await prisma.enseignantSite.createMany({ data: lignes, skipDuplicates: true });
  console.log(`\n✅ ${count} rattachement(s) créé(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
