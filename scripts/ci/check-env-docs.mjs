#!/usr/bin/env node
/**
 * Vérifie que toute variable d'environnement lue par le code est documentée.
 * ============================================================
 * La production tourne dans un conteneur sur GCP : une variable manquante ne
 * se voit qu'au moment où la fonctionnalité est utilisée (paiement, e-mail,
 * WhatsApp, FCM…). Ce contrôle transforme cet oubli en échec de CI, en
 * comparant les `process.env.X` du code aux clés de `.env.example`.
 *
 * Les variables techniques (CI, runners, variables de bundler) sont ignorées.
 *
 * Usage : node scripts/ci/check-env-docs.mjs
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SCANNED_DIRS = ["src", "prisma", "scripts", "mobile", "mobile-app"];
const SCANNED_FILES = ["next.config.ts", "capacitor.config.ts", "playwright.config.ts", "vitest.config.ts"];
const ENV_EXAMPLE = ".env.example";

/** Variables fournies par la plateforme, la CI ou le bundler — hors périmètre. */
const IGNORED = new Set([
  "NODE_ENV",
  "CI",
  "PORT",
  "TZ",
  "PWD",
  "HOME",
  "ANALYZE",
  "NEXT_RUNTIME",
  "NEXT_PHASE",
  "E2E_BASE_URL",
  "E2E_TIMEOUT",
  "E2E_CHANNEL",
  "NEXT_PUBLIC_VERCEL_URL",
]);
const IGNORED_PREFIXES = ["E2E_", "npm_", "NODE_OPTIONS"];

/**
 * Parcours récursif : les fichiers trouvés sont AJOUTÉS au tableau partagé
 * `files` (et non renvoyés dans un nouveau tableau, ce qui perdrait le
 * résultat des appels récursifs).
 */
function walk(dir, files = []) {
  if (!existsSync(dir)) return files;
  if (statSync(dir).isFile()) {
    files.push(dir);
    return files;
  }
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".") || entry === "node_modules") continue;
    const child = join(dir, entry);
    if (statSync(child).isDirectory()) walk(child, files);
    else files.push(child);
  }
  return files;
}

const files = [
  ...SCANNED_DIRS.flatMap((d) => walk(d)),
  ...SCANNED_FILES.filter((f) => existsSync(f)),
].filter(
  (f) =>
    /\.(ts|tsx|mjs|js|jsx)$/.test(f) &&
    !/\.(test|spec)\./.test(f) &&
    // Les outils de CI documentent leurs propres réglages dans leur en-tête.
    !f.startsWith("scripts/ci/")
);

const used = new Map(); // variable -> premier fichier où elle est lue
const USAGE_RE = /process\.env(?:\.([A-Z0-9_]+)|\["([A-Z0-9_]+)"\]|\[\`([A-Z0-9_]+)\`\])/g;

for (const file of files) {
  const content = readFileSync(file, "utf8");
  for (const match of content.matchAll(USAGE_RE)) {
    const name = match[1] ?? match[2] ?? match[3];
    if (!name) continue;
    if (IGNORED.has(name)) continue;
    if (IGNORED_PREFIXES.some((p) => name.startsWith(p))) continue;
    if (/STRIPE$|^VERCEL_|^AWS_|^CF_/.test(name) && !name.includes("KEY") && !name.includes("SECRET")) continue;
    if (!used.has(name)) used.set(name, file);
  }
}

if (!existsSync(ENV_EXAMPLE)) {
  console.error(`❌ ${ENV_EXAMPLE} absent — impossible de vérifier la documentation des variables.`);
  process.exit(1);
}

const documented = new Set(
  readFileSync(ENV_EXAMPLE, "utf8")
    .split("\n")
    .map((line) => line.match(/^#?\s*([A-Z0-9_]+)=/)?.[1])
    .filter(Boolean)
);

const missing = [...used.entries()]
  .filter(([name]) => !documented.has(name))
  .sort(([a], [b]) => a.localeCompare(b));

if (missing.length) {
  console.error(`❌ ${missing.length} variable(s) non documentée(s) dans ${ENV_EXAMPLE} :\n`);
  for (const [name, file] of missing) console.error(`   • ${name}  (lue dans ${file})`);
  console.error(`\n   → les ajouter à ${ENV_EXAMPLE} et aux secrets du conteneur GCP.`);
  process.exit(1);
}

console.log(
  `✅ ${used.size} variable(s) d'environnement utilisée(s) sur ${files.length} fichier(s) analysé(s), toutes documentées dans ${ENV_EXAMPLE}.`
);
if (process.env.DEBUG_ENV_DOCS) {
  console.log([...used.keys()].sort().join(" "));
}
