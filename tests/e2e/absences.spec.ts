import { test, expect } from "./fixtures";

/**
 * L'appel se choisit en deux niveaux : catégorie (structure pédagogique) puis
 * classe. Les libellés viennent de `fr.json` (namespace `absences`) et les
 * boutons portent un `data-testid` : les sélecteurs ne dépendent donc ni de la
 * copie de l'interface, ni du nom des classes en base.
 *
 * L'ancien test cliquait « le premier bouton dont le texte finit par un
 * chiffre » — aucune classe de `prisma/seed.ts` ne correspondait, et le titre
 * « Classes » n'existe plus (il est devenu « Catégories »).
 */
test.describe("Absences — Appel numérique", () => {
  test("accéder à la page d'appel", async ({ authedPage: page }) => {
    await page.goto("/absences/appel");
    await expect(page.locator("text=Faire l'appel").first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Catégories").first()).toBeVisible();
  });

  test("sélectionner une classe affiche les élèves", async ({ authedPage: page }) => {
    await page.goto("/absences/appel");
    await expect(page.locator("text=Faire l'appel").first()).toBeVisible({ timeout: 10000 });

    // Niveau 1 : catégorie ; niveau 2 : classe.
    await page.getByTestId("appel-categorie").first().click();
    await page.getByTestId("appel-classe").first().click();

    await expect(page.getByText("Tous présents")).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("button", { name: "Valider l'appel" })).toBeVisible();
    await expect(page.getByText(/\d+ élèves/).first()).toBeVisible();
  });

  test("marquer tous présents", async ({ authedPage: page }) => {
    await page.goto("/absences/appel");
    await expect(page.locator("text=Faire l'appel").first()).toBeVisible({ timeout: 10000 });
    await page.getByTestId("appel-categorie").first().click();
    await page.getByTestId("appel-classe").first().click();

    await page.getByText("Tous présents").click();

    // Tous les élèves sont marqués présents (`aria-pressed`), donc le bouton de
    // validation a de quoi être activé. On ne l'exige pas : il dépend aussi de
    // l'existence d'un créneau pour aujourd'hui, absent de la base de
    // démonstration (pas d'emploi du temps dans le seed).
    const pastilles = page.getByTestId("presence-present");
    const total = await pastilles.count();
    expect(total).toBeGreaterThan(0);
    await expect(pastilles.first()).toHaveAttribute("aria-pressed", "true");
    const actifs = await page.locator('[data-testid="presence-present"][aria-pressed="true"]').count();
    expect(actifs).toBe(total);
  });

  test("page liste des absences", async ({ authedPage: page }) => {
    await page.goto("/absences");
    await expect(page.locator("text=Absences").first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator("text=Faire l'appel")).toBeVisible();
  });
});
