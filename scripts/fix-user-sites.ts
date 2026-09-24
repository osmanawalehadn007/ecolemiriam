/**
 * Répare les rattachements multi-sites manquants (table `user_sites`) pour les
 * comptes dont la colonne `siteId` est renseignée mais sans entrée associée.
 * Sans ces rattachements, `resolveSiteScope` (fail-closed) renvoie NONE pour
 * tout le personnel non-direction : listes vides et 404 généralisés.
 *
 * SQL brut : le client Prisma généré est en avance sur la base (enum `Role`
 * avec `SUBJECT_LEAD` absent en base) et planterait sur tout `findMany(user)`.
 *
 * Idempotent. Usage : npx tsx scripts/fix-user-sites.ts
 */
import prisma from "../src/lib/prisma";

async function main() {
  const rows = (await prisma.$queryRawUnsafe(
    'SELECT "id", "email", "role", "siteId" FROM "users" WHERE "siteId" IS NOT NULL'
  )) as Array<{ id: string; email: string; role: string; siteId: string }>;

  let crees = 0;
  for (const r of rows) {
    const exists = (await prisma.$queryRawUnsafe(
      'SELECT 1 FROM "user_sites" WHERE "userId"=$1 AND "siteId"=$2',
      r.id,
      r.siteId
    )) as unknown[];
    if (exists.length > 0) continue;
    await prisma.$queryRawUnsafe(
      'INSERT INTO "user_sites" ("id", "userId", "siteId", "role", "createdAt") VALUES (gen_random_uuid()::text, $1, $2, $3, now())',
      r.id,
      r.siteId,
      r.role
    );
    crees++;
    console.log(`+ UserSite: ${r.email} (${r.role}) → ${r.siteId}`);
  }
  const total = (await prisma.$queryRawUnsafe(
    'SELECT count(*)::int AS n FROM "user_sites"'
  )) as Array<{ n: number }>;
  console.log(
    crees === 0
      ? `Aucun rattachement à créer — total user_sites: ${total[0].n}`
      : `${crees} rattachement(s) créé(s) — total user_sites: ${total[0].n}`
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("ERR", e.message.slice(0, 300));
    process.exit(1);
  });