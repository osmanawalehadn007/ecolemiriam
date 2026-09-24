#!/usr/bin/env node
/**
 * Détection de secrets en dur dans les fichiers versionnés.
 * ============================================================
 * Remplace les contrôles qui étaient auparavant délégués au fournisseur
 * d'hébergement (scan des variables d'environnement Vercel/Netlify) par un
 * contrôle qui tourne dans la CI, sur la cible Cloudflare/GCP.
 *
 * Ne signale que des motifs à haute confiance (préfixes de fournisseurs,
 * clés privées, chaînes à forte entropie) pour éviter les faux positifs liés
 * aux placeholders de `.env.example` (« sk_test_xxxx… »).
 *
 * Usage : node scripts/ci/scan-secrets.mjs
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** Motifs à haute confiance : préfixe fournisseur + longueur réaliste. */
const PATTERNS = [
  { label: "clé privée PEM", re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { label: "Stripe live", re: /\bsk_live_[0-9a-zA-Z]{16,}/ },
  { label: "Stripe webhook", re: /\bwhsec_[0-9a-zA-Z]{24,}/ },
  { label: "Resend", re: /\bre_[0-9a-zA-Z]{24,}/ },
  { label: "AWS access key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: "GitHub token", re: /\bgh[pousr]_[0-9a-zA-Z]{36,}\b/ },
  { label: "Slack token", re: /\bxox[abpsr]-[0-9a-zA-Z-]{20,}/ },
  { label: "OpenAI/OpenRouter", re: /\bsk-(?:or-)?[0-9a-zA-Z]{32,}\b/ },
  { label: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { label: "Telegram bot token", re: /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/ },
  { label: "JWT signé", re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}/ },
  {
    label: "URL PostgreSQL avec mot de passe",
    re: /postgres(?:ql)?:\/\/[^\s:@/]+:[^\s:@/$]{8,}@(?!localhost|127\.0\.0\.1|host|db|postgres:)/,
  },
];

/**
 * Valeurs d'exemple à ignorer : les gabarits de configuration contiennent des
 * placeholders (« MOT_DE_PASSE », « xxxxx », « <valeur> »). Seul un secret
 * réellement exploitable doit être signalé.
 */
const PLACEHOLDER_RE =
  /xxxx|XXXX|CHANGEME|CHANGE_ME|MOT_DE_PASSE|PASSWORD|placeholder|<[^>]*>|\.\.\.|votre-|secret-tres-long/i;

/** Fichiers exclus : contenus générés ou de test, jamais des secrets réels. */
const EXCLUDED = [
  /^pnpm-lock\.yaml$/,
  /^\.env\.example$/, // placeholders volontaires (sk_test_xxx, re_xxxx…)
  /\.md$/,
  /^src\/test\//,
  /^tests\//,
  /^scripts\/ci\//,
  /\.(png|jpe?g|svg|ico|webp|pdf|woff2?)$/,
];

const files = execFileSync("git", ["ls-files"], { encoding: "utf8" })
  .split("\n")
  .filter(Boolean)
  .filter((f) => !EXCLUDED.some((re) => re.test(f)));

const findings = [];
for (const file of files) {
  let content;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    continue; // fichier binaire illisible en UTF-8
  }
  content.split("\n").forEach((line, i) => {
    for (const { label, re } of PATTERNS) {
      const match = line.match(re);
      if (!match) continue;
      if (PLACEHOLDER_RE.test(match[0])) continue; // valeur d'exemple
      findings.push({ file, line: i + 1, label, excerpt: match[0].slice(0, 40) });
    }
  });
}

if (findings.length) {
  console.error(`❌ ${findings.length} secret(s) potentiel(s) en dur :\n`);
  for (const f of findings) console.error(`   • ${f.file}:${f.line} — ${f.label}`);
  console.error(
    "\n   → retirer la valeur du code, la placer dans les variables d'environnement\n" +
      "     du conteneur GCP (et la révoquer si elle a été exposée)."
  );
  process.exit(1);
}

console.log(`✅ Aucun secret en dur détecté (${files.length} fichiers versionnés analysés).`);
