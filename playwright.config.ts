import { defineConfig, devices } from "@playwright/test";

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

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: "html",
  // 30 s suffisent en CI (build chaud) ; en développement à froid, la première
  // compilation d'une route peut dépasser 15 s : `E2E_TIMEOUT=120000` absorbe
  // cette latence sans masquer un vrai blocage.
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
    command: "npm run dev",
    url: baseURL,
    reuseExistingServer: true,
    timeout: 60000,
  },
});
