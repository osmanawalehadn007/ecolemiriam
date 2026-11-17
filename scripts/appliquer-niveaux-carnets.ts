/**
 * Pose les CHECK de niveau sur competences, carnet_configurations et carnets_primaires,
 * avec la liste du cycle Primaire de NIVEAUX_PAR_CYCLE (src/lib/niveau.ts).
 * Lecture seule par défaut ; --apply pose les contraintes.
 *   set -a; . ./.env; set +a; npx tsx scripts/appliquer-niveaux-carnets.ts [--apply]
 */
import { PrismaClient } from "@prisma/client";
import { NIVEAUX_PAR_CYCLE } from "@/lib/niveau";

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
const TABLES = ["competences", "carnet_configurations", "carnets_primaires"] as const;

async function main() {
  const primaire = NIVEAUX_PAR_CYCLE.find((c) => c.cycle === "Primaire")!.niveaux;
  const liste = primaire.map((n) => `'${n}'`).join(", ");
  console.log(`Niveaux autorisés : ${primaire.join(", ")}`);
  for (const t of TABLES) {
    const hors = await prisma.$queryRawUnsafe<{ niveau: string; n: number }[]>(
      `select niveau, count(*)::int n from public.${t} where niveau not in (${liste}) group by niveau`
    );
    if (hors.length) {
      console.table(hors);
      throw new Error(`${t} : niveaux hors référentiel, corrigez d'abord`);
    }
    console.log(`✓ ${t} : aucune donnée hors référentiel`);
  }
  if (!process.argv.includes("--apply")) return console.log("Lecture seule : relancez avec --apply");
  for (const t of TABLES) {
    const nom = `${t}_niveau_canonique`;
    await prisma.$executeRawUnsafe(`alter table public.${t} drop constraint if exists ${nom}`);
    await prisma.$executeRawUnsafe(`alter table public.${t} add constraint ${nom} check (niveau in (${liste}))`);
    console.log(`✔ ${nom} posée`);
  }
  // Preuve : « Première » (lycée) doit être refusé.
  try {
    await prisma.$executeRawUnsafe(`insert into public.competences (id,"tenantId",niveau,domaine,ordre,libelle,"updatedAt") select 'test_niv',"tenantId",'Première','X',0,'x',now() from public.competences limit 1`);
    throw new Error("« Première » a été accepté : verrou inefficace");
  } catch (e) {
    console.log(`✔ « Première » refusé : ${(e as Error).message.split("\n").pop()?.slice(0, 90)}`);
  }
}
main().finally(() => prisma.$disconnect());
