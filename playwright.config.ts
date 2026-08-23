import { defineConfig, devices } from "@playwright/test";

// Si PLAYWRIGHT_BASE_URL est défini (ex: tests contre une app déjà déployée),
// on cible cette URL et on ne démarre AUCUN serveur local.
// Sinon on démarre un serveur sur le port 3001.
const externalBaseURL = process.env.PLAYWRIGHT_BASE_URL;
const baseURL = externalBaseURL ?? "http://localhost:3001";

// En CI : build de production + next start (déterministe, pas de compilation
// à la demande pendant les tests). En local : next dev pour l'itération rapide.
const webServerCommand = process.env.CI
  ? "npm run build && npm run start -- --port 3001"
  : "npm run dev -- --port 3001";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: "html",
  timeout: 30000,
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
