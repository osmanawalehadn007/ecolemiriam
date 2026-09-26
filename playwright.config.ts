import { defineConfig, devices } from "@playwright/test";
import { existsSync, readFileSync } from "fs";

/**
 * ============================================================
 * GARDE-FOU ANTI-PRODUCTION
 * ============================================================
 * La suite e2e ÉCRIT en base (élèves, absences, factures, isolation…). Le
 * 24/09/2026, elle visait la base de production et a contribué à la perte des
 * données de l'établissement. Depuis, la CI utilise une base PostgreSQL jetable
 * sur le runner — mais en local, `.env` peut pointer la production.
 *
 * On refuse donc de démarrer si `DATABASE_URL` ne vise pas une base locale
 * (localhost / 127.0.0.1). Pour forcer malgré tout :
 *   E2E_ALLOW_REMOTE_DB=1 npm run test:e2e
 */
function resolvedDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const m = readFileSync(".env", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m);
    return m ? m[1] : "";
  } catch {
    return "";
  }
}

const dbUrl = resolvedDatabaseUrl();
const isLocalDb = /(localhost|127\.0\.0\.1|\[::1\])/i.test(dbUrl);

if (dbUrl && !isLocalDb && process.env.E2E_ALLOW_REMOTE_DB !== "1") {
  const hote = dbUrl.replace(/:[^:@/]+@/, ":***@").split("@")[1]?.split("/")[0] ?? "?";
  throw new Error(
    [
      "⛔ Suite e2e interrompue : DATABASE_URL pointe une base DISTANTE (production).",
      `   Hôte détecté : ${hote}`,
      "   Les tests e2e écrivent en base et ne doivent jamais viser la production.",
      "",
      "   Solutions :",
      "   • utiliser une base locale dédiée : DATABASE_URL=postgresql://…@localhost:5432/ecolpro_e2e",
      "   • ou forcer en connaissance de cause : E2E_ALLOW_REMOTE_DB=1 npm run test:e2e",
    ].join("\n"),
  );
}

/**
 * URL de base : surchargeable par `E2E_BASE_URL`.
 *
 * Le port 3001 par défaut est aussi utilisé par d'autres projets ouverts en
 * parallèle sur la machine (un serveur déjà en écoute serait « réutilisé » par
 * `reuseExistingServer` et la suite frapperait alors la mauvaise application —
 * écritures incluses). Le paramètre permet de viser explicitement l'instance
 * EcolPro à tester.
 */
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3001";

/**
 * Serveur de PRODUCTION si un build existe (démarrage instantané, tests
 * stables) ; sinon serveur de développement (compilation à la demande).
 * Les timeouts de la suite sont calibrés pour la prod : en dev, les
 * recompilations dépassent régulièrement 15 s et font échouer des tests sains.
 */
const hasBuild = existsSync(".next/BUILD_ID");
const webServerCommand = hasBuild ? "npm run start" : "npm run dev";
const webServerTimeout = hasBuild ? 30000 : 120000;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: "html",
  // 30 s suffisent sur un serveur de prod (build chaud) ; en développement à
  // froid, la première compilation d'une route peut dépasser 15 s :
  // `E2E_TIMEOUT=120000` absorbe cette latence sans masquer un vrai blocage.
  timeout: Number(process.env.E2E_TIMEOUT ?? 30000),
  use: {
    baseURL,
    trace: "on-first-retry",
    headless: true,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // `E2E_CHANNEL=chrome` rejoue la suite sur le Chrome installé sur la
        // machine, sans télécharger le binaire Playwright (utile en local quand
        // la révision attendue n'est pas encore dans le cache).
        ...(process.env.E2E_CHANNEL ? { channel: process.env.E2E_CHANNEL } : {}),
      },
    },
  ],
  webServer: {
    command: webServerCommand,
    url: baseURL,
    reuseExistingServer: true,
    timeout: webServerTimeout,
  },
});
