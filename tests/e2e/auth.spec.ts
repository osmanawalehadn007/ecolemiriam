import { test, expect } from "./fixtures";

test.describe("Authentification", () => {
  test("login avec identifiants valides", async ({ page }) => {
    // Login via API (contourne le problème d'hydratation React du serveur dev)
    const csrfRes = await page.request.get("/api/auth/csrf");
    const { csrfToken } = await csrfRes.json();
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
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 60_000 });
    await expect(page.locator("text=Tableau de bord").first()).toBeVisible({ timeout: 10000 });
    await page.goto("/login");
    // Compte du tenant de démonstration créé par `prisma/seed.ts`
    // (l'ancien `lycee-djibouti` n'existe plus).
    await page.fill('input[type="email"]', "admin@lycee-demo.ecolemiriam.app");
    await page.fill('input[type="password"]', "Demo@2026!");
    await page.click('button[type="submit"]');
    // Un compte mono-tenant passe par /select-tenant puis /dashboard.
    await expect(page).toHaveURL(/\/(dashboard|select-tenant)/, { timeout: 15000 });
    await expect(page.locator("text=Tableau de bord").first()).toBeVisible({ timeout: 15000 });
  });

  test("login avec identifiants invalides", async ({ page }) => {
    await page.goto("/login");
    await page.fill('input[type="email"]', "wrong@test.com");
    await page.fill('input[type="password"]', "wrongpass");
    await page.click('button[type="submit"]');
    await expect(page).not.toHaveURL(/\/dashboard/);
  });

  test("redirection sans connexion", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });
});
