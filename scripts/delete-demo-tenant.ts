/**
 * Suppression du tenant de DÉMONSTRATION (éléments de test).
 * ============================================================
 * Garde-fous :
 *   • le tenant ciblé doit avoir pour slug `lycee-demo-seed` (défaut)
 *   • son nom doit contenir « Démonstration »
 *   • il ne doit PAS être le tenant de production École Miriam
 *     (`cms8kt0b40001zbi3o63y7c5v`)
 * Sans les trois conditions, le script refuse de s'exécuter.
 *
 * La suppression est en cascade (44 tables ont une FK ON DELETE CASCADE
 * vers `tenants`) : élèves, classes, notes, factures, sites et comptes du
 * tenant de démo sont retirés ensemble.
 *
 * Usage :
 *   npx tsx scripts/delete-demo-tenant.ts                 # simulation
 *   npx tsx scripts/delete-demo-tenant.ts --apply
 *   npx tsx scripts/delete-demo-tenant.ts --slug=autre-demo --apply
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const PROD_TENANT_ID = "cms8kt0b40001zbi3o63y7c5v";

async function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const slug = ((argv.find((a) => a.startsWith("--slug=")) ?? "").slice(7)) || "lycee-demo-seed";

  const tenant = await prisma.tenant.findUnique({
    where: { slug },
    select: { id: true, name: true, slug: true, plan: true, status: true },
  });
  if (!tenant) throw new Error(`Aucun tenant avec le slug « ${slug} » — rien à supprimer.`);

  // --- Garde-fous ---------------------------------------------------------
  if (tenant.id === PROD_TENANT_ID) {
    throw new Error(`Refus : le tenant « ${slug} » est le tenant de PRODUCTION (${PROD_TENANT_ID}).`);
  }
  if (!/d[ée]monstration/i.test(tenant.name)) {
    throw new Error(
      `Refus : le tenant « ${tenant.name} » (${tenant.id}) n'est pas identifié comme une démonstration.`,
    );
  }

  console.log(`Tenant ciblé : ${tenant.name} — slug=${tenant.slug} — id=${tenant.id}`);
  console.log(`Plan/statut  : ${tenant.plan}/${tenant.status}`);
  console.log(`Mode         : ${apply ? "SUPPRESSION" : "simulation"}\n`);

  // --- Volumétrie qui sera supprimée --------------------------------------
  const fkTables = await prisma.$queryRawUnsafe<Array<{ table_name: string }>>(
    `select c.relname as table_name
       from pg_constraint k
       join pg_class c on c.oid = k.conrelid
       join pg_class r on r.oid = k.confrelid
      where k.contype='f' and r.relname='tenants'
      order by 1`,
  );

  let total = 0;
  const detail: Array<{ table: string; lignes: number }> = [];
  for (const t of fkTables) {
    const rows = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
      `select count(*)::int n from "${t.table_name}" where "tenantId" = $1`,
      tenant.id,
    );
    if (rows[0].n > 0) {
      detail.push({ table: t.table_name, lignes: rows[0].n });
      total += rows[0].n;
    }
  }
  console.table(detail);
  console.log(`Total : ${total} lignes réparties sur ${detail.length} tables.\n`);

  if (!apply) {
    console.log("(simulation — aucune suppression. Relancez avec --apply)");
    return;
  }

  // --- Suppression (cascade) ---------------------------------------------
  await prisma.$executeRawUnsafe(`DELETE FROM "public"."tenants" WHERE "id" = $1`, tenant.id);

  const reste = await prisma.tenant.count({ where: { id: tenant.id } });
  console.log(`✓ Tenant supprimé (restant=${reste}).`);
  console.log(`  Tenants en base : ${await prisma.tenant.count()}`);
  console.log(`  Utilisateurs    : ${await prisma.user.count()}`);
  const autres = await prisma.tenant.findMany({ select: { id: true, name: true, slug: true } });
  console.table(autres);
}

main()
  .catch((e) => {
    console.error("\nERREUR :", e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
