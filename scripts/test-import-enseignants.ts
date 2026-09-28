/**
 * Script de test : crée un fichier Excel de test pour l'import d'enseignants
 * avec différents cas limites, puis l'envoie à l'API.
 *
 * Usage: npx tsx scripts/test-import-enseignants.ts
 */

import ExcelJS from "exceljs";
import { writeFileSync, readFileSync } from "fs";
import { join } from "path";

// ─── Configuration ────────────────────────────────────────────────
const BASE_URL = "http://localhost:3000";
// Compte par défaut : celui créé par `prisma/seed.ts` (base locale) ; un compte
// réel se fournit via TEST_ADMIN_EMAIL / TEST_ADMIN_PASSWORD, jamais dans le code.
const TEST_EMAIL = process.env.TEST_ADMIN_EMAIL ?? "admin@lycee-demo.ecolemiriam.app";
const TEST_PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? "Demo@2026!";
const ORIGIN = "http://localhost:3000";

// ─── Authentification NextAuth ────────────────────────────────────

async function getCSRFToken(): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/auth/csrf`, {
    headers: { Origin: ORIGIN },
  });
  const data = await res.json();
  if (!data.csrfToken) throw new Error("Impossible de récupérer le token CSRF");
  return data.csrfToken as string;
}

async function login(): Promise<{ cookies: string; csrfToken: string }> {
  console.log("🔐 Authentification NextAuth...");

  // 1. Récupérer le token CSRF et les cookies de session
  const csrfRes = await fetch(`${BASE_URL}/api/auth/csrf`, {
    headers: { Origin: ORIGIN },
  });
  const setCookieHeader = csrfRes.headers.get("set-cookie") || "";
  const csrfData = await csrfRes.json();
  const csrfToken = csrfData.csrfToken;

  console.log(`   CSRF token: ${csrfToken?.substring(0, 16)}...`);

  // Extraire les cookies de la réponse CSRF
  const cookiesFromCsrf = setCookieHeader
    .split(",")
    .map((c) => c.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");

  // 2. Login avec credentials
  const loginRes = await fetch(`${BASE_URL}/api/auth/callback/credentials`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: ORIGIN,
      Cookie: cookiesFromCsrf,
    },
    body: new URLSearchParams({
      csrfToken,
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      callbackUrl: "/dashboard",
      json: "true",
    }),
    redirect: "manual",
  });

  const loginSetCookie = loginRes.headers.get("set-cookie") || "";
  const loginCookies = loginSetCookie
    .split(",")
    .map((c) => c.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");

  // Combiner les cookies
  const allCookies = [cookiesFromCsrf, loginCookies].filter(Boolean).join("; ");

  console.log(`   Cookies reçus: ${allCookies.length} caractères`);
  console.log(`   Status login: ${loginRes.status}`);

  // Vérifier la session
  const sessionRes = await fetch(`${BASE_URL}/api/auth/session`, {
    headers: {
      Origin: ORIGIN,
      Cookie: allCookies,
    },
  });
  const session = await sessionRes.json();

  if (!session?.user?.email) {
    console.error("❌ Session non établie. Réponse session:", JSON.stringify(session));
    throw new Error("Échec de l'authentification");
  }

  console.log(`   ✅ Connecté: ${session.user.email} (rôle: ${session.user.role || "N/A"})`);
  return { cookies: allCookies, csrfToken };
}

// ─── Création du fichier Excel de test ────────────────────────────

async function createTestExcel(): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Enseignants");

  sheet.columns = [
    { header: "Nom", key: "nom", width: 25 },
    { header: "Email", key: "email", width: 35 },
    { header: "Téléphone", key: "telephone", width: 18 },
    { header: "Matière", key: "matiere", width: 20 },
    { header: "Site d'affectation", key: "site", width: 25 },
    { header: "Temps", key: "temps", width: 12 },
  ];

  const testData = [
    // Cas nominaux (NOUVEAU)
    { nom: "Ahmed Omar Hassan", email: "ahmed.omar.test@ecolemiriam.com", telephone: "+253 77 12 34 56", matiere: "Mathématiques", site: "Campus Central", temps: "Plein" },
    { nom: "Fatima Ali Mahmoud", email: "fatima.ali.test@ecolemiriam.com", telephone: "+253 77 23 45 67", matiere: "Français", site: "Campus Central", temps: "Partiel" },
    { nom: "Said Hassan Farah", email: "said.hassan.test@ecolemiriam.com", telephone: "+253 77 34 56 78", matiere: "Physique", site: "Annexe Warabaleh", temps: "CDI" },
    { nom: "Amina Yusuf Ibrahim", email: "amina.yusuf.test@ecolemiriam.com", telephone: "+253 77 45 67 89", matiere: "Anglais", site: "ANNEXE PK12", temps: "CDD" },

    // Cas : matière inconnue (MATIERE_INCONNUE — doit être créée quand même)
    { nom: "Omar Mahamoud", email: "omar.mahamoud.test@ecolemiriam.com", telephone: "+253 77 56 78 90", matiere: "Biologie Marine", site: "Campus Central", temps: "Plein" },

    // Cas : sans matière (NOUVEAU — matière optionnelle)
    { nom: "Khadija Abdillahi", email: "khadija.abdillahi.test@ecolemiriam.com", telephone: "+253 77 67 89 01", matiere: "", site: "Campus Central", temps: "Plein" },

    // Cas : site inconnu (SITE_INCONNU)
    { nom: "Yusuf Ismail", email: "yusuf.ismail.test@ecolemiriam.com", telephone: "+253 77 78 90 12", matiere: "Histoire", site: "Site Inexistant", temps: "Plein" },

    // Cas : temps non reconnu (ERREUR)
    { nom: "Hawa Moussa", email: "hawa.moussa.test@ecolemiriam.com", telephone: "+253 77 89 01 23", matiere: "Géographie", site: "Campus Central", temps: "Peut-être" },

    // Cas : email invalide (ERREUR)
    { nom: "Ibrahim Chehem", email: "email-sans-arobase", telephone: "+253 77 90 12 34", matiere: "SVT", site: "Campus Central", temps: "Plein" },

    // Cas : nom manquant (ERREUR)
    { nom: "", email: "nom.manquant.test@ecolemiriam.com", telephone: "+253 77 01 23 45", matiere: "EPS", site: "Campus Central", temps: "Plein" },

    // Cas : email manquant (ERREUR)
    { nom: "Rachid Abdi", email: "", telephone: "+253 77 12 34 56", matiere: "Arabe", site: "Campus Central", temps: "Plein" },

    // Cas : site manquant (ERREUR)
    { nom: "Leyla Aden", email: "leyla.aden.test@ecolemiriam.com", telephone: "+253 77 23 45 67", matiere: "Philosophie", site: "", temps: "Plein" },
  ];

  for (const row of testData) {
    sheet.addRow(row);
  }

  const filePath = join(process.cwd(), "scripts", "test-enseignants.xlsx");
  const buffer = await workbook.xlsx.writeBuffer();
  writeFileSync(filePath, buffer);
  console.log(`\n✅ Fichier Excel créé: ${filePath} (${testData.length} lignes de test)`);
  return filePath;
}

// ─── Test de l'analyse (dry-run) ──────────────────────────────────

async function testAnalyze(filePath: string, cookies: string): Promise<any> {
  console.log("\n" + "=".repeat(70));
  console.log("PHASE 1: Test de l'analyse (dry-run)");
  console.log("=".repeat(70));

  const fileBuffer = readFileSync(filePath);
  const formData = new FormData();
  const blob = new Blob([fileBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  formData.append("file", blob, "test-enseignants.xlsx");

  const res = await fetch(`${BASE_URL}/api/import/enseignants/analyze`, {
    method: "POST",
    headers: {
      Origin: ORIGIN,
      Cookie: cookies,
    },
    body: formData,
  });

  const data = await res.json();

  if (!res.ok) {
    console.error(`❌ Erreur HTTP ${res.status}:`, data.error);
    return null;
  }

  console.log("\n📊 Résumé du plan:");
  console.log(`   Total lignes: ${data.resume.total}`);
  console.log(`   À créer:      ${data.resume.aCreer}`);
  console.log(`   À ignorer:    ${data.resume.aIgnorer}`);
  console.log(`   Erreurs:      ${data.resume.erreurs}`);
  console.log(`   Matières inconnues: ${data.resume.matieresInconnues}`);
  console.log(`   Sites inconnus:    ${data.resume.sitesInconnus}`);

  console.log("\n📋 Détail des lignes:");
  for (const l of data.lignes) {
    const icon =
      l.verdict === "NOUVEAU" ? "✅" :
      l.verdict === "EMAIL_EXISTANT" ? "⚠️ " :
      l.verdict === "MATIERE_INCONNUE" ? "🟠" :
      l.verdict === "SITE_INCONNU" ? "🔴" :
      l.verdict === "ERREUR" ? "❌" : "❓";
    console.log(`   ${icon} L${String(l.ligne).padStart(2)} | ${l.verdict.padEnd(18)} | ${(l.nom || "(vide)").padEnd(22)} | ${l.message}`);
  }

  if (data.matieresInconnues?.length > 0) {
    console.log(`\n🔍 Matières inconnues: ${data.matieresInconnues.join(", ")}`);
  }
  if (data.sitesInconnus?.length > 0) {
    console.log(`\n🔍 Sites inconnus: ${data.sitesInconnus.join(", ")}`);
  }

  console.log(`\n🔑 Hash: ${data.hash}`);
  return data;
}

// ─── Vérifications de cohérence ───────────────────────────────────

function runCoherenceChecks(plan: any): boolean {
  console.log("\n" + "=".repeat(70));
  console.log("PHASE 2: Vérifications de cohérence du plan");
  console.log("=".repeat(70));

  const verifications: { test: string; passed: boolean; detail: string }[] = [];

  // V1: Les lignes NOUVEAU doivent avoir un siteId
  const nouveaux = plan.lignes.filter((l: any) => l.verdict === "NOUVEAU");
  const nouveauxSansSiteId = nouveaux.filter((l: any) => !l.siteId);
  verifications.push({
    test: "Les lignes NOUVEAU ont toutes un siteId résolu",
    passed: nouveauxSansSiteId.length === 0,
    detail: nouveauxSansSiteId.length === 0 ? `${nouveaux.length} lignes OK` : `${nouveauxSansSiteId.length} lignes sans siteId`,
  });

  // V2: Les lignes ERREUR doivent avoir action=IGNORER
  const erreurs = plan.lignes.filter((l: any) => l.verdict === "ERREUR");
  const erreursPasIgnorer = erreurs.filter((l: any) => l.action !== "IGNORER");
  verifications.push({
    test: "Les lignes ERREUR ont action=IGNORER",
    passed: erreursPasIgnorer.length === 0,
    detail: erreursPasIgnorer.length === 0 ? `${erreurs.length} erreurs OK` : `${erreursPasIgnorer.length} erreurs avec mauvaise action`,
  });

  // V3: Les lignes SITE_INCONNU doivent avoir action=IGNORER
  const sitesInconnus = plan.lignes.filter((l: any) => l.verdict === "SITE_INCONNU");
  const sitesInconnusPasIgnorer = sitesInconnus.filter((l: any) => l.action !== "IGNORER");
  verifications.push({
    test: "Les lignes SITE_INCONNU ont action=IGNORER",
    passed: sitesInconnusPasIgnorer.length === 0,
    detail: sitesInconnusPasIgnorer.length === 0 ? `${sitesInconnus.length} sites inconnus OK` : `${sitesInconnusPasIgnorer.length} avec mauvaise action`,
  });

  // V4: Les lignes MATIERE_INCONNUE doivent avoir action=CREER
  const matieresInconnues = plan.lignes.filter((l: any) => l.verdict === "MATIERE_INCONNUE");
  const matieresInconnuesPasCreer = matieresInconnues.filter((l: any) => l.action !== "CREER");
  verifications.push({
    test: "Les lignes MATIERE_INCONNUE ont action=CREER (matière optionnelle)",
    passed: matieresInconnuesPasCreer.length === 0,
    detail: matieresInconnuesPasCreer.length === 0 ? `${matieresInconnues.length} matières inconnues OK` : `${matieresInconnuesPasCreer.length} avec mauvaise action`,
  });

  // V5: Le hash est présent et non vide
  verifications.push({
    test: "Le hash du fichier est présent",
    passed: !!plan.hash && plan.hash.length > 0,
    detail: plan.hash ? `Hash: ${plan.hash.substring(0, 16)}...` : "Hash manquant",
  });

  // V6: Le compte total correspond à la somme des actions
  const totalCalcule = plan.resume.aCreer + plan.resume.aIgnorer;
  verifications.push({
    test: "Le compte total = aCréer + aIgnorer",
    passed: totalCalcule === plan.resume.total,
    detail: `${totalCalcule} = ${plan.resume.aCreer} + ${plan.resume.aIgnorer} (attendu: ${plan.resume.total})`,
  });

  // V7: Aucune ligne NOUVEAU ne doit avoir un email en double
  const emailsNouveaux = nouveaux.map((l: any) => l.email);
  const emailsUniques = new Set(emailsNouveaux);
  verifications.push({
    test: "Aucun email en double parmi les lignes NOUVEAU",
    passed: emailsNouveaux.length === emailsUniques.size,
    detail: emailsNouveaux.length === emailsUniques.size ? `${emailsNouveaux.length} emails uniques` : `${emailsNouveaux.length - emailsUniques.size} doublons détectés`,
  });

  // V8: Les lignes MATIERE_INCONNUE ne doivent pas avoir de matiereId
  const matieresInconnuesAvecId = matieresInconnues.filter((l: any) => l.matiereId);
  verifications.push({
    test: "Les lignes MATIERE_INCONNUE n'ont pas de matiereId",
    passed: matieresInconnuesAvecId.length === 0,
    detail: matieresInconnuesAvecId.length === 0 ? "OK" : `${matieresInconnuesAvecId.length} lignes avec matiereId`,
  });

  // V9: Les lignes NOUVEAU avec matière doivent avoir un matiereId
  const nouveauxAvecMatiere = nouveaux.filter((l: any) => l.matiere);
  const nouveauxAvecMatiereSansId = nouveauxAvecMatiere.filter((l: any) => !l.matiereId);
  verifications.push({
    test: "Les lignes NOUVEAU avec matière ont un matiereId résolu",
    passed: nouveauxAvecMatiereSansId.length === 0,
    detail: nouveauxAvecMatiereSansId.length === 0 ? `${nouveauxAvecMatiere.length} lignes OK` : `${nouveauxAvecMatiereSansId.length} sans matiereId`,
  });

  // V10: Les lignes EMAIL_EXISTANT doivent avoir action=IGNORER
  const emailsExistants = plan.lignes.filter((l: any) => l.verdict === "EMAIL_EXISTANT");
  const emailsExistantsPasIgnorer = emailsExistants.filter((l: any) => l.action !== "IGNORER");
  verifications.push({
    test: "Les lignes EMAIL_EXISTANT ont action=IGNORER",
    passed: emailsExistantsPasIgnorer.length === 0,
    detail: emailsExistantsPasIgnorer.length === 0 ? `${emailsExistants.length} emails existants OK` : `${emailsExistantsPasIgnorer.length} avec mauvaise action`,
  });

  // Afficher les résultats
  console.log();
  let allPassed = true;
  for (const v of verifications) {
    const icon = v.passed ? "✅" : "❌";
    console.log(`   ${icon} ${v.test}: ${v.detail}`);
    if (!v.passed) allPassed = false;
  }

  return allPassed;
}

// ─── Test de l'import réel ────────────────────────────────────────

async function testImport(filePath: string, cookies: string, plan: any): Promise<any> {
  console.log("\n" + "=".repeat(70));
  console.log("PHASE 3: Test de l'import réel (application du plan)");
  console.log("=".repeat(70));

  const fileBuffer = readFileSync(filePath);
  const formData = new FormData();
  const blob = new Blob([fileBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  formData.append("file", blob, "test-enseignants.xlsx");
  formData.append("hash", plan.hash);
  // Aucune décision modifiée — on garde les actions par défaut
  formData.append("decisions", JSON.stringify({}));

  const res = await fetch(`${BASE_URL}/api/import/enseignants`, {
    method: "POST",
    headers: {
      Origin: ORIGIN,
      Cookie: cookies,
    },
    body: formData,
  });

  const data = await res.json();

  if (!res.ok) {
    console.error(`❌ Erreur HTTP ${res.status}:`, data.error);
    return null;
  }

  console.log("\n📊 Résultat de l'import:");
  console.log(`   Total lignes: ${data.summary.totalRows}`);
  console.log(`   Créés:        ${data.summary.created}`);
  console.log(`   Ignorés:      ${data.summary.skipped}`);
  if (data.summary.warnings?.length > 0) {
    console.log(`   ⚠️  Avertissements:`);
    for (const w of data.summary.warnings) {
      console.log(`      • ${w}`);
    }
  }
  if (data.summary.importBatchId) {
    console.log(`   🏷️  Batch ID: ${data.summary.importBatchId}`);
  }

  return data;
}

// ─── Test de réimport (idempotence) ───────────────────────────────

async function testReimport(filePath: string, cookies: string): Promise<any> {
  console.log("\n" + "=".repeat(70));
  console.log("PHASE 4: Test de réimport (idempotence)");
  console.log("=".repeat(70));

  // Refaire l'analyse — les enseignants créés en phase 3 doivent maintenant
  // apparaître comme EMAIL_EXISTANT
  const fileBuffer = readFileSync(filePath);
  const formData = new FormData();
  const blob = new Blob([fileBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  formData.append("file", blob, "test-enseignants.xlsx");

  const res = await fetch(`${BASE_URL}/api/import/enseignants/analyze`, {
    method: "POST",
    headers: {
      Origin: ORIGIN,
      Cookie: cookies,
    },
    body: formData,
  });

  const data = await res.json();

  if (!res.ok) {
    console.error(`❌ Erreur HTTP ${res.status}:`, data.error);
    return null;
  }

  console.log("\n📊 Résumé du réimport:");
  console.log(`   À créer:   ${data.resume.aCreer} (devrait être 0 pour les emails déjà créés)`);
  console.log(`   À ignorer: ${data.resume.aIgnorer}`);

  const emailsExistants = data.lignes.filter((l: any) => l.verdict === "EMAIL_EXISTANT");
  console.log(`   Lignes EMAIL_EXISTANT: ${emailsExistants.length}`);

  if (data.dejaImporte) {
    console.log(`   ✅ Détection d'import antérieur: ${new Date(data.dejaImporte.date).toLocaleString("fr-FR")}`);
  } else {
    console.log(`   ⚠️  Pas de détection d'import antérieur`);
  }

  // Vérifier que les enseignants créés en phase 3 sont maintenant EMAIL_EXISTANT
  const createdEmails = ["ahmed.omar.test@ecolemiriam.com", "fatima.ali.test@ecolemiriam.com", "said.hassan.test@ecolemiriam.com", "amina.yusuf.test@ecolemiriam.com", "omar.mahamoud.test@ecolemiriam.com", "khadija.abdillahi.test@ecolemiriam.com"];
  const nowExistants = emailsExistants.map((l: any) => l.email);
  const tousPresents = createdEmails.every((e) => nowExistants.includes(e));

  console.log(`   ${tousPresents ? "✅" : "❌"} Tous les enseignants créés sont maintenant détectés comme EMAIL_EXISTANT`);

  return { data, tousPresents };
}

