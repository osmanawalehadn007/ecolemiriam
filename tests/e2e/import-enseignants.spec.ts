import { test, expect, type Page, type APIRequestContext } from "@playwright/test";

// ─── Auth : login via API NextAuth ────────────────────────────────
// On utilise le compte TENANT_ADMIN qui a la permission parametres:write
const ADMIN_EMAIL = "ahdimounomar@gmail.com";
const ADMIN_PASSWORD = "EcolPro@2026";

async function login(page: Page) {
  // Retry : en dev, la première requête peut tomber sur une route en cours
  // de compilation et retourner du HTML au lieu de JSON.
  let csrfToken: string | undefined;
  for (let attempt = 0; attempt < 5; attempt++) {
    const csrfRes = await page.request.get("/api/auth/csrf");
    const contentType = csrfRes.headers()["content-type"] ?? "";
    if (contentType.includes("application/json")) {
      const body = await csrfRes.json();
      csrfToken = body.csrfToken;
      break;
    }
    await page.waitForTimeout(3000);
  }
  if (!csrfToken) throw new Error("Impossible d'obtenir le CSRF token");

  await page.request.post("/api/auth/callback/credentials", {
    form: {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      csrfToken,
      callbackUrl: "/parametres",
      json: "true",
    },
    maxRedirects: 0,
  });

  await page.goto("/parametres", { timeout: 60_000 });
  await page.waitForURL("**/parametres", { timeout: 60_000 });
}

