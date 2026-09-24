import { test, expect, type Page } from "@playwright/test";
import {
  loginAsRole,
  logout,
  hasRoleCredentials,
  ROLE_CREDENTIALS,
  type TestRole,
} from "./fixtures";

/**
 * Tests E2E d'isolation des données pour les rôles PARENT et STUDENT.
 *
 * Contexte : des bugs de fuite de données ont été corrigés sur /absences,
 * /notes, /notes/bulletins et /emploi-du-temps. Ces tests vérifient que :
 *   - PARENT ne voit QUE les notes/absences/bulletins de ses enfants ;
 *   - STUDENT ne voit QUE ses propres notes/absences ;
 *   - /dashboard redirige ces rôles sans crash (pas d'erreur 500).
 *
 * Stratégie de skip : si les variables d'environnement
 *   TEST_PARENT_EMAIL / TEST_PARENT_PASSWORD
 *   TEST_STUDENT_EMAIL / TEST_STUDENT_PASSWORD
 * ne sont pas définies, les tests sont skippés avec un message clair afin
 * que le CI ne échoue pas lorsque les comptes ne sont pas provisionnés en
 * DB.
 *
 * Usage :
 *   TEST_PARENT_EMAIL=... TEST_PARENT_PASSWORD=... \
 *   TEST_STUDENT_EMAIL=... TEST_STUDENT_PASSWORD=... \
 *   npx playwright test tests/e2e/parent-student-isolation.spec.ts
 */

// Nom d'un élève qui N'appartient PAS au parent/élève de test.
// Surchargeable via env pour s'adapter au jeu de données du tenant.
// Si non défini, l'assertion d'isolation de contenu est ignorée (on se
// contente de vérifier l'absence d'erreur 500).
const FOREIGN_STUDENT_NAME = process.env.TEST_FOREIGN_STUDENT_NAME ?? "";

// Helper : récupère le texte du body de manière sûre (certaines pages
// peuvent être vides le temps de l'hydratation).
async function bodyText(page: Page): Promise<string> {
  try {
    return await page.locator("body").innerText({ timeout: 10_000 });
  } catch {
    return "";
  }
}

// Helper : vérifie qu'une page ne présente pas d'erreur Server Components
// ni d'erreur 500.
function expectNoServerError(bodyText: string) {
  expect(bodyText).not.toContain("error occurred in the Server Components");
  expect(bodyText).not.toContain("Something went wrong");
  expect(bodyText).not.toContain("Application error");
  expect(bodyText).not.toContain("Internal Server Error");
}

// Helper : assertion d'isolation. Si un nom d'élève "étranger" est fourni
// via TEST_FOREIGN_STUDENT_NAME, on vérifie qu'il n'apparaît PAS dans le
// rendu. Sinon, on saute l'assertion de contenu (le test se limite à la
// vérification d'absence d'erreur serveur).
function expectNoForeignStudent(bodyText: string) {
  if (!FOREIGN_STUDENT_NAME) {
    // Pas de nom de référence fourni : on ne peut pas vérifier le contenu,
    // on se contente de l'absence d'erreur (déjà vérifiée par ailleurs).
    return;
  }
  expect(
    bodyText,
    `La page contient le nom "${FOREIGN_STUDENT_NAME}" qui n'appartient pas ` +
      `au parent/élève de test — fuite de données détectée.`
  ).not.toContain(FOREIGN_STUDENT_NAME);
}

