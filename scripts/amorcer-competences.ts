/**
 * Amorce les carnets (domaines + compétences) de tous les tenants depuis
 * src/lib/carnet-primaire/modeles-carnets.json. Idempotent : un niveau déjà
 * configuré n'est pas touché. Ce passage est facultatif, le premier accès au
 * carnet d'un tenant amorce ses niveaux de la même façon.
 *   npx tsx scripts/amorcer-competences.ts
 */
import prisma, { runWithTenant } from "../src/lib/prisma";
import { initialiserCarnets } from "../src/lib/carnet-primaire/initialiser";

async function main() {
  const tenants = await prisma.tenant.findMany({ select: { id: true, name: true } });
  for (const t of tenants) {
    await runWithTenant(t.id, null, () => initialiserCarnets(t.id));
    console.log(`✓ ${t.name}`);
  }
}

main().finally(() => prisma.$disconnect());
