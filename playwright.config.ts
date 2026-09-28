import { defineConfig, devices } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * ============================================================
 * GARDE-FOU ANTI-PRODUCTION
 * ============================================================
 * La suite e2e ÉCRIT en base (élèves, absences, factures, isolation…). Le
 * 24/09/2026, elle visait la base de production et a contribué à la perte des
 * données de l'établissement. La CI utilise désormais une base PostgreSQL
 * jetable sur le runner — mais en local, `.env` peut pointer la production.
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
      "   • utiliser une base locale dédiée : DATABASE_URL=postgresql://…@localhost:5432/ecolemiriam_e2e",
      "   • ou forcer en connaissance de cause : E2E_ALLOW_REMOTE_DB=1 npm run test:e2e",
    ].join("\n"),
  );
}

// Si PLAYWRIGHT_BASE_URL est défini (ex: tests contre une app déjà déployée),
// on cible cette URL et on ne démarre AUCUN serveur local.
// Sinon on démarre un serveur sur le port 3001.
const externalBaseURL = process.env.PLAYWRIGHT_BASE_URL;
const baseURL = externalBaseURL ?? "http://localhost:3001";

// next dev : le serveur dev compile à la demande mais fonctionne avec
// output: standalone (next start ne le supporte pas). L'hydratation React
// peut prendre un instant après networkidle — le fixture attend que le
// handler onSubmit soit attaché avant de soumettre.
const webServerCommand = "AUTH_URL=http://localhost:3001 npm run dev -- --port 3001";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // En CI, une seule relance absorbe les aléas du serveur de dev (compilation à
  // la demande : une première visite peut dépasser le délai d'un test). En
  // local, on veut voir la flakiness telle quelle.
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: "html",
  timeout: 60000,
  use: {
    baseURL,
    trace: "on-first-retry",
    headless: true,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  ...(externalBaseURL
    ? {}
    : {
        webServer: {
          command: webServerCommand,
          url: baseURL,
          reuseExistingServer: !process.env.CI,
          // Le build de prod en CI prend plusieurs minutes : 60s était très
          // largement insuffisant.
          timeout: process.env.CI ? 600_000 : 180_000,
          stdout: "pipe" as const,
          stderr: "pipe" as const,
        },
      }),
});
