/**
 * Applique le verrou de nommage des niveaux (contraintes CHECK en base).
 * ============================================================
 * Le fichier de référence reste `migration_niveaux_canoniques.sql` (lisible
 * par un humain, rejouable avec psql). Ce script applique les MÊMES
 * contraintes via Prisma — parce que `psql` n'est pas disponible partout —
 * et construit la liste autorisée à partir de l'unique source de vérité
 * applicative (`NIVEAUX_CANONIQUES`, src/lib/niveau.ts) : aucune liste
 * dupliquée en TypeScript.
 *
 * LECTURE SEULE par défaut : vérifie les données, affiche le DDL, ne pose
 * rien. `--apply` pose les contraintes et prouve leur effet.
 *
 * Usage :
 *   set -a; . ./.env; set +a
 *   npx tsx scripts/appliquer-migration-niveaux.ts
 *   npx tsx scripts/appliquer-migration-niveaux.ts --apply
 */
import { PrismaClient } from "@prisma/client";
import { NIVEAUX_CANONIQUES } from "@/lib/niveau";

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });

/** Tables verrouillées : le niveau y indexe la grille tarifaire. */
const TABLES = [
  { table: "classes", contrainte: "classes_niveau_canonique" },
  { table: "tarifs_niveau", contrainte: "tarifs_niveau_canonique" },
] as const;

async function main() {
  const apply = process.argv.includes("--apply");

  // Liste SQL construite depuis le référentiel applicatif (échappement des ').
  const liste = NIVEAUX_CANONIQUES.map((n) => `'${n.replace(/'/g, "''")}'`).join(", ");

  console.log(`Référentiel (${NIVEAUX_CANONIQUES.length} valeurs) : ${NIVEAUX_CANONIQUES.join(", ")}\n`);

  // ── 1. Vérification préalable : rien hors référentiel ? ──────────
  const hors = await prisma.$queryRawUnsafe<{ table_origine: string; niveau: string; n: number }[]>(
    `select 'classes' as table_origine, niveau, count(*)::int as n
       from public.classes where niveau not in (${liste}) group by niveau
      union all
     select 'tarifs_niveau', niveau, count(*)::int as n
       from public.tarifs_niveau where niveau not in (${liste}) group by niveau
      order by 1, 2`,
  );

  if (hors.length > 0) {
    console.table(hors);
    console.error(
      "\n⛔ Des niveaux hors référentiel subsistent. Corrigez-les d'abord :\n" +
        "   npx tsx scripts/harmoniser-niveaux-classes.ts --apply",
    );
    process.exitCode = 1;
    return;
  }
  console.log("✅ Aucun niveau hors référentiel : la contrainte peut être posée.\n");

  // ── 2. DDL ───────────────────────────────────────────────────────
  for (const { table, contrainte } of TABLES) {
    const drop = `ALTER TABLE public.${table} DROP CONSTRAINT IF EXISTS ${contrainte}`;
    const add = `ALTER TABLE public.${table} ADD CONSTRAINT ${contrainte} CHECK (niveau IN (${liste}))`;
    console.log(`• ${table}\n    ${drop}\n    ${add}`);

    if (!apply) continue;

    await prisma.$executeRawUnsafe(drop);
    await prisma.$executeRawUnsafe(add);
    console.log(`    ✔ contrainte « ${contrainte} » posée.`);
  }

  if (!apply) {
    console.log("\nVÉRIFICATION UNIQUEMENT — relancer avec --apply pour verrouiller.");
    return;
  }

  // ── 3. Preuve : une écriture hors référentiel est refusée ────────
  const temoin = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `select id from public.classes limit 1`,
  );
  if (temoin.length > 0) {
    let refuse = false;
    try {
      // Transaction jetable : l'UPDATE est annulé par le throw ci-dessous.
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`UPDATE public.classes SET niveau = '2' WHERE id = $1`, temoin[0].id);
        throw new Error("ROLLBACK_VOLONTAIRE");
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      refuse = msg.includes("classes_niveau_canonique") || msg.includes("check constraint");
    }
    console.log(
      refuse
        ? "  ✔ preuve : un niveau « 2 » est désormais REFUSÉ par la base."
        : "  ⚠️  preuve non concluante (la contrainte existe-t-elle ? vérifier à la main).",
    );
  }

  // ── 4. Relecture des contraintes réellement présentes ───────────
  const posees = await prisma.$queryRawUnsafe<{ conname: string; definition: string }[]>(
    `select conname, pg_get_constraintdef(oid) as definition
       from pg_constraint
      where conname in ('classes_niveau_canonique', 'tarifs_niveau_canonique')
      order by conname`,
  );
  console.table(posees);
  console.log(`\n✅ ${posees.length}/${TABLES.length} contrainte(s) en place.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
