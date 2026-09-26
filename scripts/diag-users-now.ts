/**
 * Diagnostic (LECTURE SEULE) — où sont les utilisateurs ?
 * Usage : npx tsx scripts/diag-users-now.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  console.log("HOST DB   :", url.replace(/:[^:@/]+@/, ":***@").split("@")[1]?.split("/")[0]);
  console.log("PROJET/DB :", (url.match(/postgres\.([a-z0-9]+):/) ?? [])[1]);

  const info = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `select current_database() db, current_user usr`,
  );
  console.log("BASE/USER :", info[0].db, "/", info[0].usr);

  const tables = await prisma.$queryRawUnsafe<Array<{ t: string; n: bigint }>>(
    `select 'public.users' t, count(*) n from public.users
     union all select 'auth.users', count(*) from auth.users
     union all select 'tenants', count(*) from tenants
     union all select 'user_tenants', count(*) from user_tenants`,
  );
  console.log("\n=== COMPTAGES ===");
  console.table(tables.map((r) => ({ table: r.t, lignes: Number(r.n) })));

  const pub = await prisma.$queryRawUnsafe<Array<{ email: string }>>(
    `select email from public.users where email ilike '%djama%' or email ilike '%abdi%' or email ilike '%ilyas%' order by email`,
  );
  console.log(`\n=== public.users : cibles retrouvées (${pub.length}) ===`);
  console.log(pub.map((r) => r.email).join("\n"));

  const auth = await prisma.$queryRawUnsafe<Array<{ email: string }>>(
    `select email from auth.users order by email`,
  );
  console.log(`\n=== auth.users (Supabase Authentication) : ${auth.length} compte(s) ===`);
  console.log(auth.map((r) => r.email).join("\n") || "(aucun)");

  const rls = await prisma.$queryRawUnsafe<
    Array<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>
  >(
    `select relname, relrowsecurity, relforcerowsecurity
       from pg_class where relname in ('users','tenants','sites','user_tenants') and relkind='r'`,
  );
  console.log("\n=== RLS (public) ===");
  console.table(rls);

  const pol = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `select tablename, policyname, cmd, roles::text from pg_policies where schemaname='public'`,
  );
  console.log(`\n=== POLITIQUES RLS public : ${pol.length} ===`);
  if (pol.length) console.table(pol);
}

main()
  .catch((e) => {
    console.error("Erreur :", e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
