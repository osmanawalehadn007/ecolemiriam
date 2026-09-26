/**
 * Création des comptes Supabase Auth (auth.users) + mots de passe applicatifs.
 * ============================================================
 * Objectif : faire apparaître les comptes dans
 *   Supabase → Authentication → Users   (= table `auth.users`)
 * tout en gardant la connexion fonctionnelle dans l'application
 *   (= table `public.users`, vérifiée par bcrypt dans NextAuth).
 *
 * Règles de mot de passe :
 *   • ilyasadendjama@gmail.com, mohamed.abdi.pk12@gmail.com,
 *     ahdimounomar@gmail.com                        → `EcolPro@2026`
 *   • tous les autres → `prenom12345` (1er mot du nom, EN MINUSCULES)
 *     ex. « ARAFO BOURALEH DJAMA » → `arafo12345`
 *
 * Méthode : Admin API Supabase (`POST /auth/v1/admin/users`) — la voie
 * officielle : GoTrue crée `auth.users` **et** `auth.identities`, confirme
 * l'email et hashe le mot de passe. Un compte déjà présent est mis à jour
 * (`PUT /auth/v1/admin/users/{id}`) au lieu d'être dupliqué.
 *
 * Usage :
 *   npx tsx scripts/create-auth-users.ts            # simulation (affiche tout)
 *   npx tsx scripts/create-auth-users.ts --apply
 *
 * ⚠️ Les mots de passe générés sont volontairement simples : ils sont
 * devinables. À faire changer à la première connexion.
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// ---- Chargement minimal de .env (le client Prisma ne lit que DATABASE_URL) --
function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (const line of readFileSync(join(process.cwd(), ".env"), "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!m) continue;
      out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* .env absent : on se rabat sur process.env */
  }
  return out;
}

const ENV = { ...loadEnv(), ...process.env } as Record<string, string>;
const SUPABASE_URL = ENV.SUPABASE_URL;
const SERVICE_KEY = ENV.SUPABASE_SERVICE_ROLE_KEY;

// ---- Règles ---------------------------------------------------------------
const SPECIAL: Record<string, string> = {
  "ilyasadendjama@gmail.com": "EcolPro@2026",
  "mohamed.abdi.pk12@gmail.com": "EcolPro@2026",
  "ahdimounomar@gmail.com": "EcolPro@2026",
};

const SUFFIX = "12345";

