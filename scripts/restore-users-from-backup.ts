/**
 * ============================================================
 * École Miriam — Restauration CIBLÉE des utilisateurs
 * ============================================================
 *
 * Restaure UNIQUEMENT les comptes utilisateurs réels extraits d'un dump
 * pg_dump, en écartant tous les éléments de test / démo.
 *
 * Restauré (le strict nécessaire pour que les comptes se reconnectent) :
 *   1. `tenants`          — établissement d'appartenance (clé étrangère)
 *   2. `sites`            — campus (clé étrangère users.siteId)
 *   3. `users`            — comptes (email + hash bcrypt conservés)
 *   4. `user_tenants`     — adhésions (deriveClaims s'appuie dessus)
 *   5. `user_sites`       — rattachements multi-sites
 *   6. `annees_scolaires` — optionnel (--with-annee)
 *
 * Jamais restauré : élèves, notes, bulletins, factures, absences,
 * messagerie, comptes de démonstration, `auth.users` de test.
 *
 * Prérequis : blocs COPY extraits du dump, ex.
 *   pg_restore --data-only --table=users -f users_data.sql <dump.pgcustom>
 *
 * Usage :
 *   npx tsx scripts/restore-users-from-backup.ts --dir ~/ecolpro-recovery
 *   npx tsx scripts/restore-users-from-backup.ts --dir ~/ecolpro-recovery --apply
 *   ... --apply --free-slug=lycee-demo-seed   # libère un slug déjà pris
 *
 * ⚠️ LECTURE SEULE par défaut. `--apply` écrit en base (transaction unique).
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const prisma = new PrismaClient();

// ---- Comptes « éléments de test » : jamais restaurés -----------------------
const TEST_EMAIL_PATTERNS: RegExp[] = [
  /super\.admin@test\.com/i,
  /@test\.com$/i,
  /@example\.(com|org)$/i,
  /^admin@lycee-demo\.ecolpro\.app$/i,
  /^enseignant2?@lycee-demo\.ecolpro\.app$/i,
  /^parent@lycee-demo\.ecolpro\.app$/i,
];

// ---- Colonnes réellement présentes en production --------------------------
// (le dump du 23/09 contenait aussi mfaSecret/mfaEnabled, absents en prod)
const COLUMNS: Record<string, string[]> = {
  tenants: [
    "id", "name", "slug", "domain", "logoUrl", "plan", "status", "trialEndsAt",
    "address", "city", "country", "phone", "email", "website", "siret",
    "currentYear", "notationMax", "langue", "timezone", "currency",
    "primaryColor", "secondaryColor", "signatureUrl", "cachetUrl",
    "chefEtablissement", "stripeCustomerId", "stripeSubscriptionId",
    "createdAt", "updatedAt",
  ],
  sites: [
    "id", "tenantId", "nom", "code", "adresse", "ville", "telephone", "email",
    "actif", "deletedAt", "deletedBy", "deletedReason", "scheduledPurgeAt",
    "createdAt", "updatedAt",
  ],
  users: [
    "id", "tenantId", "siteId", "email", "emailVerified", "password", "name",
    "firstName", "lastName", "avatarUrl", "phone", "role", "isActive",
    "lastLoginAt", "langue", "locale", "notifications", "createdAt", "updatedAt",
  ],
  user_tenants: [
    "id", "userId", "tenantId", "role", "isActive", "isDefault", "createdAt", "updatedAt",
  ],
  user_sites: ["id", "userId", "siteId", "role", "createdAt", "updatedAt"],
  annees_scolaires: ["id", "tenantId", "libelle", "dateDebut", "dateFin", "isCurrent"],
};

interface Args {
  dir: string;
  apply: boolean;
  out?: string;
  freeSlug?: string;
  withAnnee: boolean;
  exclude: string[];
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (name: string): string | undefined => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : undefined;
  };
  const dir = (get("dir") ?? join(homedir(), "ecolpro-recovery")).replace(/^~/, homedir());
  return {
    dir,
    apply: argv.includes("--apply"),
    out: get("out"),
    freeSlug: get("free-slug"),
    withAnnee: argv.includes("--with-annee"),
    exclude: (get("exclude") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  };
}

/** Échappe une valeur au format COPY PostgreSQL en littéral SQL. */
function copyValueToSql(raw: string): string {
  if (raw === "\\N") return "NULL";
  if (raw === "t") return "TRUE";
  if (raw === "f") return "FALSE";
  const MARK = "\u0000BS\u0000";
  const unescaped = raw
    .replace(/\\\\/g, MARK)
    .replace(/\\t/g, "\t")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(new RegExp(MARK, "g"), "\\");
  return `'${unescaped.replace(/'/g, "''")}'`;
}

