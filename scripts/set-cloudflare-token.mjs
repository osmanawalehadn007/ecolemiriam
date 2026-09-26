#!/usr/bin/env node
/**
 * Enregistre CLOUDFLARE_API_TOKEN dans `.env` sans jamais l'exposer.
 * ============================================================
 * Le jeton est lu en saisie masquée : il n'apparaît ni à l'écran, ni dans
 * l'historique du shell, ni dans un message. Il est validé (forme) AVANT
 * d'être écrit — un jeton tronqué ne peut donc pas se retrouver dans `.env`.
 *
 * `.env` est ensuite refermé en 600 (lecture par votre seul compte) : il
 * contient aussi DATABASE_URL, AUTH_SECRET, SUPABASE_SERVICE_ROLE_KEY…
 *
 * Le jeton n'est jamais journalisé : la sortie n'affiche que sa forme masquée
 * et sa longueur.
 *
 * Usage : npm run cf:token
 *         node scripts/set-cloudflare-token.mjs [chemin/.env]   (tests)
 * Puis  : npm run cf:verify
 */
import { readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";

const FILE = process.argv[2] ?? ".env";

/** Lit un secret en saisie masquée (TTY) ou depuis stdin (pipe, tests). */
async function readSecret(label) {
  if (!process.stdin.isTTY) {
    let data = "";
    for await (const chunk of process.stdin) data += chunk;
    return data.trim();
  }
  process.stdout.write(label);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve) => {
    let value = "";
    process.stdin.on("data", (chunk) => {
      for (const ch of chunk.toString("utf8")) {
        if (ch === "\r" || ch === "\n") {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdout.write("\n");
          return resolve(value);
        }
        if (ch === "\u0003") {
          // Ctrl-C : ne rien écrire, ne rien laisser derrière soi.
          process.stdout.write("\n");
          process.exit(130);
        }
        if (ch === "\u007f" || ch === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        value += ch;
      }
    });
  });
}

const raw = await readSecret("Coller le jeton Cloudflare puis Entrée (saisie masquée) : ");
/** Certains terminaux encadrent le collage de séquences ANSI : les retirer. */
const value = raw.replace(/\u001b\[[0-9;]*[A-Za-z~]/g, "").trim();

// --- Validation de forme AVANT toute écriture ------------------------------
if (!value) {
  console.error("❌ Aucune valeur reçue — rien n'a été écrit.");
  process.exit(1);
}
if (/^[0-9a-f]{32}$/i.test(value)) {
  console.error(
    "❌ C'est un Account ID (32 caractères hexadécimaux), pas un jeton API.\n" +
      "   Un jeton fait 40 caractères, ou commence par « cfut_ » (utilisateur)\n" +
      "   / « cfat_ » (compte).\n" +
      "   L'Account ID se place dans CLOUDFLARE_ACCOUNT_ID (déjà renseigné dans .env)."
  );
  process.exit(1);
}
if (!/^cf[a-z]{1,4}_[A-Za-z0-9_-]{20,}$/.test(value) && !/^[A-Za-z0-9_-]{40}$/.test(value)) {
  console.error(
    `❌ Forme inattendue (${value.length} caractères). Attendu : 40 caractères, ou un préfixe\n` +
      "   « cfut_ » (jeton utilisateur) / « cfat_ » (jeton de compte) suivi de 36+.\n" +
      "   Vérifier que la copie n'a pas été tronquée, et que la valeur ne contient pas d'espace."
  );
  process.exit(1);
}

// --- Écriture, dans .env uniquement ----------------------------------------
if (!existsSync(FILE)) {
  console.error(`❌ ${FILE} introuvable — lancer la commande depuis la racine du projet.`);
  process.exit(1);
}
const content = readFileSync(FILE, "utf8");
const line = `CLOUDFLARE_API_TOKEN=${value}`;
const next = /^CLOUDFLARE_API_TOKEN=.*$/m.test(content)
  ? content.replace(/^CLOUDFLARE_API_TOKEN=.*$/m, line) // remplace la ligne existante
  : `${content.replace(/\n*$/, "\n")}${line}\n`; // sinon, ajoute en fin de fichier
writeFileSync(FILE, next, { mode: 0o600 });
chmodSync(FILE, 0o600); // .env contient aussi DATABASE_URL et AUTH_SECRET

const masked = value.length <= 12 ? "•".repeat(value.length) : `${value.slice(0, 4)}…${value.slice(-4)}`;
console.log(`✅ CLOUDFLARE_API_TOKEN enregistré dans ${FILE} — ${masked} (${value.length} caractères)`);
console.log(`   Permissions de ${FILE} : 600 (lecture par votre seul compte)`);
console.log("   → Étape suivante : npm run cf:verify");
