/**
 * Résolution automatique des conflits de merge par UNION de blocs.
 * ============================================================
 * Pour chaque bloc `<<<<<<< HEAD / ======= / >>>>>>> origin/main` :
 *   - les lignes du côté distant (origin/main) sont conservées ;
 *   - les lignes HEAD absentes du distant sont ajoutées à la fin du bloc ;
 *   - les doublons exacts sont retirés (unions d'imports, de revalidations…).
 *
 * Réservé aux fichiers « mécaniques » : les fichiers structurants
 * (package.json, ci.yml, prisma/*, playwright.config.ts, eslint-rules/*,
 * next.config.ts) sont résolus à la main.
 *
 * Usage : node scripts/resolve-merge.mjs [fichier…]
 *        sans argument : tous les fichiers en conflit (UU) sauf la liste
 *        d'exclusion ci-dessous.
 */
import { execFileSync } from "node:child_process";

const EXCLUSIONS = new Set([
  "package.json",
  ".github/workflows/ci.yml",
  "playwright.config.ts",
  "prisma/schema.prisma",
  "prisma/seed.ts",
  "next.config.ts",
  ".gitignore",
]);

function conflictedFiles() {
  const out = execFileSync("git", ["status", "--short"], { encoding: "utf8" });
  return out
    .split("\n")
    .filter((l) => l.startsWith("UU "))
    .map((l) => l.slice(3).trim())
    .filter((f) => !EXCLUSIONS.has(f));
}

function resolveUnion(content) {
  const lines = content.split("\n");
  const out = [];
  let i = 0;
  let blocks = 0;
  while (i < lines.length) {
    if (!lines[i].startsWith("<<<<<<<")) {
      out.push(lines[i++]);
      continue;
    }
    blocks++;
    i++; // sauter <<<<<<< HEAD
    const head = [];
    const remote = [];
    let side = head;
    while (i < lines.length && !lines[i].startsWith(">>>>>>>")) {
      if (lines[i].startsWith("=======")) {
        side = remote;
      } else {
        side.push(lines[i]);
      }
      i++;
    }
    i++; // sauter >>>>>>> origin/main
    // Union : distant d'abord, puis lignes HEAD absentes du distant.
    const remoteSet = new Set(remote.map((l) => l.trim()));
    out.push(...remote);
    for (const l of head) {
      if (!remoteSet.has(l.trim())) out.push(l);
    }
  }
  return { content: out.join("\n"), blocks };
}

const files = process.argv.length > 2 ? process.argv.slice(2) : conflictedFiles();
let totalBlocks = 0;
for (const f of files) {
  const fs = await import("node:fs");
  const content = fs.readFileSync(f, "utf8");
  const { content: resolved, blocks } = resolveUnion(content);
  fs.writeFileSync(f, resolved);
  execFileSync("git", ["add", f]);
  totalBlocks += blocks;
  console.log(`${blocks} bloc(s) fusionné(s) — ${f}`);
}
console.log(`\nTOTAL : ${files.length} fichier(s), ${totalBlocks} bloc(s).`);