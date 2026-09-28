import { test, expect } from "./fixtures";

test.describe("Facturation", () => {
  test("afficher la liste des factures", async ({ authedPage: page }) => {
    await page.goto("/facturation");
    await expect(page.locator("text=Facturation").first()).toBeVisible({ timeout: 10000 });
  });

  test("créer une nouvelle facture", async ({ authedPage: page }) => {
    await page.goto("/facturation/nouvelle");
    // Le formulaire n'a plus de champ « libellé » : la facture se construit en
    // choisissant un élève puis des services (mensualité, cantine, transport…),
    // le libellé étant généré. On vérifie donc l'en-tête et le sélecteur de
    // classe, réellement présents.
    await expect(page.getByRole("heading", { name: "Nouvelle facture" }).first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator("#classeFilter")).toBeVisible();
    await expect(page.getByRole("button", { name: "Créer la facture" })).toBeVisible();
  });

  test("détail d'une facture — boutons d'action", async ({ authedPage: page }) => {
    await page.goto("/facturation");
    await page.waitForTimeout(2000);
    const factureLink = page.locator('a[href*="/facturation/"]').first();
    if (await factureLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await factureLink.click();
      await page.waitForURL(/\/facturation\/[^/]+$/, { timeout: 10000 });
      await expect(page.locator("text=Retour")).toBeVisible({ timeout: 10000 });
    }
  });
});
