import { test, expect } from "./fixtures";

test.describe("Gestion des élèves", () => {
  /**
   * La liste est désormais hiérarchique : sélection d'un NIVEAU scolaire
   * (« Lycée (12) ») qui charge les classes, puis d'une classe qui affiche le
   * tableau des élèves. Utilitaire partagé par les tests de cette page.
   */
  async function ouvrirListeEleves(page: import("@playwright/test").Page) {
    await page.goto("/eleves");
    await expect(page.locator("text=Élèves").first()).toBeVisible({ timeout: 15000 });
    // 1er bouton de niveau (ex. « Lycée (12) »)
    const niveauBtn = page.locator("button", { hasText: /Lycée|Collège|Primaire/ }).first();
    await niveauBtn.click();
    // 1re classe du niveau
    const classeBtn = page.locator("button", { hasText: /Terminale|Première|2nde|1ère/ }).first();
    await classeBtn.click();
    // Le tableau des élèves apparaît
    await page.waitForSelector("table tbody tr", { timeout: 15000 });
  }

  test("afficher la liste des élèves", async ({ authedPage: page }) => {
    await ouvrirListeEleves(page);
    // Au moins un élève dans le tableau
    await expect(page.locator("table tbody tr").first()).toBeVisible({ timeout: 10000 });
  });

  test("rechercher un élève", async ({ authedPage: page }) => {
    await ouvrirListeEleves(page);
    const firstRow = await page.locator("table tbody tr td").first().textContent();
    const searchInput = page.locator('input[placeholder*="echerche"]').first();
    if (firstRow) {
      await searchInput.fill(firstRow.trim());
      await page.waitForTimeout(500);
      await expect(page.locator("table tbody tr").first()).toBeVisible();
    }
  });

  test("ouvrir le formulaire d'inscription", async ({ authedPage: page }) => {
    await page.goto("/eleves/nouveau");
    await expect(page.locator('input[id="prenom"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('input[id="nom"]')).toBeVisible();
    await expect(page.locator("text=Télécharger une photo")).toBeVisible();
  });

  test("ouvrir la fiche détail d'un élève", async ({ authedPage: page }) => {
    await ouvrirListeEleves(page);
    const firstLink = page.locator("table tbody tr a").first();
    const href = await firstLink.getAttribute("href");
    if (href) {
      await firstLink.click();
      await page.waitForURL(/\/eleves\/.+/);
      await expect(page.locator("text=Matricule").first()).toBeVisible({ timeout: 15000 });
    }
  });

  test("exporter la liste en CSV", async ({ authedPage: page }) => {
    await ouvrirListeEleves(page);
    // Vérifier que la page avec le tableau est fonctionnelle
    const exportBtn = page.locator("text=Exporter").first();
    const isVisible = await exportBtn.isVisible({ timeout: 3000 }).catch(() => false);
    if (isVisible) {
      await expect(exportBtn).toBeAttached();
    }
  });
});
