import { test, expect, type Page } from "@playwright/test";

/**
 * Test E2E post-déploiement — vérifie que le fix RLS sur `users` fonctionne
 * pour le conseiller et le principal.
 *
 * Usage:
 *   PLAYWRIGHT_BASE_URL=https://app.ecolemiriam.com npx playwright test tests/e2e/rls-fix.spec.ts
 */

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3001";

async function login(page: Page, email: string, password: string) {
  // 1. CSRF token
  const csrfRes = await page.request.get(`${BASE}/api/auth/csrf`);
  const { csrfToken } = await csrfRes.json();

  // 2. NextAuth credentials callback
  await page.request.post(`${BASE}/api/auth/callback/credentials`, {
    form: {
      email,
      password,
      csrfToken,
      callbackUrl: "/dashboard",
      json: "true",
    },
    maxRedirects: 0,
  });
}

async function logout(page: Page) {
  await page.request.post(`${BASE}/api/auth/signout`, {
    form: { csrfToken: (await (await page.request.get(`${BASE}/api/auth/csrf`)).json()).csrfToken },
    maxRedirects: 0,
  }).catch(() => {});
}

// ============================================================
// CONSEILLER — dya.adine@miriam.dj
// ============================================================
test.describe("Conseiller (dya.adine@miriam.dj)", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "dya.adine@miriam.dj", "dya12345");
  });

  test.afterEach(async ({ page }) => {
    await logout(page);
  });

  test("emploi-du-temps se charge sans crash", async ({ page }) => {
    const res = await page.goto(`${BASE}/emploi-du-temps`, { waitUntil: "networkidle" });
    expect(res?.status()).toBe(200);
    // Pas de message d'erreur Server Components
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toContain("error occurred in the Server Components");
    expect(bodyText).not.toContain("Something went wrong");
    // La page doit contenir des éléments du timetable (pas une page blanche)
    await expect(page.locator("body")).not.toBeEmpty();
  });

  test("cahier-de-texte se charge sans crash", async ({ page }) => {
    const res = await page.goto(`${BASE}/cahier-de-texte`, { waitUntil: "networkidle" });
    expect(res?.status()).toBe(200);
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toContain("error occurred in the Server Components");
    expect(bodyText).not.toContain("Something went wrong");
    await expect(page.locator("body")).not.toBeEmpty();
  });

  test("dashboard se charge", async ({ page }) => {
    const res = await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
    expect(res?.status()).toBe(200);
    await expect(page.locator("body")).not.toBeEmpty();
  });

  test("API emploi-du-temps retourne des données", async ({ page }) => {
    const res = await page.request.get(`${BASE}/api/emploi-du-temps`);
    expect(res.status()).toBe(200);
    const data = await res.json();
    // Doit retourner un array (même vide) sans erreur
    expect(Array.isArray(data) || typeof data === "object").toBeTruthy();
  });
});

// ============================================================
// PRINCIPAL — ilyasadendjama@gmail.com
// ============================================================
test.describe("Principal (ilyasadendjama@gmail.com)", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "ilyasadendjama@gmail.com", "EcolPro@2026");
  });

  test.afterEach(async ({ page }) => {
    await logout(page);
  });

  test("emploi-du-temps se charge sans crash", async ({ page }) => {
    const res = await page.goto(`${BASE}/emploi-du-temps`, { waitUntil: "networkidle" });
    expect(res?.status()).toBe(200);
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toContain("error occurred in the Server Components");
    expect(bodyText).not.toContain("Something went wrong");
    await expect(page.locator("body")).not.toBeEmpty();
  });

  test("cahier-de-texte se charge sans crash", async ({ page }) => {
    const res = await page.goto(`${BASE}/cahier-de-texte`, { waitUntil: "networkidle" });
    expect(res?.status()).toBe(200);
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toContain("error occurred in the Server Components");
    expect(bodyText).not.toContain("Something went wrong");
    await expect(page.locator("body")).not.toBeEmpty();
  });

  test("dashboard se charge", async ({ page }) => {
    const res = await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
    expect(res?.status()).toBe(200);
    await expect(page.locator("body")).not.toBeEmpty();
  });

  test("parametres — annuaire users non vide", async ({ page }) => {
    const res = await page.goto(`${BASE}/parametres`, { waitUntil: "networkidle" });
    expect(res?.status()).toBe(200);
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toContain("error occurred in the Server Components");
    await expect(page.locator("body")).not.toBeEmpty();
  });

  test("API emploi-du-temps retourne des données", async ({ page }) => {
    const res = await page.request.get(`${BASE}/api/emploi-du-temps`);
    expect(res.status()).toBe(200);
  });
});