// ─── Main ─────────────────────────────────────────────────────────

async function main() {
  console.log("🧪 Test de fiabilité — Import d'enseignants en masse");
  console.log("=".repeat(70));

  // 1. Authentification
  const { cookies } = await login();

  // 2. Créer le fichier Excel de test
  const filePath = await createTestExcel();

  // 3. Tester l'analyse (dry-run)
  const plan = await testAnalyze(filePath, cookies);

  if (!plan) {
    console.error("\n❌ L'analyse a échoué — arrêt des tests.");
    process.exit(1);
  }

  // 4. Vérifications de cohérence
  const coherenceOK = runCoherenceChecks(plan);

  // 5. Test de l'import réel
  const importResult = await testImport(filePath, cookies, plan);

  if (!importResult) {
    console.error("\n❌ L'import a échoué — arrêt des tests.");
    process.exit(1);
  }

  // 6. Test de réimport (idempotence)
  const reimportResult = await testReimport(filePath, cookies);

  // 7. Bilan final
  console.log("\n" + "=".repeat(70));
  console.log("BILAN FINAL");
  console.log("=".repeat(70));

  const importOK = importResult.summary.created > 0;
  const reimportOK = reimportResult?.tousPresents ?? false;

  console.log(`   ${coherenceOK ? "✅" : "❌"} Cohérence du plan d'analyse`);
  console.log(`   ${importOK ? "✅" : "❌"} Import réel (${importResult.summary.created} enseignants créés)`);
  console.log(`   ${reimportOK ? "✅" : "❌"} Idempotence (réimport détecte les doublons)`);

  const allOK = coherenceOK && importOK && reimportOK;
  console.log(`\n${allOK ? "✅ TOUS LES TESTS SONT PASSÉS" : "❌ DES TESTS ONT ÉCHOUÉ"}`);
  console.log(`${"=".repeat(70)}`);

  process.exit(allOK ? 0 : 1);
}

main().catch((err) => {
  console.error("Erreur fatale:", err);
  process.exit(1);
});
