#!/usr/bin/env node
/**
 * Diagnostic LECTURE SEULE de la base école (aucune écriture, aucun DDL).
 * ============================================================
 * Sert à répondre en 3 secondes à « quelle base est réellement utilisée, et
 * quel est son état ? » — question sur laquelle la documentation s'est déjà
 * trompée (le Postgres du VPS n'est plus la base live).
 *
 * Usage :
 *   export DIRECT_URL="postgresql://…"      # rôle owner / direct, hors PgBouncer
 *   node scripts/diagnostic-db.mjs
 *
 * Pour interroger la base de PRODUCTION, utiliser le `DIRECT_URL` de
 * l'environnement du conteneur applicatif (voir AGENTS.md § État des bases).
 * Le script refuse d'écrire : uniquement des SELECT d'inventaire.
 */
import { PrismaClient } from "@prisma/client";

const url = process.env.DIRECT_URL;
if (!url) {
  console.error("❌ DIRECT_URL manquant (rôle direct/owner, pas le pooler PgBouncer).");
  process.exit(1);
}

const prisma = new PrismaClient({ datasources: { db: { url } } });

/** Hôte + base, sans identifiants. */
function cibleBrute(url) {
  const sansId = url.replace(/:[^:@/]+@/, ":***@");
  const m = sansId.match(/@([^/]+)\/([^?]+)/);
  return m ? `${m[1]}/${m[2]}` : "?";
}

async function compter(label, sql) {
  try {
    const [row] = await prisma.$queryRawUnsafe(sql);
    return `${label}=${row?.n ?? row?.t ?? JSON.stringify(row)}`;
  } catch (e) {
    return `${label}=ERREUR(${String(e.message).split("\n")[0].slice(0, 80)})`;
  }
}

console.log(`Base interrogée : ${cibleBrute(url)}\n`);

const resultats = await Promise.all([
  compter("tables", "select count(*)::int as n from information_schema.tables where table_schema='public'"),
  compter("invitations", "select coalesce(to_regclass('public.invitations')::text,'ABSENTE') as t"),
  compter("users", "select count(*)::int as n from users"),
  compter("tenants", "select count(*)::int as n from tenants"),
  compter("eleves", "select count(*)::int as n from eleves"),
  compter("dernier_user", `select to_char(max("createdAt"),'YYYY-MM-DD') as t from users`),
]);
console.log(resultats.join("  |  "));

const colonnes = await prisma.$queryRawUnsafe(
  "select column_name from information_schema.columns where table_name='users' and column_name in ('mustChangePassword','emailVerified') order by 1",
);
console.log(`colonnes users (récentes) : ${colonnes.map((c) => c.column_name).join(", ") || "AUCUNE"}`);

await prisma.$disconnect();