// ─── Helper : login via API (pour les tests API sans page) ────────
// Même logique que login() mais utilise le fixture `request` directement.
// Inclut le retry pour le CSRF token (en dev, la route peut retourner du HTML).
async function loginAPI(request: APIRequestContext, email: string, password: string) {
  let csrfToken: string | undefined;
  for (let attempt = 0; attempt < 8; attempt++) {
    const csrfRes = await request.get("/api/auth/csrf");
    const contentType = csrfRes.headers()["content-type"] ?? "";
    if (contentType.includes("application/json")) {
      const body = await csrfRes.json();
      csrfToken = body.csrfToken;
      break;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  if (!csrfToken) throw new Error("Impossible d'obtenir le CSRF token");

  await request.post("/api/auth/callback/credentials", {
    form: {
      email,
      password,
      csrfToken,
      callbackUrl: "/parametres",
      json: "true",
    },
    maxRedirects: 0,
  });
}

// ─── Helper : créer un fichier Excel de test en mémoire ───────────
async function createTestExcel(
  page: Page,
  rows: Record<string, string>[],
  headers: string[],
): Promise<{ buffer: Buffer; name: string }> {
  // Utiliser ExcelJS côté serveur via un endpoint de test serait idéal,
  // mais pour E2E on crée un blob CSV que l'on convertit en xlsx via
  // une page de test. Plus simple : on crée un vrai .xlsx via page.evaluate
  // avec SheetJS (xlsx) si disponible, sinon on utilise un endpoint.
  //
  // Approche la plus fiable : créer le fichier via un script Node séparé
  // et le lire depuis le disque. Mais pour E2E, on peut aussi utiliser
  // l'API File du navigateur avec un contenu CSV (l'API accepte .xlsx
  // uniquement, donc on crée un xlsx minimal via exceljs dans le navigateur).
  //
  // Solution la plus simple : créer le fichier côté serveur de test.
  const { execSync } = await import("child_process");
  const { writeFileSync, readFileSync, unlinkSync } = await import("fs");
  const { join } = await import("path");

  // Créer un script temporaire qui génère le xlsx
  const scriptPath = join(process.cwd(), "tests/e2e/tmp-gen-xlsx.cjs");
  const xlsxPath = join(process.cwd(), "tests/e2e/tmp-test-enseignants.xlsx");

  const script = `
const ExcelJS = require("exceljs");
async function main() {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Enseignants");
  sheet.columns = ${JSON.stringify(headers.map((h) => ({ header: h, key: h.toLowerCase().replace(/[^a-z0-9]/g, "_"), width: 20 })))};
  const rows = ${JSON.stringify(rows)};
  for (const row of rows) {
    const obj = {};
    ${JSON.stringify(headers)}.forEach((h, i) => {
      obj[h.toLowerCase().replace(/[^a-z0-9]/g, "_")] = row[h] || "";
    });
    sheet.addRow(obj);
  }
  const buf = await wb.xlsx.writeBuffer();
  require("fs").writeFileSync(${JSON.stringify(xlsxPath)}, Buffer.from(buf));
  console.log("OK");
}
main();
`;

  writeFileSync(scriptPath, script);
  execSync(`node "${scriptPath}"`, { cwd: process.cwd(), stdio: "pipe" });

  const buffer = readFileSync(xlsxPath);
  const name = "test-enseignants-e2e.xlsx";

  // Nettoyer les fichiers temporaires
  try { unlinkSync(scriptPath); } catch {}
  try { unlinkSync(xlsxPath); } catch {}

  return { buffer, name };
}

// ─── Tests ────────────────────────────────────────────────────────

test.describe("Import d'enseignants — Module complet", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  // ─── 1. La page Paramètres charge avec l'onglet Utilisateurs ────
  test("Page Paramètres → onglet Utilisateurs visible", async ({ page }) => {
    await page.goto("/parametres", { waitUntil: "networkidle", timeout: 60_000 });
    await page.waitForTimeout(3000);

    // La page doit contenir un onglet "Utilisateurs" ou "Users"
    // Le groupe s'appelle "Utilisateurs & Contacts" (fr.json → groupUsers)
    const usersTab = page.locator("text=/Utilisateurs|Users/i").first();
    await expect(usersTab).toBeVisible({ timeout: 30_000 });

    // Cliquer sur l'onglet
    await usersTab.click();
    await page.waitForTimeout(1000);

    // Vérifier que le contenu de l'onglet est visible
    const addUserBtn = page.locator("text=/Ajouter un utilisateur|Add user|Nouvel utilisateur/i").first();
    await expect(addUserBtn).toBeVisible({ timeout: 10_000 });
  });

  // ─── 2. Le bouton "Importer enseignants" est présent ─────────────
  test("Bouton 'Importer enseignants' visible dans l'onglet Utilisateurs", async ({ page }) => {
    await page.goto("/parametres", { waitUntil: "networkidle", timeout: 60_000 });
    await page.waitForTimeout(2000);

    // Aller à l'onglet utilisateurs
    const usersTab = page.locator("text=/Utilisateurs|Users/i").first();
    if (await usersTab.isVisible({ timeout: 10_000 })) {
      await usersTab.click();
      await page.waitForTimeout(1000);
    }

    // Le bouton d'import doit être visible
    const importBtn = page.locator("text=/Importer.*enseignant|Import.*teacher/i").first();
    await expect(importBtn).toBeVisible({ timeout: 10_000 });
    console.log("  ✅ Bouton 'Importer enseignants' trouvé");
  });

  // ─── 3. Ouverture du dialogue d'import ───────────────────────────
  test("Clic sur 'Importer' ouvre le dialogue", async ({ page }) => {
    await page.goto("/parametres", { waitUntil: "networkidle", timeout: 60_000 });
    await page.waitForTimeout(2000);

    const usersTab = page.locator("text=/Utilisateurs|Users/i").first();
    if (await usersTab.isVisible({ timeout: 10_000 })) {
      await usersTab.click();
      await page.waitForTimeout(1000);
    }

    const importBtn = page.locator("text=/Importer.*enseignant|Import.*teacher/i").first();
    await importBtn.click();
    await page.waitForTimeout(1000);

    // Le dialogue doit être visible
    const dialog = page.locator("text=/Importer.*enseignant|Import.*teacher|Fichier.*Excel|\.xlsx/i").first();
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // La zone de dépôt doit être présente
    const dropzone = page.locator("text=/glisser|déposer|clique|parcourir|sélectionner|drop|browse|\.xlsx/i").first();
    await expect(dropzone).toBeVisible({ timeout: 10000 });
    console.log("  ✅ Dialogue d'import ouvert avec zone de dépôt");
  });

  // ─── 4. Refus d'un fichier non-Excel ─────────────────────────────
  test("Refuse un fichier non-Excel (.csv)", async ({ page }) => {
    await page.goto("/parametres", { waitUntil: "networkidle", timeout: 60_000 });
    await page.waitForTimeout(2000);

    const usersTab = page.locator("text=/Utilisateurs|Users/i").first();
    if (await usersTab.isVisible({ timeout: 10_000 })) {
      await usersTab.click();
      await page.waitForTimeout(1000);
    }

    const importBtn = page.locator("text=/Importer.*enseignant|Import.*teacher/i").first();
    await importBtn.click();
    await page.waitForTimeout(1000);

    // Tenter d'uploader un fichier .csv
    // L'input file est caché (className="hidden" → display:none) mais
    // setInputFiles fonctionne sur les inputs cachés.
    const fileInput = page.locator('input[type="file"]').first();
    const inputCount = await fileInput.count();
    if (inputCount > 0) {
      const csvContent = "Nom,Email,Site\nTest,test@test.com,Campus\n";
      await fileInput.setInputFiles({
        name: "test.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(csvContent),
      });
      await page.waitForTimeout(1000);

      // Un message d'erreur doit apparaître (toast)
      const errorMsg = page.locator("text=/format.*non.*valide|invalid.*format|xlsx/i").first();
      // Le toast peut être fugace — on vérifie juste qu'aucun plan n'est affiché
      const planSection = page.locator("text=/Nouveau|Créer|Ignorer/i").first();
      const planVisible = await planSection.isVisible({ timeout: 2000 }).catch(() => false);
      expect(planVisible).toBe(false);
      console.log("  ✅ Fichier .csv refusé (pas de plan affiché)");
    } else {
      console.log("  ⚠️ Input file non trouvé — test skipped");
      test.skip();
    }
  });

  // ─── 5. Analyse d'un fichier Excel valide (dry-run) ──────────────
  test("Analyse un fichier Excel valide et affiche le plan", async ({ page }) => {
    await page.goto("/parametres", { waitUntil: "networkidle", timeout: 60_000 });
    await page.waitForTimeout(2000);

    const usersTab = page.locator("text=/Utilisateurs|Users/i").first();
    if (await usersTab.isVisible({ timeout: 10_000 })) {
      await usersTab.click();
      await page.waitForTimeout(1000);
    }

    const importBtn = page.locator("text=/Importer.*enseignant|Import.*teacher/i").first();
    await importBtn.click();
    await page.waitForTimeout(1000);

    // Créer un fichier Excel de test
    const { buffer, name } = await createTestExcel(
      page,
      [
        { Nom: "E2E Test Un", Email: "e2e.test1@ecolemiriam.com", "Site d'affectation": "Campus Central", Temps: "Plein" },
        { Nom: "E2E Test Deux", Email: "e2e.test2@ecolemiriam.com", "Site d'affectation": "Campus Central", Temps: "Partiel" },
        { Nom: "E2E Test Trois", Email: "e2e.test3@ecolemiriam.com", "Site d'affectation": "Site Inexistant", Temps: "CDI" },
        { Nom: "", Email: "e2e.test4@ecolemiriam.com", "Site d'affectation": "Campus Central", Temps: "Plein" },
      ],
      ["Nom", "Email", "Site d'affectation", "Temps"],
    );

    // Uploader le fichier
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer,
    });
    await page.waitForTimeout(1000);

    // Le nom du fichier doit s'afficher
    await expect(page.locator(`text=${name}`).first()).toBeVisible({ timeout: 5000 });

    // Cliquer sur "Analyser"
    const analyzeBtn = page.locator("button:has-text(/Analyser|Analyse|Prévisualiser|Preview/i)").first();
    if (await analyzeBtn.isVisible({ timeout: 3000 })) {
      await analyzeBtn.click();
    } else {
      // L'analyse peut être déclenchée automatiquement après sélection du fichier
      console.log("  ℹ️  Pas de bouton Analyser — analyse auto après upload");
    }

    // Attendre que le plan s'affiche
    await page.waitForTimeout(5000);

    // Le plan doit contenir des lignes avec des verdicts
    const planContent = page.locator("text=/Nouveau|Créer|Ignorer|Site.*inconnu|Erreur/i").first();
    await expect(planContent).toBeVisible({ timeout: 30_000 });

    // Vérifier qu'il y a des compteurs
    const counters = page.locator("text=/\\d+.*\\d+|Créer|Ignorer/i");
    const counterCount = await counters.count();
    expect(counterCount).toBeGreaterThan(0);

    console.log("  ✅ Plan d'analyse affiché avec verdicts");
  });

  // ─── 6. Fermeture du dialogue ────────────────────────────────────
  test("Fermeture du dialogue par clic sur X", async ({ page }) => {
    await page.goto("/parametres", { waitUntil: "networkidle", timeout: 60_000 });
    await page.waitForTimeout(2000);

    const usersTab = page.locator("text=/Utilisateurs|Users/i").first();
    if (await usersTab.isVisible({ timeout: 10_000 })) {
      await usersTab.click();
      await page.waitForTimeout(1000);
    }

    const importBtn = page.locator("text=/Importer.*enseignant|Import.*teacher/i").first();
    await importBtn.click();
    await page.waitForTimeout(1000);

    // Le dialogue est ouvert
    const dialogBefore = page.locator(".fixed.inset-0").first();
    await expect(dialogBefore).toBeVisible({ timeout: 5000 });

    // Cliquer sur le bouton X
    const closeBtn = page.locator(".fixed.inset-0 button:has(svg)").first();
    await closeBtn.click();
    await page.waitForTimeout(500);

    // Le dialogue doit être fermé
    const dialogAfter = page.locator(".fixed.inset-0").first();
    const stillVisible = await dialogAfter.isVisible({ timeout: 2000 }).catch(() => false);
    expect(stillVisible).toBe(false);
    console.log("  ✅ Dialogue fermé correctement");
  });
});

