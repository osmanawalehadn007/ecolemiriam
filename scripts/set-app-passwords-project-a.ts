/**
 * Applique les nouveaux mots de passe à `public.users` du projet Supabase réel
 * (celui des clés SUPABASE_URL / SERVICE_ROLE), via l'API PostgREST.
 * ============================================================
 * Pourquoi ici : le `.env` du dépôt pointe `DATABASE_URL` vers un AUTRE projet
 * Supabase que `SUPABASE_URL`. La production est celle de `SUPABASE_URL` ; c'est
 * donc elle qu'il faut mettre à jour pour que les mots de passe fonctionnent à
 * la connexion de l'application.
 *
 * Étapes :
 *   1. Sauvegarde des hashs actuels (rollback)   → ~/ecolpro-recovery/
 *   2. PATCH de `password` pour chaque compte
 *   3. Vérification (bcrypt) que le mot de passe attendu correspond
 *
 * Usage :
 *   npx tsx scripts/set-app-passwords-project-a.ts           # simulation
 *   npx tsx scripts/set-app-passwords-project-a.ts --apply
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import bcrypt from "bcryptjs";
import { passwordForUser } from "./create-auth-users";

function env(key: string): string {
  const line = readFileSync(join(process.cwd(), ".env"), "utf8")
    .split("\n")
    .find((l) => l.startsWith(`${key}=`));
  return (line ?? "").split("=").slice(1).join("=").replace(/^["']|["']$/g, "");
}

const URL_ = process.env.SUPABASE_URL ?? env("SUPABASE_URL");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? env("SUPABASE_SERVICE_ROLE_KEY");
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

async function rest(path: string, init: RequestInit = {}) {
  const res = await fetch(`${URL_}/rest/v1${path}`, { ...init, headers: { ...H, ...(init.headers ?? {}) } });
  const txt = await res.text();
  if (!res.ok) throw new Error(`${res.status} — ${txt.slice(0, 300)}`);
  return txt ? JSON.parse(txt) : null;
}

interface Row {
  id: string;
  email: string;
  name: string;
  password: string | null;
}

async function main() {
  const apply = process.argv.slice(2).includes("--apply");
  console.log(`Projet cible : ${URL_}`);
  console.log(`Mode         : ${apply ? "APPLICATION" : "simulation"}\n`);

  const rows = (await rest(`/users?select=id,email,name,password&order=email.asc`)) as Row[];
  console.log(`Comptes trouvés : ${rows.length}`);

  // 1. Sauvegarde (rollback)
  const dossier = join(homedir(), "ecolpro-recovery");
  const fichierSauvegarde = join(dossier, `hashs-public-users-backup-${Date.now()}.json`);
  writeFileSync(fichierSauvegarde, JSON.stringify(rows, null, 2), { mode: 0o600 });
  console.log(`Hashes actuels sauvegardés (rollback) : ${fichierSauvegarde}\n`);

  let maj = 0;
  for (const r of rows) {
    const attendu = passwordForUser(r.email, r.name ?? "");
    const dejaBon = r.password ? bcrypt.compareSync(attendu, r.password) : false;
    if (dejaBon) {
      console.log(`= ${r.email} — déjà à jour`);
      continue;
    }
    if (!apply) {
      console.log(`→ ${r.email} — à mettre à jour`);
      continue;
    }
    await rest(`/users?email=eq.${encodeURIComponent(r.email)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ password: bcrypt.hashSync(attendu, 12) }),
    });
    maj++;
    console.log(`✓ ${r.email}`);
  }

  if (!apply) {
    console.log("\n(simulation — relancez avec --apply)");
    return;
  }

  console.log(`\n${maj} compte(s) mis à jour. Vérification…`);
  const apres = (await rest(`/users?select=email,name,password`)) as Array<{
    email: string;
    name: string;
    password: string;
  }>;
  const ko = apres.filter((r) => !bcrypt.compareSync(passwordForUser(r.email, r.name ?? ""), r.password));
  console.log(`Vérification bcrypt : ${apres.length - ko.length}/${apres.length} conformes`);
  if (ko.length) console.log("Non conformes :", ko.map((r) => r.email).join(", "));
}

main().catch((e) => {
  console.error("Erreur :", e instanceof Error ? e.message : e);
  process.exit(1);
});
