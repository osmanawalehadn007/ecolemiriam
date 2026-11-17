#!/usr/bin/env node
/**
 * Audit de sécurité des dépendances — bloque sur toute vulnérabilité de
 * niveau high ou critical, sauf les avis listés dans EXCEPTIONS.
 *
 * `npm audit --audit-level=high` ne sait pas ignorer un avis précis : un avis
 * sans correctif disponible bloque alors tous les déploiements. Une exception
 * est nominative (identifiant GHSA), motivée, et doit être retirée dès qu'un
 * correctif existe. Tout autre avis high/critical continue de faire échouer.
 */
import { spawnSync } from "node:child_process";

const EXCEPTIONS = {
  // picomatch ≤ 4.0.7 (toutes branches, dont 2.x) : ReDoS par extglobs répétés.
  // Tiré par vite, vitest, tinyglobby, @parcel/watcher et tailwindcss 3 — tous
  // outils de développement et de build, jamais exposés à une saisie utilisateur.
  // npm ne propose aucune version corrigée (la seule piste est un retour à
  // vitest 3.1.4). Ajoutée le 2026-11-17 — à retirer dès qu'un picomatch
  // corrigé est publié et adopté par vite/vitest/tailwindcss.
  "GHSA-fc5q-39xc-vjpf": "picomatch — aucun correctif publié, outils de build/dev uniquement",
};

const BLOQUANTS = new Set(["high", "critical"]);

const { stdout, error } = spawnSync("npm", ["audit", "--json"], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});
if (error) {
  console.error("❌ npm audit n'a pas pu s'exécuter :", error.message);
  process.exit(1);
}

let rapport;
try {
  rapport = JSON.parse(stdout);
} catch {
  console.error("❌ Sortie de npm audit illisible :\n" + stdout.slice(0, 2000));
  process.exit(1);
}
if (rapport.error || !rapport.vulnerabilities) {
  console.error("❌ npm audit a échoué :", JSON.stringify(rapport.error ?? rapport).slice(0, 2000));
  process.exit(1);
}

// Chaque vulnérabilité remonte à un ou plusieurs avis (objets dans `via`) ;
// les entrées textuelles de `via` ne font que renvoyer vers un autre paquet.
const avis = new Map();
for (const [paquet, v] of Object.entries(rapport.vulnerabilities)) {
  for (const source of v.via) {
    if (typeof source !== "object" || !BLOQUANTS.has(source.severity)) continue;
    const id = source.url?.split("/").pop() ?? String(source.source);
    avis.set(id, { paquet, severite: source.severity, titre: source.title, url: source.url });
  }
}

const refuses = [];
for (const [id, a] of avis) {
  if (EXCEPTIONS[id]) console.log(`⚠️  ${id} (${a.paquet}, ${a.severite}) ignoré : ${EXCEPTIONS[id]}`);
  else refuses.push([id, a]);
}
for (const id of Object.keys(EXCEPTIONS)) {
  if (!avis.has(id)) console.log(`ℹ️  L'exception ${id} n'est plus signalée : la retirer de EXCEPTIONS.`);
}

if (refuses.length > 0) {
  console.error(`❌ ${refuses.length} vulnérabilité(s) high/critical :`);
  for (const [id, a] of refuses) console.error(`   - ${id} — ${a.paquet} (${a.severite}) : ${a.titre}\n     ${a.url}`);
  process.exit(1);
}
console.log("✅ Aucune vulnérabilité high/critical hors exceptions.");
