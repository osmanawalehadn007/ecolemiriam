#!/usr/bin/env node
/**
 * Garde-fou : la cible de déploiement est Cloudflare (ecolemirlam.com → GCP).
 * ============================================================
 * Le projet a été déployé successivement sur Netlify puis Vercel ; les deux
 * sont abandonnés. Réintroduire un de leurs fichiers de configuration suffit
 * à déclencher des déploiements fantômes (Vercel active son intégration Git
 * dès qu'un `vercel.json` réapparaît) : ce contrôle échoue dans ce cas.
 *
 * Vérifie :
 *   1. aucun artefact Vercel/Netlify dans l'arbre de travail ;
 *   2. aucune référence à ces hébergeurs dans les fichiers qui pilotent le
 *      build ou la CI (les lignes de commentaire sont ignorées) ;
 *   3. le domaine de production est déclaré dans les origines autorisées de
 *      `next.config.ts` (sinon les Server Actions sont rejetées en prod).
 *
 * Usage : node scripts/ci/check-deploy-target.mjs
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const PROD_DOMAIN = "ecolemirlam.com";

/** Lignes de commentaire : peuvent nommer les hébergeurs abandonnés. */
const COMMENT_RE = /^\s*(\/\/|\/\*|\*|#|<!--)/;

/** Fichiers/dossiers d'hébergeurs abandonnés : leur seule présence est un bug. */
const FORBIDDEN_PATHS = ["vercel.json", "netlify.toml", ".vercelignore", ".vercel", ".netlify"];

/** Fichiers qui pilotent le build, la CI ou la coque mobile. */
const SCANNED_PATHS = [".github/workflows", "next.config.ts", "package.json", "capacitor.config.ts"];

const FORBIDDEN_HOSTS = [
  { label: "Vercel", re: /vercel/i },
  { label: "Netlify", re: /netlify/i },
];

const problems = [];

for (const path of FORBIDDEN_PATHS) {
  if (existsSync(path)) {
    problems.push(`artefact ${path} présent — la cible de déploiement doit rester Cloudflare/GCP`);
  }
}

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
    if (entry === "node_modules" || entry === ".git") continue;
    const child = join(dir, entry);
    if (statSync(child).isDirectory()) walk(child, files);
    else files.push(child);
  }
  return files;
}

for (const path of SCANNED_PATHS.flatMap((p) => walk(p))) {
  if (!/\.(json|jsonc|yml|yaml|ts|mjs|js|toml)$/.test(path)) continue;
  const lines = readFileSync(path, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (COMMENT_RE.test(line)) return;
    for (const { label, re } of FORBIDDEN_HOSTS) {
      if (re.test(line)) {
        problems.push(`${path}:${i + 1} référence ${label} — ${line.trim().slice(0, 120)}`);
      }
    }
  });
}

const nextConfig = readFileSync("next.config.ts", "utf8");
if (!nextConfig.includes(PROD_DOMAIN)) {
  problems.push(
    `next.config.ts ne déclare pas « ${PROD_DOMAIN} » : les Server Actions seraient ` +
      `rejetées en production (erreur « Invalid Server Actions request »).`
  );
}

if (problems.length) {
  console.error("❌ Cible de déploiement invalide :\n");
  for (const p of problems) console.error(`   • ${p}`);
  console.error(
    `\n   Cible attendue : https://${PROD_DOMAIN} derrière Cloudflare (Tunnel → GCP).`
  );
  process.exit(1);
}

console.log(`✅ Cible de déploiement OK — Cloudflare / ${PROD_DOMAIN}, aucun artefact Vercel/Netlify.`);