/** Découpe la liste de colonnes d'un en-tête COPY (identifiants entre guillemets). */
function parseColumnList(raw: string): string[] {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  for (const ch of raw) {
    if (ch === '"') {
      quoted = !quoted;
      continue;
    }
    if (ch === "," && !quoted) {
      out.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  out.push(current.trim());
  return out.filter(Boolean);
}

/** Lit <table>_data.sql et renvoie les lignes décodées (clé = nom de colonne). */
function readCopyRows(dir: string, table: string): Array<Record<string, string>> {
  const file = join(dir, `${table}_data.sql`);
  if (!existsSync(file)) {
    console.warn(`  ⚠ ${table}_data.sql introuvable — ignoré`);
    return [];
  }
  const lines = readFileSync(file, "utf8").split("\n");
  let inside = false;
  let cols: string[] = [];
  const rows: Array<Record<string, string>> = [];

  for (const line of lines) {
    // Capture schéma + nom de table : sans cela, `COPY auth.users` serait
    // confondu avec `COPY public.users` (les deux blocs cohabitent dans le dump).
    const header = line.match(/^COPY\s+((?:\w+)\.)?(\w+)\s*\((.+)\)\s+FROM stdin;$/);
    if (header) {
      const schema = header[1] ? header[1].slice(0, -1) : "public";
      const name = header[2];
      if (schema === "public" && name === table) {
        cols = parseColumnList(header[3]);
        inside = true;
      } else {
        inside = false;
      }
      continue;
    }
    if (!inside) continue;
    if (line === "\\.") {
      inside = false;
      break;
    }
    const parts = line.split("\t");
    const row: Record<string, string> = {};
    cols.forEach((c, i) => (row[c] = parts[i] ?? "\\N"));
    rows.push(row);
  }
  return rows;
}

/** Construit les INSERT (idempotents) pour une table. */
function buildInserts(
  table: string,
  rows: Array<Record<string, string>>,
  filter?: (r: Record<string, string>) => boolean,
): string[] {
  const cols = COLUMNS[table];
  const colList = cols.map((c) => `"${c}"`).join(", ");
  return rows
    .filter((r) => (filter ? filter(r) : true))
    .map(
      (r) =>
        `INSERT INTO "public"."${table}" (${colList}) VALUES (` +
        cols.map((c) => copyValueToSql(r[c] ?? "\\N")).join(", ") +
        `) ON CONFLICT DO NOTHING;`,
    );
}

function isTestAccount(email: string, extra: string[]): boolean {
  const e = (email ?? "").trim();
  if (extra.some((x) => x.toLowerCase() === e.toLowerCase())) return true;
  return TEST_EMAIL_PATTERNS.some((p) => p.test(e));
}

async function main() {
  const args = parseArgs();
  console.log("=== Restauration ciblée des utilisateurs — École Miriam ===");
  console.log(`Source : ${args.dir}`);
  console.log(`Mode   : ${args.apply ? "APPLICATION EN BASE" : "génération SQL (lecture seule)"}`);
  console.log(`Année  : ${args.withAnnee ? "incluse" : "exclue"}\n`);

  const statements: string[] = [];
  const notes: string[] = [];

  // ---------- 1. Sélection des données --------------------------------
  const allUsers = readCopyRows(args.dir, "users");
  const realUsers = allUsers.filter((u) => !isTestAccount(u.email, args.exclude));
  const excluded = allUsers.length - realUsers.length;

  const tenantIds = new Set(realUsers.map((u) => u.tenantId).filter((t) => t && t !== "\\N"));
  const tenants = readCopyRows(args.dir, "tenants").filter((t) => tenantIds.has(t.id));
  const sites = readCopyRows(args.dir, "sites").filter((s) => tenantIds.has(s.tenantId));
  const tenantRows = readCopyRows(args.dir, "user_tenants").filter((r) =>
    realUsers.some((u) => u.id === r.userId),
  );
  const siteRows = readCopyRows(args.dir, "user_sites").filter((r) =>
    realUsers.some((u) => u.id === r.userId),
  );
  const anneeRows = args.withAnnee
    ? readCopyRows(args.dir, "annees_scolaires").filter((r) => tenantIds.has(r.tenantId))
    : [];

  console.log(`Utilisateurs dans le dump  : ${allUsers.length}`);
  console.log(`  → réels retenus          : ${realUsers.length}`);
  console.log(`  → éléments de test exclus: ${excluded}`);
  console.log(`Tenants  : ${tenants.map((t) => `${t.name} (${t.slug})`).join(", ") || "aucun"}`);
  console.log(`Sites    : ${sites.map((s) => s.nom).join(", ") || "aucun"}`);
  console.log(`Adhésions user_tenants : ${tenantRows.length}`);
  console.log(`Rattachements user_sites : ${siteRows.length}\n`);

  if (realUsers.length === 0) throw new Error("Aucun utilisateur à restaurer — vérifiez --dir.");

  // ---------- 2. Conflit de slug ---------------------------------------
  for (const t of tenants) {
    const conflict = await prisma.tenant.findFirst({
      where: { slug: t.slug, NOT: { id: t.id } },
      select: { id: true, name: true, slug: true },
    });
    if (!conflict) continue;
    if (!args.freeSlug) {
      throw new Error(
        `Le slug « ${t.slug} » est déjà utilisé par « ${conflict.name} » (${conflict.id}).\n` +
          `Relancez avec --free-slug=<nouveau-slug-demo> pour le libérer (le tenant ` +
          `existant sera renommé, jamais supprimé automatiquement).`,
      );
    }
    statements.push(
      `UPDATE "public"."tenants" SET "slug" = ${copyValueToSql(args.freeSlug)}, ` +
        `"updatedAt" = now() WHERE "id" = ${copyValueToSql(conflict.id)};`,
    );
    notes.push(
      `Slug « ${t.slug} » libéré : ${conflict.id} renommé en « ${args.freeSlug} ».`,
    );
  }

  // ---------- 3. INSERT -------------------------------------------------
  statements.push(...buildInserts("tenants", tenants));
  statements.push(...buildInserts("sites", sites));
  statements.push(...buildInserts("users", realUsers));
  statements.push(...buildInserts("user_tenants", tenantRows));
  statements.push(...buildInserts("user_sites", siteRows));
  if (anneeRows.length) statements.push(...buildInserts("annees_scolaires", anneeRows));

  const outFile = args.out ?? join(args.dir, "users-restore.sql");
  writeFileSync(
    outFile,
    `-- Restauration ciblée des utilisateurs (École Miriam)\n` +
      `-- Généré par scripts/restore-users-from-backup.ts\n` +
      `-- Utilisateurs réels : ${realUsers.length} — exclusions test : ${excluded}\n` +
      `-- ${statements.length} instructions\n\n` +
      statements.join("\n") +
      "\n",
  );
  console.log(`SQL généré : ${outFile} (${statements.length} instructions)`);
  for (const n of notes) console.log(`  • ${n}`);

  if (!args.apply) {
    console.log("\n(lecture seule — relancez avec --apply pour écrire en base)");
    return;
  }

  // ---------- 4. Application -------------------------------------------
  console.log("\nApplication en base…");
  await prisma.$transaction(
    async (tx) => {
      for (const stmt of statements) await tx.$executeRawUnsafe(stmt);
    },
    { timeout: 120_000 },
  );
  console.log("✓ Transaction validée.");

  // ---------- 5. Vérification ------------------------------------------
  const emails = realUsers.map((u) => u.email);
  const restored = await prisma.user.findMany({
    where: { email: { in: emails } },
    select: { email: true, name: true, role: true, isActive: true, tenantId: true },
  });
  console.log(`\n✓ Comptes restaurés présents : ${restored.length}/${realUsers.length}`);
  console.log(`✓ Total utilisateurs en base : ${await prisma.user.count()}`);
  for (const u of restored) {
    console.log(`   [${u.isActive ? "ACTIF" : "INACTIF"}] ${u.email} | ${u.name} | ${u.role}`);
  }
}

main()
  .catch((e) => {
    console.error("\nERREUR :", e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());


