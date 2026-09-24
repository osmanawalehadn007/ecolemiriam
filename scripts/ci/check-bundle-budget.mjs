#!/usr/bin/env node
/**
 * Plafond de poids du bundle client (JS + CSS servis au navigateur).
 * ============================================================
 * Le site est servi depuis un conteneur GCP derrière Cloudflare : chaque
 * kilo-octet de JavaScript est payé par l'élève sur une connexion mobile
 * 3G/4G. Ce contrôle échoue si le bundle dépasse le plafond, afin qu'une
 * dépendance lourde (graphiques, éditeur…) ne passe pas inaperçue.
 *
 * À exécuter APRÈS `next build`. Plafonds surchargeables :
 *   BUNDLE_BUDGET_KB   (défaut 6144)  — total .next/static
 *   CHUNK_BUDGET_KB    (défaut 1200)  — plus gros fichier JS autorisé
 *
 * Usage : node scripts/ci/check-bundle-budget.mjs
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const STATIC_DIR = ".next/static";
const STATIC_BUDGET_KB = Number(process.env.BUNDLE_BUDGET_KB ?? 6144);
const CHUNK_BUDGET_KB = Number(process.env.CHUNK_BUDGET_KB ?? 1200);

if (!existsSync(".next/BUILD_ID")) {
  console.error("❌ .next/BUILD_ID absent — lancer `pnpm build` avant ce contrôle.");
  process.exit(1);
}

/**
 * Parcours récursif : les fichiers trouvés sont AJOUTÉS au tableau partagé
 * `files` (et non renvoyés dans un nouveau tableau, ce qui perdrait le
 * résultat des appels récursifs).
 */
function walk(dir, files = []) {
  if (statSync(dir).isFile()) files.push(dir);
  else for (const entry of readdirSync(dir)) walk(join(dir, entry), files);
  return files;
}

const files = walk(STATIC_DIR)
  .filter((f) => /\.(js|css)$/.test(f))
  .map((f) => ({ path: f, kb: statSync(f).size / 1024 }))
  .sort((a, b) => b.kb - a.kb);

const totalKb = files.reduce((sum, f) => sum + f.kb, 0);
const buildId = readFileSync(".next/BUILD_ID", "utf8").trim();

console.log(`Bundle client — build ${buildId}`);
console.log(`   ${files.length} fichiers JS/CSS, ${(totalKb / 1024).toFixed(2)} Mo au total\n`);
console.log("   Plus gros fichiers :");
for (const f of files.slice(0, 5)) {
  console.log(`     ${f.kb.toFixed(1).padStart(8)} Ko  ${f.path.replace(`${STATIC_DIR}/`, "")}`);
}

const oversize = files.filter((f) => f.kb > CHUNK_BUDGET_KB);
const problems = [];

if (oversize.length) {
  problems.push(
    `${oversize.length} fichier(s) au-delà de ${CHUNK_BUDGET_KB} Ko : ` +
      oversize.map((f) => `${f.path} (${f.kb.toFixed(0)} Ko)`).join(", ")
  );
}
if (totalKb > STATIC_BUDGET_KB) {
  problems.push(
    `total ${(totalKb / 1024).toFixed(2)} Mo > plafond ${(STATIC_BUDGET_KB / 1024).toFixed(2)} Mo`
  );
}

if (problems.length) {
  console.error("\n❌ Plafond de bundle dépassé :");
  for (const p of problems) console.error(`   • ${p}`);
  console.error(
    "\n   → vérifier les imports (`next/dynamic`, import d'un sous-module plutôt\n" +
      "     que du barrel), ou relever le plafond en justifiant la hausse."
  );
  process.exit(1);
}

console.log(`\n✅ Bundle dans le plafond (${STATIC_BUDGET_KB / 1024} Mo, max ${CHUNK_BUDGET_KB} Ko/fichier).`);
