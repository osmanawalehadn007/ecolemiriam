/**
 * Vérification des prérequis e2e — tenant de démonstration et objets seedés.
 * ============================================================
 * La suite Playwright (`tests/e2e/`) cible des identifiants créés par
 * `prisma/seed.ts` (fixtures.ts § prérequis). Si la base cible n'a pas été
 * seedée, les tests échouent avec des erreurs trompeuses (404 partout) ; ce
 * script donne le diagnostic exact AVANT de lancer la suite.
 *
 * Sortie : code 0 si tout est présent, 1 sinon (utilisable comme étape CI).
 *
 * Usage : npx tsx scripts/check-e2e-data.ts
 */
import prisma from "../src/lib/prisma";

const E2E_EMAILS = [
  "admin@lycee-demo.ecolpro.app",
  "enseignant@lycee-demo.ecolpro.app",
  "enseignant2@lycee-demo.ecolpro.app",
  "parent@lycee-demo.ecolpro.app",
];

const E2E_IDS = {
  classe: "classe-tle-a-demo",
  site: "site-demo-annexe",
  eleve: "eleve-tle-a-1-demo",
  facture: "facture-b-demo",
  periode: "per-t2-demo",
};

async function main() {
  const tenant = await prisma.tenant.findFirst({
    where: { slug: "lycee-demo-seed" },
    select: { id: true, name: true, slug: true, sites: { select: { id: true, nom: true } } },
  });
  if (!tenant) throw new Error("Tenant de démo « lycee-demo-seed » absent — lancez `npm run db:seed`");
  console.log(`TENANT: ${tenant.name} (${tenant.slug}) — sites: ${tenant.sites.map((s) => s.nom).join(", ") || "aucun"}`);

  const users = await prisma.user.findMany({
    where: { email: { in: E2E_EMAILS } },
    select: { email: true, role: true },
  });
  const manquants = E2E_EMAILS.filter((e) => !users.some((u) => u.email === e));
  if (manquants.length) throw new Error(`Comptes e2e absents: ${manquants.join(", ")}`);
  console.log(`COMPTES E2E: ${users.map((u) => `${u.email} (${u.role})`).join(", ")}`);

  const [classe, site, eleve, facture, periode] = await Promise.all([
    prisma.classe.count({ where: { id: E2E_IDS.classe } }),
    prisma.site.count({ where: { id: E2E_IDS.site } }),
    prisma.eleve.count({ where: { id: E2E_IDS.eleve } }),
    prisma.facture.count({ where: { id: E2E_IDS.facture } }),
    prisma.periode.count({ where: { id: E2E_IDS.periode } }),
  ]);
  const objets = { classe, site, eleve, facture, periode };
  const absents = Object.entries(objets).filter(([, n]) => n === 0);
  if (absents.length) throw new Error(`Objets seed absents: ${absents.map(([k]) => k).join(", ")}`);
  console.log("OBJETS SEED: tous présents ✓");

  console.log("\n✅ Base prête pour la suite e2e.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌ PRÉREQUIS E2E MANQUANTS —", e.message);
    process.exit(1);
  });