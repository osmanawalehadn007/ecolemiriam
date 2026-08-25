import { test as base, expect, type Page } from "@playwright/test";

// Shared auth fixture — logs in via l'API NextAuth directement (contourne
// le problème d'hydratation React du serveur dev où le formulaire se soumet
// en HTML GET avant que onSubmit ne soit attaché).
async function login(page: Page) {
  // 1. Récupérer le CSRF token.
  //    En dev, la première requête peut tomber sur une route en cours de
  //    compilation et retourner du HTML au lieu de JSON. On retry jusqu'à 3x.
  let csrfToken: string | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    const csrfRes = await page.request.get("/api/auth/csrf");
    const contentType = csrfRes.headers()["content-type"] ?? "";
    if (contentType.includes("application/json")) {
      const body = await csrfRes.json();
      csrfToken = body.csrfToken;
      break;
    }
    // Pas du JSON → attendre et réessayer (le serveur dev compile)
    await page.waitForTimeout(2000);
  }
  if (!csrfToken) throw new Error("Impossible d'obtenir le CSRF token après 3 tentatives");

  // 2. Soumettre les credentials via l'API NextAuth
  await page.request.post("/api/auth/callback/credentials", {
    form: {
      email: "admin@lycee-djibouti.ecolemiriam.app",
      password: "Demo@2026!",
      csrfToken,
      callbackUrl: "/dashboard",
      json: "true",
    },
    maxRedirects: 0,
  });

  // 3. Les cookies de session sont automatiquement stockés dans le
  //    BrowserContext par page.request. Naviguer vers /dashboard pour
  //    vérifier que la session est active.
  await page.goto("/dashboard");
  await page.waitForURL("**/dashboard", { timeout: 60_000 });
}

export const test = base.extend<{ authedPage: Page }>({
  authedPage: async ({ page }, use) => {
    await login(page);
    await use(page);
  },
});

export { expect };