/** « ARAFO BOURALEH DJAMA » → « arafo12345 » (minuscules) */
export function passwordFor(name: string): string {
  const premier = (name ?? "").trim().split(/\s+/)[0] ?? "";
  const nettoye = premier.replace(/[^A-Za-zÀ-ÿ'-]/g, "");
  return `${nettoye.toLowerCase()}${SUFFIX}`;
}

export function passwordForUser(email: string, name: string): string {
  return SPECIAL[email.trim().toLowerCase()] ?? passwordFor(name);
}

// ---- Admin API Supabase ---------------------------------------------------
interface AuthUser {
  id: string;
  email: string;
}

async function adminFetch(path: string, init: RequestInit): Promise<unknown> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const texte = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${texte.slice(0, 200)}`);
  return texte ? JSON.parse(texte) : {};
}

async function findAuthUserByEmail(email: string): Promise<AuthUser | null> {
  const data = (await adminFetch(`/admin/users?page=1&per_page=200`, { method: "GET" })) as {
    users?: AuthUser[];
  };
  const cible = email.trim().toLowerCase();
  return (data.users ?? []).find((u) => (u.email ?? "").toLowerCase() === cible) ?? null;
}

async function createAuthUser(email: string, password: string, name: string): Promise<AuthUser> {
  return (await adminFetch(`/admin/users`, {
    method: "POST",
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { name, source: "ecolpro-restauration" },
    }),
  })) as AuthUser;
}

async function setAuthPassword(id: string, password: string): Promise<void> {
  await adminFetch(`/admin/users/${id}`, {
    method: "PUT",
    body: JSON.stringify({ password, email_confirm: true }),
  });
}

// ---- Programme principal --------------------------------------------------
async function main() {
  const apply = process.argv.slice(2).includes("--apply");

  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error("SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY manquant dans .env");
  }

  const users = await prisma.user.findMany({
    select: { id: true, email: true, name: true, role: true },
    orderBy: { createdAt: "asc" },
  });

  const plan = users.map((u) => {
    let mdp = passwordForUser(u.email, u.name);
    // Repli si le nom ne contient aucune lettre exploitable
    if (mdp === `${SUFFIX}`) {
      const local = u.email.split("@")[0].replace(/[^A-Za-z0-9]/g, "");
      mdp = `${local.charAt(0).toUpperCase()}${local.slice(1).toLowerCase()}${SUFFIX}`;
    }
    return { ...u, mdp, special: Boolean(SPECIAL[u.email.trim().toLowerCase()]) };
  });

  console.log(`Comptes à traiter : ${plan.length}`);
  console.log(`Règle            : prenom${SUFFIX} en minuscules (sauf 3 comptes → EcolPro@2026)`);
  console.log(`Mode             : ${apply ? "APPLICATION" : "simulation"}\n`);

  console.log(
    plan
      .map(
        (p, i) =>
          `${String(i + 1).padStart(2)}. ${p.email.padEnd(34)} ${p.mdp.padEnd(22)} ${p.special ? "(spécial)" : ""}`,
      )
      .join("\n"),
  );

  // Doublons de mot de passe (emails différents, mot de passe identique)
  const parMdp = new Map<string, string[]>();
  for (const p of plan) parMdp.set(p.mdp, [...(parMdp.get(p.mdp) ?? []), p.email]);
  const doublons = [...parMdp.entries()].filter(([, e]) => e.length > 1);
  if (doublons.length) {
    console.log("\n⚠️  Mots de passe partagés par plusieurs comptes (à vérifier) :");
    for (const [mdp, emails] of doublons) console.log(`   ${mdp} → ${emails.join(", ")}`);
  }

  if (!apply) {
    console.log("\n(simulation — relancez avec --apply)");
    return;
  }

  // ---- Exécution --------------------------------------------------------
  let crees = 0;
  let maj = 0;
  let echecs = 0;
  const rapport: string[] = ["email;nom;role;mot_de_passe;auth"];

  for (const p of plan) {
    try {
      const existant = await findAuthUserByEmail(p.email);
      if (existant) {
        await setAuthPassword(existant.id, p.mdp);
        maj++;
        console.log(`↻ ${p.email} — mot de passe mis à jour dans Supabase Auth`);
      } else {
        await createAuthUser(p.email, p.mdp, p.name);
        crees++;
        console.log(`+ ${p.email} — créé dans Supabase Auth`);
      }
      // Connexion applicative : public.users.password (bcrypt)
      await prisma.user.update({
        where: { id: p.id },
        data: { password: bcrypt.hashSync(p.mdp, 12) },
      });
      rapport.push(`${p.email};${p.name};${p.role};${p.mdp};ok`);
    } catch (e) {
      echecs++;
      console.error(`✗ ${p.email} — ${e instanceof Error ? e.message : e}`);
      rapport.push(`${p.email};${p.name};${p.role};${p.mdp};ECHEC`);
    }
  }

  const fichier = join(homedir(), "ecolpro-recovery", "mots-de-passe-utilisateurs.csv");
  writeFileSync(fichier, rapport.join("\n") + "\n", { mode: 0o600 });
  console.log(`\nCréés : ${crees} · mis à jour : ${maj} · échecs : ${echecs}`);
  console.log(`Rapport (confidentiel, chmod 600) : ${fichier}`);
  console.log(`\nTotal comptes en base : ${await prisma.user.count()}`);
}

main()
  .catch((e) => {
    console.error("\nERREUR :", e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());


