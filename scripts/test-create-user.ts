import { chromium } from "playwright";

const BASE_URL = "https://ecolemiriam.com";
// Identifiants lus dans l'environnement : ce script s'exécute contre un serveur
// réel, aucun compte ne doit figurer dans le code versionné (cf.
// scripts/ci/scan-secrets.mjs).
const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL ?? "";
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? "";
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error(
    "❌ TEST_ADMIN_EMAIL et TEST_ADMIN_PASSWORD sont requis.\n" +
      "   Exemple : TEST_ADMIN_EMAIL=… TEST_ADMIN_PASSWORD=… npx tsx scripts/test-create-user.ts",
  );
  process.exit(1);
}
const TEST_EMAIL = `test.create.${Date.now()}@icloud.com`;
const TEST_NAME = "Test User Flow";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  console.log("1. Login...");
  await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  // Prendre une screenshot pour debug
  await page.screenshot({ path: "/tmp/login-page.png" });
  console.log("   Login page loaded, URL:", page.url());

  // Remplir le formulaire
  await page.fill('input[type="email"], input[name="email"], input[id="email"]', ADMIN_EMAIL).catch(async () => {
    console.log("   Could not find email input, trying broader selector...");
    await page.locator('input').first().fill(ADMIN_EMAIL).catch(() => {});
  });
  await page.fill('input[type="password"], input[name="password"], input[id="password"]', ADMIN_PASSWORD).catch(async () => {
    await page.locator('input').nth(1).fill(ADMIN_PASSWORD).catch(() => {});
  });
  await page.screenshot({ path: "/tmp/login-filled.png" });

  await page.click('button[type="submit"]').catch(async () => {
    await page.locator('button').last().click().catch(() => {});
  });
  await page.waitForTimeout(5000);
  console.log("   After login, URL:", page.url());
  await page.screenshot({ path: "/tmp/after-login.png" });

  console.log("2. Navigate to parametres...");
  await page.goto(`${BASE_URL}/parametres`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  console.log("   On parametres:", page.url());
  await page.screenshot({ path: "/tmp/parametres.png" });

  // Aller à l'onglet Utilisateurs
  console.log("3. Click Users tab...");
  // Chercher le bouton/onglet Utilisateurs
  const userTab = page.getByRole("tab", { name: /utilisateurs|users/i }).or(
    page.getByText(/utilisateurs|users/i).first()
  );
  await userTab.click().catch(async () => {
    // Fallback: chercher un lien ou bouton contenant "Utilisateur"
    await page.getByText(/utilisateur/i).first().click().catch(() => {});
  });
  await page.waitForTimeout(1000);

  console.log("4. Click Add User button...");
  const addBtn = page.getByRole("button", { name: /ajouter|add|nouvel|créer/i }).first();
  await addBtn.click().catch(async () => {
    // Fallback: chercher un bouton avec icône Plus
    await page.locator('button:has(svg.lucide-plus)').first().click().catch(() => {
      console.log("   Could not find add button, trying alternative...");
    });
  });
  await page.waitForTimeout(1000);

  console.log("5. Fill user form...");
  // Remplir le formulaire de création d'utilisateur
  await page.fill('input[name="name"], input[id="name"]', TEST_NAME).catch(() => {});
  await page.fill('input[name="email"], input[id="email"]', TEST_EMAIL).catch(() => {});

  // Sélectionner le rôle TEACHER
  const roleSelect = page.locator('select[name="role"], select[id="role"]').first();
  await roleSelect.selectOption({ label: /enseignant|teacher/i }).catch(() => {
    console.log("   Could not select role, trying value...");
  });
  await roleSelect.selectOption("TEACHER").catch(() => {});

  // Sélectionner un site si nécessaire
  const siteSelect = page.locator('select[name="siteId"], select[id="siteId"]').first();
  await siteSelect.selectOption({ index: 1 }).catch(() => {});

  // Soumettre le formulaire
  console.log("6. Submit form...");
  const submitBtn = page.getByRole("button", { name: /créer|create|enregistrer/i }).first();
  await submitBtn.click().catch(async () => {
    await page.locator('button[type="submit"]').last().click().catch(() => {});
  });

  console.log("7. Wait for response...");
  await page.waitForTimeout(5000);

  // Vérifier si un toast/success message apparaît
  const successText = await page.textContent("body").catch(() => "");
  if (successText?.includes("succès") || successText?.includes("success") || successText?.includes("créé")) {
    console.log("   User created successfully!");
  } else {
    console.log("   Unclear result. Page text snippet:", successText?.slice(0, 500));
  }

  console.log("8. Test email:", TEST_EMAIL);
  console.log("   Done!");

  await browser.close();
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
