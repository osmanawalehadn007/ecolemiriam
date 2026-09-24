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
    // BulletinsManager utilise des boutons dans la sidebar (pas des <select>).
    // 1. Cliquer sur la première période (card "Période" → boutons)
    const periodeBtn = page.locator("div.space-y-1 button:has-text(/.+/)").first();
    if (await periodeBtn.isVisible({ timeout: 10000 }).catch(() => false)) {
      await periodeBtn.click();
    }
    // 2. Cliquer sur la première classe (card "Classes" → boutons)
    //    Les boutons de classe contiennent un nom + un compte d'élèves
    const classeBtn = page.locator("div.space-y-1 button .text-left p").first();
    if (await classeBtn.isVisible({ timeout: 10000 }).catch(() => false)) {
      await classeBtn.click();
    }
    // Le bouton "Générer" devrait maintenant être visible dans le workflow
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
