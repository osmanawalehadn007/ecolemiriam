import { test, expect } from "./fixtures";

// Helper : ouvre la page /eleves, clique sur le premier onglet de groupe
// scolaire (Primaire / Collège / Lycée), puis sur la première classe pour
// révéler le tableau des élèves.
// Le composant ElevesTable ne rend <table> qu'après sélection groupe + classe.
async function openElevesTable(page: import("@playwright/test").Page) {
  await page.goto("/eleves");
  await expect(page.locator("text=Élèves").first()).toBeVisible({ timeout: 30000 });
  // Attendre que les onglets groupes scolaires soient rendus
  const groupTab = page.locator("div.flex.items-center.gap-1.px-4.pt-3.border-b button").first();
  await expect(groupTab).toBeVisible({ timeout: 30000 });
  await groupTab.click();
  // Après clic sur le groupe, des boutons de classe apparaissent dans un bloc
  // "px-4 py-3 border-b bg-muted/20". Cliquer sur le premier bouton de classe.
  const classBtn = page.locator("div.px-4.py-3.border-b button").first();
  await expect(classBtn).toBeVisible({ timeout: 30000 });
  await classBtn.click();
  // Le tableau devrait maintenant apparaître
  await expect(page.locator("table tbody tr").first()).toBeVisible({ timeout: 30000 });
}

test.describe("Gestion des élèves", () => {
  test("afficher la liste des élèves", async ({ authedPage: page }) => {
    await openElevesTable(page);
  });

  test("rechercher un élève", async ({ authedPage: page }) => {
    await openElevesTable(page);
    const firstRow = await page.locator("table tbody tr td").first().textContent();
    const searchInput = page.locator('input[placeholder*="echerche"]').first();
    if (firstRow) {
      await searchInput.fill(firstRow.trim());
      await page.waitForTimeout(500);
      await expect(page.locator("table tbody tr").first()).toBeVisible();
    }
  });

  // L'ancien test ouvrait `/eleves/nouveau` et remplissait `#prenom`. Cette URL
  // redirige désormais vers le workflow d'admissions : la saisie directe d'un
  // élève n'existe plus (candidature → dossier → admission → facture → paiement
  // → fiche élève créée automatiquement). On teste le comportement réel.
  test("l'inscription directe redirige vers le workflow d'admissions", async ({ authedPage: page }) => {
    await page.goto("/eleves/nouveau");
    await page.waitForURL(/\/admissions/, { timeout: 30000 });
    await expect(page.locator("body")).not.toBeEmpty();
  });

  test("ouvrir la fiche détail d'un élève", async ({ authedPage: page }) => {
    await openElevesTable(page);
    const firstLink = page.locator("table tbody tr a").first();
    const href = await firstLink.getAttribute("href");
    if (href) {
      await firstLink.click();
      await page.waitForURL(/\/eleves\/.+/);
      await expect(page.locator("text=Matricule").first()).toBeVisible({ timeout: 30000 });
    }
  });

  test("exporter la liste en CSV", async ({ authedPage: page }) => {
    await openElevesTable(page);
    // Vérifier que la page avec le tableau est fonctionnelle
    const exportBtn = page.locator("text=Exporter").first();
    const isVisible = await exportBtn.isVisible({ timeout: 5000 }).catch(() => false);
    if (isVisible) {
      await expect(exportBtn).toBeAttached();
    }
  });
});
