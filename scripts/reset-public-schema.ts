/**
 * Réinitialise entièrement le schéma `public` d'un PostgreSQL cible.
 * ⚠️ DESTRUCTIF : toutes les tables/vues/fonctions du schéma sont supprimées.
 * Destiné aux bases de travail Supabase contenant les résidus d'un ancien
 * projet (tables héritées avec FK vers `auth.users` qui bloquent `db push`).
 *
 * Usage : npx tsx scripts/reset-public-schema.ts
 */
import { PrismaClient } from "@prisma/client";

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DIRECT_URL/DATABASE_URL manquant");
  process.exit(2);
}
const prisma = new PrismaClient({ datasources: { db: { url } } });

async function main() {
  console.log("⚠️  Réinitialisation du schéma public (par lots pour éviter le dépassement de verrous)…");
  // Récupérer les objets à supprimer
  const tables = (await prisma.$queryRawUnsafe(
    `SELECT tablename AS name FROM pg_tables WHERE schemaname='public'`
  )) as Array<{ name: string }>;
  const views = (await prisma.$queryRawUnsafe(
    `SELECT viewname AS name FROM pg_views WHERE schemaname='public'`
  )) as Array<{ name: string }>;

  // Supprimer par lots de 25 pour rester sous max_locks_per_transaction
  const all = [
    ...views.map((v) => `DROP VIEW IF EXISTS "public"."${v.name}" CASCADE`),
    ...tables.map((t) => `DROP TABLE IF EXISTS "public"."${t.name}" CASCADE`),
  ];
  console.log(`${all.length} objets à supprimer…`);
  const BATCH = 25;
  for (let i = 0; i < all.length; i += BATCH) {
    const lot = all.slice(i, i + BATCH).join(";\n");
    try {
      await prisma.$executeRawUnsafe(lot);
    } catch (e) {
      // certaine dépendance peut faire échouer un lot : retenter à la fin
      console.log(`lot ${Math.floor(i / BATCH) + 1}: retry en fin de passe (${(e as Error).message.slice(0, 60)})`);
      for (const stmt of all.slice(i, i + BATCH)) {
        try { await prisma.$executeRawUnsafe(stmt); } catch { /* volonté : nettoyage best-effort */ }
      }
    }
  }
  // Deuxième passe : tout ce qui restait (dépendances circulaires)
  const restants = (await prisma.$queryRawUnsafe(
    `SELECT tablename AS name FROM pg_tables WHERE schemaname='public'`
  )) as Array<{ name: string }>;
  for (const t of restants) {
    try { await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "public"."${t.name}" CASCADE`); }
    catch (e) { console.log(`impossible de supprimer ${t.name}: ${(e as Error).message.slice(0, 60)}`); }
  }
  const reste = (await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'`
  )) as Array<{ n: number }>;
  console.log(`✅ Tables restantes dans public: ${reste[0].n} (objectif 0 hors extensions)`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch((e) => {
    console.error("ERR", e.message.slice(0, 300));
    process.exit(1);
  });