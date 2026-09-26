/**
 * Vérification exhaustive : les 34 comptes se connectent-ils avec le bon mot de
 * passe ? Contrôle les DEUX chemins d'authentification :
 *   1. Supabase Auth (auth.users)      → POST /auth/v1/token?grant_type=password
 *   2. Application (public.users)      → comparaison bcrypt du hash stocké
 *
 * Usage : npx tsx scripts/verify-all-auth-logins.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import bcrypt from "bcryptjs";
import { passwordForUser } from "./create-auth-users";

function env(key: string): string {
  const line = readFileSync(join(process.cwd(), ".env"), "utf8")
    .split("\n")
    .find((l) => l.startsWith(`${key}=`));
  return (line ?? "").split("=").slice(1).join("=").replace(/^["']|["']$/g, "");
}

const URL_ = process.env.SUPABASE_URL ?? env("SUPABASE_URL");
const ANON = process.env.SUPABASE_ANON_KEY ?? env("SUPABASE_ANON_KEY");
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? env("SUPABASE_SERVICE_ROLE_KEY");

interface Row {
  email: string;
  name: string;
  password: string | null;
}

async function main() {
  const res = await fetch(`${URL_}/rest/v1/users?select=email,name,password&order=email.asc`, {
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  });
  const rows = (await res.json()) as Row[];
  console.log(`Projet : ${URL_}`);
  console.log(`Comptes : ${rows.length}\n`);

  let authOk = 0;
  let bcryptOk = 0;
  const echecs: string[] = [];

  for (const r of rows) {
    const mdp = passwordForUser(r.email, r.name ?? "");

    const t = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: ANON, "Content-Type": "application/json" },
      body: JSON.stringify({ email: r.email, password: mdp }),
    });
    const auth = t.ok;
    const bc = r.password ? bcrypt.compareSync(mdp, r.password) : false;
    if (auth) authOk++;
    if (bc) bcryptOk++;
    if (!auth || !bc) echecs.push(`${r.email} (auth=${auth ? "ok" : "ÉCHEC"}, bcrypt=${bc ? "ok" : "ÉCHEC"})`);
    console.log(`  ${auth && bc ? "✅" : "❌"} ${r.email.padEnd(34)} ${mdp}`);
  }

  console.log(`\nSupabase Auth (auth.users) : ${authOk}/${rows.length}`);
  console.log(`Application   (public.users): ${bcryptOk}/${rows.length}`);
  if (echecs.length) console.log("Échecs :\n  " + echecs.join("\n  "));
}

main().catch((e) => {
  console.error("Erreur :", e instanceof Error ? e.message : e);
  process.exit(1);
});
