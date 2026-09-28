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
 * Domaines légitimes : ceux du projet et les domaines réservés aux exemples
 * (RFC 2606 / .test). Un literal d'adresse e-mail en dehors de cette liste
 * désigne un compte réel — lequel n'a rien à faire dans du code versionné.
 */
const PROJECT_EMAIL_RE =
  /@(?:[a-z0-9-]+\.)*(?:ecolemiriam\.(?:com|app)|ecolpro\.(?:app|test|com)|example\.(?:com|org|net)|localhost|test)$/i;

const EMAIL_LITERAL_RE = /["'`]([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})["'`]/gi;

/**
 * Mot de passe littéral, y compris derrière un repli d'environnement :
 * `password: process.env.TEST_X ?? "MotDePasseReel!"` — c'est la forme exacte
 * qui masquait les identifiants de `tests/e2e/fixtures.ts` (un repli non vide
 * est aussi révélateur qu'un littéral nu).
 */
const PASSWORD_LITERAL_RE =
  /(?:password|passwd|motDePasse|mot_de_passe)\s*[:=]\s*(?:process\.env\.[A-Z0-9_]+\s*(?:\?\?|\|\|)\s*)?["'`]([^"'`\s]{6,})["'`]/gi;

/**
 * Mot de passe en clair haché dans le code : `bcrypt.hash("MotDePasseReel!", 12)`.
 * C'est le vecteur exact par lequel un mot de passe réel a été versionné dans
 * `scripts/create-comptable.ts` (même mot de passe qu'un compte de production).
 */
const BCRYPT_LITERAL_RE = /bcrypt\.hash(?:Sync)?\(\s*["'`]([^"'`\s]{6,})["'`]/g;

/**
 * Identifiants passés en arguments adjacents : `login(page, "a@b.com", "secret")`.
 * Couvre les comptes réels codés en dur dans un appel de connexion, où aucun
 * mot-clé `password:` n'apparaît.
 */
const CREDS_PAIR_RE =
  /["'`]([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})["'`]\s*,\s*["'`]([^"'`\s]{6,})["'`]/gi;

/**
 * Valeurs de mot de passe tolérées : placeholders, lecture d'environnement,
 * et mots de passe de test manifestement fictifs (démo, e2e, fixture…). Un
 * mot de passe réel ne contient presque jamais ces marqueurs, alors que les
 * suites de tests en sont remplies.
 */
const PASSWORD_ALLOWED_RE =
  /process\.env|(?:^|[^a-z])(?:test|demo|e2e|fake|dummy|example|sample|fixture|placeholder|password|mot_de_passe|changeme|xxxx)/i;

/**
 * Valeurs d'exemple à ignorer pour les motifs fournisseurs : les gabarits de
 * configuration contiennent des placeholders (« sk_test_xxxx… »).
 */
const PLACEHOLDER_RE =
  /xxxx|XXXX|CHANGEME|CHANGE_ME|MOT_DE_PASSE|PASSWORD|placeholder|<[^>]*>|\.\.\.|votre-|secret-tres-long/i;

/**
 * Fichiers exclus : contenus générés, gabarits, documentation et le script
 * courant. `tests/` N'EST PLUS exclu : c'est précisément là que des comptes
 * réels (e-mail + mot de passe) avaient été versionnés sans être détectés.
 */
const EXCLUDED = [
  /^pnpm-lock\.yaml$/,
  /^package-lock\.json$/,
  /^\.env\.example$/, // placeholders volontaires (sk_test_xxx, re_xxxx…)
  /\.md$/,
  /^src\/test\//,
  /^scripts\/ci\//,
  /\.(png|jpe?g|svg|ico|webp|pdf|woff2?)$/,
];

const files = execFileSync("git", ["ls-files"], { encoding: "utf8" })
  .split("\n")
  .filter(Boolean)
  .filter((f) => !EXCLUDED.some((re) => re.test(f)));

const findings = [];
/** Comptes suspects par fichier : la paire (e-mail + mot de passe) est le signal. */
const emailsByFile = new Map();
const passwordsByFile = new Map();

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

    // ── Comptes réels : adresse e-mail hors des domaines du projet ──────
    // Un test qui doit se connecter à un vrai compte lit `TEST_*` depuis
    // l'environnement : la ligne ne contient alors aucun literal d'e-mail.
    for (const m of line.matchAll(EMAIL_LITERAL_RE)) {
      const email = m[1];
      if (PROJECT_EMAIL_RE.test(email)) continue;
      if (!emailsByFile.has(file)) emailsByFile.set(file, { line: i + 1, email });
    }

    // ── Mot de passe littéral associé à un compte ───────────────────────
    for (const m of line.matchAll(PASSWORD_LITERAL_RE)) {
      const value = m[1];
      if (PASSWORD_ALLOWED_RE.test(value)) continue; // placeholder / Test*
      if (!passwordsByFile.has(file)) passwordsByFile.set(file, { line: i + 1, value });
    }

    // ── Identifiants en arguments adjacents (appel de connexion) ────────
    // Signal autonome : une adresse réelle ET un secret sur la même ligne.
    for (const m of line.matchAll(CREDS_PAIR_RE)) {
      const email = m[1];
      const value = m[2];
      if (PROJECT_EMAIL_RE.test(email) || PASSWORD_ALLOWED_RE.test(value)) continue;
      findings.push({
        file,
        line: i + 1,
        label: "identifiants réels en dur (e-mail + mot de passe)",
        excerpt: `${email} / ${value.slice(0, 2)}***`,
      });
    }

    // ── Mot de passe en clair haché dans le code ────────────────────────
    // `bcrypt.hash("MotDePasseReel!", 12)` : le littéral EST le mot de passe.
    for (const m of line.matchAll(BCRYPT_LITERAL_RE)) {
      const value = m[1];
      if (PASSWORD_ALLOWED_RE.test(value)) continue; // Demo* / Test* / process.env
      findings.push({
        file,
        line: i + 1,
        label: "mot de passe en dur (hachage bcrypt)",
        excerpt: `${value.slice(0, 2)}***`,
      });
    }
  });
}

// Le signal à haute confiance est la COMBINAISON, dans un même fichier, d'une
// adresse e-mail réelle et d'un mot de passe littéral : c'est exactement la
// forme d'un identifiant versionné (cas de tests/e2e/fixtures.ts et
// tests/e2e/rls-fix.spec.ts, passés inaperçus tant que `tests/` était exclu).
// Un e-mail isolé peut n'être qu'un contact affiché dans une page.
for (const [file, email] of emailsByFile) {
  const password = passwordsByFile.get(file);
  if (!password) continue;
  findings.push({
    file,
    line: email.line,
    label: "identifiants réels en dur (e-mail + mot de passe)",
    excerpt: email.email,
  });
  findings.push({
    file,
    line: password.line,
    label: "identifiants réels en dur (e-mail + mot de passe)",
    excerpt: `${password.value.slice(0, 2)}***`,
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
