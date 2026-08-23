import { test, expect } from "./fixtures";

test.describe("Emploi du temps", () => {
  test("afficher la grille hebdomadaire", async ({ authedPage: page }) => {
    await page.goto("/emploi-du-temps");
    await expect(page.locator("text=Emploi").first()).toBeVisible({ timeout: 10000 });
    // Vérifier la présence des jours (Dimanche-Jeudi)
    await expect(page.locator("text=Dim").first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator("text=Jeu").first()).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Bulletins", () => {
  test("page de gestion des bulletins", async ({ authedPage: page }) => {
    await page.goto("/notes/bulletins");
    // La page s'affiche avec des onglets (Génération / Liste / Bilan annuel)
    await expect(page.locator("text=Bulletins").first()).toBeVisible({ timeout: 30000 });
    // Sélectionner une classe et une période pour révéler le bouton "Générer"
    // (BulletinsManager ne montre le workflow qu'après ces deux sélections)
    const classeSelect = page.locator("select").first();
    const periodeSelect = page.locator("select").nth(1);
    // Cliquer sur une période dans la sidebar si disponible, sinon utiliser les selects
    const periodeBtn = page.locator("button:has-text(/Période|Trimestre|Semestre/)").first();
    if (await periodeBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await periodeBtn.click();
    }
    // Sélectionner la première classe disponible
    if (await classeSelect.isVisible({ timeout: 5000 }).catch(() => false)) {
      const firstOption = await classeSelect.locator("option").nth(1).textContent();
      if (firstOption) await classeSelect.selectOption({ label: firstOption });
    }
    // Sélectionner la première période disponible
    if (await periodeSelect.isVisible({ timeout: 5000 }).catch(() => false)) {
      const firstPeriode = await periodeSelect.locator("option").nth(1).textContent();
      if (firstPeriode) await periodeSelect.selectOption({ label: firstPeriode });
    }
    // Le bouton "Générer" devrait maintenant être visible
    await expect(page.locator("text=Générer").first()).toBeVisible({ timeout: 30000 });
  });
});

test.describe("Navigation — pages principales", () => {
  const routes = [
    { path: "/dashboard", title: "Tableau de bord" },
    { path: "/eleves", title: "Élèves" },
    { path: "/absences", title: "Absences" },
    { path: "/notes", title: "Notes" },
    { path: "/evaluations", title: "Évaluations" },
    { path: "/emploi-du-temps", title: "Emploi" },
    { path: "/facturation", title: "Facturation" },
    { path: "/communication", title: "Communication" },
    { path: "/rapports", title: "Rapports" },
    { path: "/parametres", title: "Paramètres" },
    { path: "/vie-scolaire", title: "Vie" },
    { path: "/cours", title: "Cours" },
    { path: "/analytics", title: "Analytics" },
  ];

  for (const route of routes) {
    test(`${route.path} retourne 200`, async ({ authedPage: page }) => {
      const res = await page.goto(route.path, { timeout: 60000 });
      expect(res?.status()).toBeLessThan(400);
    });
  }
});
