/**
 * Diagnostic (LECTURE SEULE) — volumétrie de la base courante.
 * Usage : npx tsx scripts/check-db-counts.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, bigint>>>(
    `select
       (select count(*) from tenants) as tenants,
       (select count(*) from users) as users,
       (select count(*) from eleves) as eleves,
       (select count(*) from classes) as classes,
       (select count(*) from factures) as factures,
       (select count(*) from bulletins) as bulletins,
       (select count(*) from annees_scolaires) as annees`,
  );
  console.table(
    Object.entries(rows[0] ?? {}).map(([k, v]) => ({ table: k, lignes: Number(v) })),
  );
}

main()
  .catch((e) => {
    console.error("Erreur :", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
