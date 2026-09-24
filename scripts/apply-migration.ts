import { readFileSync } from "fs";
import { join } from "path";
import { PrismaClient } from "@prisma/client";

function directUrlWithTimeout() {
  const base = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!base) throw new Error("DIRECT_URL ou DATABASE_URL requis");
  const separator = base.includes("?") ? "&" : "?";
  return `${base}${separator}sslmode=require&pool_timeout=60&connection_limit=1`;
}

async function main() {
  const url = directUrlWithTimeout();
  const prisma = new PrismaClient({
    log: ["error"],
    datasources: { db: { url } },
  });

  const sql = readFileSync(
    join(process.cwd(), "prisma", "migrations", "add_facture_type.sql"),
    "utf-8"
  );

  const statements = sql
    .split(/\n\n+/)
    .map((s) => s.trim())
    .filter((s) => {
      const hasContent = s
        .split("\n")
        .some((line) => line.trim().length > 0 && !line.trim().startsWith("--"));
      return hasContent;
    });

  console.log(`Exécution de ${statements.length} commande(s) SQL...`);

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    const preview = stmt
      .split("\n")
      .find((line) => !line.startsWith("--"))
      ?.slice(0, 80) ?? "";
    console.log(`[${i + 1}/${statements.length}] ${preview}`);
    try {
      await prisma.$executeRawUnsafe(stmt);
      console.log(`  ✓`);
    } catch (err) {
      console.error(`  ✗ ${(err as Error).message}`);
      throw err;
    }
  }

  console.log("Migration appliquée avec succès.");
  await prisma.$disconnect();
}

main()
  .catch((err) => {
    console.error("Erreur lors de l'application de la migration:", err);
    process.exit(1);
  });