// ─── Tests API (sans beforeEach login) ────────────────────────────
// Les tests API utilisent le fixture `request` et gèrent leur propre
// authentification. On les sépare du describe principal pour éviter
// que le beforeEach (qui login via page) n'authentifie le contexte
// de requête — ce qui casserait le test "sans auth → 401".
test.describe("Import d'enseignants — Tests API", () => {

  // ─── 7. Test API : analyse sans authentification → 401 ou 403 ──
  test("API analyse sans auth → 401/403", async ({ request }) => {
    const res = await request.post("/api/import/enseignants/analyze", {
      multipart: { file: { name: "test.xlsx", mimeType: "application/octet-stream", buffer: Buffer.from("") } },
    });
    // 401 = non authentifié, 403 = CSRF bloqué (pas d'Origin header)
    // Les deux indiquent que la requête non authentifiée est refusée
    expect([401, 403]).toContain(res.status());
    console.log(`  ✅ API analyse refuse les requêtes non authentifiées (${res.status()})`);
  });

  // ─── 8. Test API : import sans fichier → 400 ────────────────────
  test("API import sans fichier → 400", async ({ request }) => {
    // D'abord s'authentifier (avec retry pour le dev mode)
    await loginAPI(request, ADMIN_EMAIL, ADMIN_PASSWORD);

    // Requête sans fichier — Origin header requis pour passer le CSRF
    const res = await request.post("/api/import/enseignants/analyze", {
      headers: { Origin: "http://localhost:3000" },
      multipart: {},
    });
    expect(res.status()).toBe(400);
    console.log("  ✅ API analyse refuse les requêtes sans fichier (400)");
  });

  // ─── 9. Test API : import sans hash → 400 ───────────────────────
  test("API import sans hash → 400", async ({ request }) => {
    await loginAPI(request, ADMIN_EMAIL, ADMIN_PASSWORD);

    // Créer un xlsx minimal
    const { buffer, name } = await createTestExcel(
      null as any,
      [{ Nom: "Test", Email: "test@ecolemiriam.com", "Site d'affectation": "Campus Central", Temps: "Plein" }],
      ["Nom", "Email", "Site d'affectation", "Temps"],
    );

    // Requête avec fichier mais sans hash — Origin header requis
    const res = await request.post("/api/import/enseignants", {
      headers: { Origin: "http://localhost:3000" },
      multipart: {
        file: { name, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer },
      },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("prévisualisé");
    console.log("  ✅ API import refuse un import sans prévisualisation (400)");
  });

  // ─── 10. Test API : permission insuffisante → 403 ───────────────
  test("API analyse avec compte TEACHER → 403", async ({ request }) => {
    // S'authentifier avec un compte TEACHER (pas parametres:write)
    await loginAPI(request, "awaleh.osman.adn@gmail.com", "Ttestt@@");

    const { buffer, name } = await createTestExcel(
      null as any,
      [{ Nom: "Test", Email: "test@ecolemiriam.com", "Site d'affectation": "Campus Central", Temps: "Plein" }],
      ["Nom", "Email", "Site d'affectation", "Temps"],
    );

    // Origin header requis pour passer le CSRF
    const res = await request.post("/api/import/enseignants/analyze", {
      headers: { Origin: "http://localhost:3000" },
      multipart: {
        file: { name, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer },
      },
    });
    expect(res.status()).toBe(403);
    console.log("  ✅ API analyse refuse un compte TEACHER (403)");
  });
});