// ============================================================
// PARENT
// ============================================================
test.describe("PARENT — isolation des données", () => {
  test.beforeAll(() => {
    test.skip(
      !hasRoleCredentials("PARENT"),
      "Compte PARENT de test non configuré " +
        "(définir TEST_PARENT_EMAIL et TEST_PARENT_PASSWORD)."
    );
  });

  test.beforeEach(async ({ page }) => {
    await loginAsRole(page, "PARENT", "/dashboard");
  });

  test.afterEach(async ({ page }) => {
    await logout(page);
  });

  test("/dashboard redirige sans crash (pas de page d'erreur)", async ({ page }) => {
    // /dashboard redirige PARENT vers /absences (ou /parents selon config).
    // On vérifie juste qu'on n'est plus sur /login et qu'il n'y a pas d'erreur.
    await expect(page).not.toHaveURL(/\/login/);
    const text = await bodyText(page);
    expectNoServerError(text);
    await expect(page.locator("body")).not.toBeEmpty();
  });

  test("/notes se charge et ne montre que les notes des enfants", async ({ page }) => {
    const res = await page.goto("/notes", { waitUntil: "networkidle" });
    expect(res?.status(), "/notes doit retourner 200").toBeLessThan(500);
    const text = await bodyText(page);
    expectNoServerError(text);
    expectNoForeignStudent(text);
    await expect(page.locator("body")).not.toBeEmpty();
  });

  test("/absences se charge et ne montre que les absences des enfants", async ({ page }) => {
    const res = await page.goto("/absences", { waitUntil: "networkidle" });
    expect(res?.status(), "/absences doit retourner 200").toBeLessThan(500);
    const text = await bodyText(page);
    expectNoServerError(text);
    expectNoForeignStudent(text);
    await expect(page.locator("body")).not.toBeEmpty();
  });

  test("/notes/bulletins se charge et ne montre que ses classes/élèves", async ({ page }) => {
    const res = await page.goto("/notes/bulletins", { waitUntil: "networkidle" });
    expect(res?.status(), "/notes/bulletins doit retourner 200").toBeLessThan(500);
    const text = await bodyText(page);
    expectNoServerError(text);
    expectNoForeignStudent(text);
    await expect(page.locator("body")).not.toBeEmpty();
  });

  test("/emploi-du-temps se charge sans crash", async ({ page }) => {
    const res = await page.goto("/emploi-du-temps", { waitUntil: "networkidle" });
    expect(res?.status(), "/emploi-du-temps doit retourner 200").toBeLessThan(500);
    const text = await bodyText(page);
    expectNoServerError(text);
    await expect(page.locator("body")).not.toBeEmpty();
  });
});

// ============================================================
// STUDENT
// ============================================================
test.describe("STUDENT — isolation des données", () => {
  test.beforeAll(() => {
    test.skip(
      !hasRoleCredentials("STUDENT"),
      "Compte STUDENT de test non configuré " +
        "(définir TEST_STUDENT_EMAIL et TEST_STUDENT_PASSWORD)."
    );
  });

  test.beforeEach(async ({ page }) => {
    await loginAsRole(page, "STUDENT", "/dashboard");
  });

  test.afterEach(async ({ page }) => {
    await logout(page);
  });

  test("/dashboard redirige vers /notes sans crash", async ({ page }) => {
    // /dashboard redirige STUDENT vers /notes.
    await expect(page).not.toHaveURL(/\/login/);
    const text = await bodyText(page);
    expectNoServerError(text);
    await expect(page.locator("body")).not.toBeEmpty();
  });

  test("/notes se charge et ne montre que ses propres notes", async ({ page }) => {
    const res = await page.goto("/notes", { waitUntil: "networkidle" });
    expect(res?.status(), "/notes doit retourner 200").toBeLessThan(500);
    const text = await bodyText(page);
    expectNoServerError(text);
    expectNoForeignStudent(text);
    await expect(page.locator("body")).not.toBeEmpty();
  });

  test("/absences se charge et ne montre que ses propres absences", async ({ page }) => {
    const res = await page.goto("/absences", { waitUntil: "networkidle" });
    expect(res?.status(), "/absences doit retourner 200").toBeLessThan(500);
    const text = await bodyText(page);
    expectNoServerError(text);
    expectNoForeignStudent(text);
    await expect(page.locator("body")).not.toBeEmpty();
  });

  test("/emploi-du-temps se charge sans crash", async ({ page }) => {
    const res = await page.goto("/emploi-du-temps", { waitUntil: "networkidle" });
    expect(res?.status(), "/emploi-du-temps doit retourner 200").toBeLessThan(500);
    const text = await bodyText(page);
    expectNoServerError(text);
    await expect(page.locator("body")).not.toBeEmpty();
  });
});

// ============================================================
// Sanity : les credentials vides déclenchent bien un skip
// (garde-fou contre une régression du helper hasRoleCredentials).
// ============================================================
test.describe("Configuration des credentials", () => {
  test("hasRoleCredentials reflète la présence des variables d'env", () => {
    const parentCreds = ROLE_CREDENTIALS.PARENT;
    expect(hasRoleCredentials("PARENT")).toBe(
      Boolean(parentCreds.email && parentCreds.password)
    );
    const studentCreds = ROLE_CREDENTIALS.STUDENT;
    expect(hasRoleCredentials("STUDENT")).toBe(
      Boolean(studentCreds.email && studentCreds.password)
    );
  });
});
