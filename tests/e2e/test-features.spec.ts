import { test, expect, Page } from "@playwright/test";
import { E2E_BASE_URL } from "./base-url";

// Historiquement codé en dur sur :3002 — la suite ne pouvait tourner que si un
// serveur tournait déjà sur ce port précis, indépendamment de
// `playwright.config.ts` (E2E_BASE_URL). Désormais aligné sur la config.
const BASE = E2E_BASE_URL;
const ADMIN_EMAIL = "admin@lycee-demo.ecolpro.app";
const TEACHER_EMAIL = "enseignant@lycee-demo.ecolpro.app";
const PARENT_EMAIL = "parent@lycee-demo.ecolpro.app";
const PASSWORD = "Demo@2026!";

async function login(page: Page, email: string, password: string) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  // 30 s : au premier appel après un démarrage du serveur, la connexion
  // (bcrypt + base distante + rendu du dashboard) peut dépasser 15 s.
  await page.waitForURL((url) => !url.pathname.includes("login"), { timeout: 30000 });
}

// ─── 1. Analytics : nouveaux graphiques ───────────────────────────
test.describe("Analytics — nouveaux graphiques", () => {
  test("Page analytics charge avec tous les graphiques", async ({ page }) => {
    await login(page, ADMIN_EMAIL, PASSWORD);
    await page.goto(`${BASE}/analytics`, { waitUntil: "networkidle" });
    await expect(page.locator("text=Analytics")).toBeVisible({ timeout: 15000 });

    // KPI cards
    await expect(page.locator("text=Élèves actifs")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("text=Taux de réussite")).toBeVisible();

    // Nouveaux graphiques
    await expect(page.locator("text=Répartition par genre")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("text=Encaissements")).toBeVisible();
    await expect(page.locator("text=Moyennes par classe (radar)")).toBeVisible();
    await expect(page.locator("text=Absences par classe")).toBeVisible();

    // Vérifier que les conteneurs recharts sont présents — certains graphiques
    // montent avec un délai (animations, lazy) : `expect.poll` retente jusqu'à
    // la fin du délai au lieu d'un comptage instantané.
    const charts = page.locator(".recharts-wrapper");
    await expect
      .poll(() => charts.count(), { timeout: 15000 })
      .toBeGreaterThanOrEqual(2);
    const chartCount = await charts.count();
    console.log(`  📊 ${chartCount} graphiques affichés`);
    // Les 4 sections existent : les graphes sans données seedées (encaissements,
    // absences) ne rendent pas de wrapper recharts — on vérifie leurs titres.
    for (const titre of ["Répartition par genre", "Encaissements", "Moyennes par classe", "Absences par classe"]) {
      await expect(page.getByText(titre).first()).toBeVisible({ timeout: 10000 });
    }
  });
});

// ─── 2. Appel + notifications (WhatsApp/SMS/Email) ────────────────
test.describe("Appel — enregistrement et notifications", () => {
  test("Enseignant peut faire l'appel", async ({ page }) => {
    await login(page, TEACHER_EMAIL, PASSWORD);
    await page.goto(`${BASE}/absences/appel`, { waitUntil: "networkidle" });

    // Sélectionner une classe
    await page.waitForTimeout(3000);
    const selectClasse = page.locator("select").first();
    if (await selectClasse.isVisible()) {
      await selectClasse.selectOption({ index: 1 });
      await page.waitForTimeout(2000);
    }

    // Marquer quelques élèves
    const buttons = page.locator("button:has-text('Absent'), button:has-text('Présent'), button:has-text('Retard')");
    const count = await buttons.count();
    console.log(`  📋 ${count} boutons de présence trouvés`);
    expect(count).toBeGreaterThan(0);
  });
});

