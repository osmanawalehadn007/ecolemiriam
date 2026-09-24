/**
 * Test de connectivité vers un PostgreSQL candidat.
 * Usage : npx tsx scripts/test-db-url.ts "<DATABASE_URL>" "<DIRECT_URL?>"
 */
import { PrismaClient } from "@prisma/client";

const url = process.argv[2];
if (!url) {
  console.error("Usage: tsx scripts/test-db-url.ts <url>");
  process.exit(2);
}

const direct = process.argv[3] ?? url.replace(":6543", ":5432");
const prisma = new PrismaClient({ datasources: { db: { url: direct } } });

async function main() {
  const v = await prisma.$queryRawUnsafe<{ version: string }[]>("SELECT version()::text AS version");
  console.log("CONNECTÉ:", v[0].version.slice(0, 60));
  const tables = await prisma.$queryRawUnsafe<{ n: number }[]>(
    "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public'"
  );
  console.log("tables public:", tables[0].n);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("ÉCHEC:", e.message.slice(0, 250));
    process.exit(1);
  });