// ─── 3. Messagerie ────────────────────────────────────────────────
test.describe("Messagerie", () => {
  test("Page communication s'affiche", async ({ page }) => {
    await login(page, ADMIN_EMAIL, PASSWORD);
    await page.goto(`${BASE}/communication`, { waitUntil: "networkidle" });
    await page.waitForTimeout(3000);

    // Vérifier que la page charge — sélecteur Playwright valide uniquement
    // (mélanger `text=` et des balises CSS dans la même chaîne est invalide).
    const pageTitle = page
      .locator("main")
      .getByText("Communication", { exact: false })
      .first();
    await expect(pageTitle).toBeVisible({ timeout: 10000 });
    console.log("  ✅ Page communication accessible");
  });

  test("Admin peut créer une notification", async ({ page }) => {
    await login(page, ADMIN_EMAIL, PASSWORD);
    await page.goto(`${BASE}/communication`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);

    // Chercher le formulaire de notification
    const titreInput = page.locator('input[name="titre"], input[placeholder*="titre"], input[placeholder*="Titre"]').first();
    const contenuTextarea = page.locator('textarea[name="contenu"], textarea[placeholder*="contenu"], textarea[placeholder*="Contenu"]').first();

    if (await titreInput.isVisible({ timeout: 5000 }) && await contenuTextarea.isVisible()) {
      await titreInput.fill("Test notification E2E");
      await contenuTextarea.fill("Ceci est un message de test automatisé.");

      // Chercher le bouton envoyer
      const sendBtn = page.locator('button:has-text("Envoyer"), button:has-text("Publier"), button[type="submit"]').first();
      if (await sendBtn.isVisible()) {
        await sendBtn.click();
        await page.waitForTimeout(3000);
        console.log("  ✅ Notification envoyée");
      }
    } else {
      console.log("  ⚠️ Formulaire non trouvé — page différente");
    }
  });
});

// ─── 4. Parent — consultation ─────────────────────────────────────
test.describe("Parent — accès en lecture", () => {
  test("Parent peut se connecter et voir le dashboard", async ({ page }) => {
    await login(page, PARENT_EMAIL, PASSWORD);
    await page.waitForTimeout(3000);

    // Le parent devrait voir le dashboard
    const url = page.url();
    console.log(`  📌 Parent redirigé vers: ${url}`);
    expect(url).not.toContain("login");
  });

  test("Parent peut voir les absences", async ({ page }) => {
    await login(page, PARENT_EMAIL, PASSWORD);
    await page.goto(`${BASE}/absences`, { waitUntil: "networkidle" });
    await page.waitForTimeout(3000);
    console.log(`  📌 Parent sur: ${page.url()}`);
  });
});

// ─── 5. PWA — service worker ──────────────────────────────────────
test.describe("PWA — service worker", () => {
  test("Service worker enregistré", async ({ page }) => {
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });

    // L'enregistrement est fait côté client après le montage : on laisse au
    // navigateur le temps de l'enregistrer. Une attente fixe de 3 s échouait sur
    // les runners CI (plus lents qu'un poste local).
    let swRegs: { scope: string; active: boolean }[] = [];
    await expect
      .poll(
        async () => {
          swRegs = await page.evaluate(() =>
            navigator.serviceWorker.getRegistrations().then((regs) =>
              regs.map((r) => ({ scope: r.scope, active: !!r.active }))
            )
          );
          return swRegs.length;
        },
        { timeout: 20000, message: "Aucun service worker enregistré après 20 s" }
      )
      .toBeGreaterThan(0);

    console.log(`  📡 Service workers: ${JSON.stringify(swRegs)}`);
  });

  test("Manifest accessible", async ({ page }) => {
    const response = await page.goto(`${BASE}/manifest.json`);
    expect(response?.ok()).toBeTruthy();
    const manifest = await response?.json();
    expect(manifest?.name).toContain("EcolPro");
    expect(manifest?.icons?.length).toBeGreaterThan(0);
    console.log(`  ✅ Manifest: ${manifest.name}, ${manifest.icons.length} icons`);
  });
});

// ─── 6. Rate limiting ─────────────────────────────────────────────
test.describe("Rate limiting", () => {
  test("Upload photo — rate limit après 10 tentatives", async ({ page }) => {
    await login(page, ADMIN_EMAIL, PASSWORD);

    // Rafale parallèle : le seau à jetons du limiteur (10 req./min, recharge
    // d'un jeton toutes les 6 s) est vidé par 10 requêtes simultanées. En
    // séquentiel, la recharge pouvait suffire entre deux requêtes lentes, ce
    // qui rendait le test dépendant de la vitesse du serveur.
    const statuses = await page.evaluate(async () => {
      const send = async () => {
        const formData = new FormData();
        const blob = new Blob(["fake"], { type: "image/png" });
        formData.append("photo", blob, "test.png");
        const r = await fetch("/api/eleves/upload-photo", { method: "POST", body: formData });
        return r.status;
      };
      return Promise.all(Array.from({ length: 12 }, send));
    });

    const limited = statuses.filter((s) => s === 429).length;
    console.log(`  📡 Statuts: ${JSON.stringify(statuses)} — ${limited} refusée(s) (429)`);
    expect(limited).toBeGreaterThan(0);
  });
});
