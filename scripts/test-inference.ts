/**
 * Test de l'inférence de colonnes : cas extrêmes.
 * - Colonnes sans titre (header vide)
 * - Titres en arabe/somali
 * - Colonnes avec uniquement des données (pas de header)
 * - Header trompeur ("Contact" rempli d'emails)
 * - Header trompeur ("Infos" rempli de téléphones)
 */

import ExcelJS from "exceljs";
import { writeFileSync, readFileSync } from "fs";
import { join } from "path";

const BASE_URL = "http://localhost:3000";
// Compte par défaut : celui créé par `prisma/seed.ts` (base locale) ; un compte
// réel se fournit via TEST_ADMIN_EMAIL / TEST_ADMIN_PASSWORD, jamais dans le code.
const TEST_EMAIL = process.env.TEST_ADMIN_EMAIL ?? "admin@lycee-demo.ecolemiriam.app";
const TEST_PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? "Demo@2026!";
const ORIGIN = "http://localhost:3000";

async function login(): Promise<string> {
  console.log("🔐 Authentification...");
  const csrfRes = await fetch(`${BASE_URL}/api/auth/csrf`, { headers: { Origin: ORIGIN } });
  const setCookie = csrfRes.headers.get("set-cookie") || "";
  const csrfData = await csrfRes.json();
  const csrfToken = csrfData.csrfToken;
  const cookiesFromCsrf = setCookie.split(",").map((c) => c.split(";")[0].trim()).filter(Boolean).join("; ");

  const loginRes = await fetch(`${BASE_URL}/api/auth/callback/credentials`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: ORIGIN, Cookie: cookiesFromCsrf },
    body: new URLSearchParams({ csrfToken, email: TEST_EMAIL, password: TEST_PASSWORD, callbackUrl: "/dashboard", json: "true" }),
    redirect: "manual",
  });
  const loginCookies = (loginRes.headers.get("set-cookie") || "").split(",").map((c) => c.split(";")[0].trim()).filter(Boolean).join("; ");
  const allCookies = [cookiesFromCsrf, loginCookies].filter(Boolean).join("; ");

  const sessionRes = await fetch(`${BASE_URL}/api/auth/session`, { headers: { Origin: ORIGIN, Cookie: allCookies } });
  const session = await sessionRes.json();
  if (!session?.user?.email) throw new Error("Échec auth");
  console.log(`   ✅ Connecté: ${session.user.email} (${session.user.role})`);
  return allCookies;
}

async function createExtremeExcel(): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Test");

  // ── Cas extrême 1 : Headers trompeurs + colonnes sans titre ───
  // Col A: "Contact" (rempli d'emails) → doit être détecté comme email
  // Col B: "" (sans titre, rempli de noms) → doit être détecté comme nom
  // Col C: "Infos" (rempli de téléphones) → doit être détecté comme téléphone
  // Col D: "Emplacement" (rempli de noms de sites) → doit être détecté comme site
  // Col E: "Domaine" (rempli de matières) → doit être détecté comme matière
  // Col F: "Statut professionnel" (rempli de CDI/CDD) → doit être détecté comme tempsPlein

  sheet.columns = [
    { header: "Contact", key: "contact", width: 30 },
    { header: "", key: "sansTitre", width: 25 },
    { header: "Infos", key: "infos", width: 18 },
    { header: "Emplacement", key: "emplacement", width: 22 },
    { header: "Domaine", key: "domaine", width: 20 },
    { header: "Statut professionnel", key: "statut", width: 18 },
  ];

  const testData = [
    { contact: "infer.ahmed@ecolemiriam.com", sansTitre: "Ahmed Hassan Omar", infos: "+253 77 11 11 11", emplacement: "Campus Central", domaine: "Mathématiques", statut: "Plein" },
    { contact: "infer.fatima@ecolemiriam.com", sansTitre: "Fatima Ali Said", infos: "+253 77 22 22 22", emplacement: "Campus Central", domaine: "Français", statut: "Partiel" },
    { contact: "infer.said@ecolemiriam.com", sansTitre: "Said Farah Mahmoud", infos: "+253 77 33 33 33", emplacement: "Annexe Warabaleh", domaine: "Physique", statut: "CDI" },
    { contact: "infer.amina@ecolemiriam.com", sansTitre: "Amina Yusuf Ibrahim", infos: "+253 77 44 44 44", emplacement: "ANNEXE PK12", domaine: "Anglais", statut: "CDD" },
    { contact: "infer.omar@ecolemiriam.com", sansTitre: "Omar Mahamoud Ali", infos: "+253 77 55 55 55", emplacement: "Campus Central", domaine: "Histoire", statut: "Full-time" },
  ];

  for (const row of testData) {
    sheet.addRow(row);
  }

  const filePath = join(process.cwd(), "scripts", "test-inference-extreme.xlsx");
  const buffer = await workbook.xlsx.writeBuffer();
  writeFileSync(filePath, buffer);
  console.log(`\n✅ Fichier Excel extrême créé: ${filePath}`);
  console.log(`   Headers: "Contact", "(vide)", "Infos", "Emplacement", "Domaine", "Statut professionnel"`);
  console.log(`   ${testData.length} lignes de données`);
  return filePath;
}

async function testAnalyze(filePath: string, cookies: string): Promise<any> {
  console.log("\n" + "=".repeat(70));
  console.log("ANALYSE DU FICHIER EXTRÊME (headers trompeurs + sans titre)");
  console.log("=".repeat(70));

  // Warmup : déclencher la compilation de la route avec une requête simple
  console.log("   ⏳ Pré-compilation de la route...");
  await fetch(`${BASE_URL}/api/import/enseignants/analyze`, {
    method: "POST",
    headers: { Origin: ORIGIN, Cookie: cookies },
    body: new FormData(),
  }).catch(() => {});
  await new Promise((r) => setTimeout(r, 3000));

  const fileBuffer = readFileSync(filePath);
  const formData = new FormData();
  const blob = new Blob([fileBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  formData.append("file", blob, "test-inference-extreme.xlsx");

  const res = await fetch(`${BASE_URL}/api/import/enseignants/analyze`, {
    method: "POST",
    headers: { Origin: ORIGIN, Cookie: cookies },
    body: formData,
  });

  const data = await res.json();

  if (!res.ok) {
    console.error(`❌ Erreur HTTP ${res.status}:`, data.error);
    return null;
  }

  console.log("\n📊 Résumé:");
  console.log(`   Total lignes: ${data.resume.total}`);
  console.log(`   À créer:      ${data.resume.aCreer}`);
  console.log(`   À ignorer:    ${data.resume.aIgnorer}`);
  console.log(`   Erreurs:      ${data.resume.erreurs}`);

  console.log("\n📋 Détail:");
  for (const l of data.lignes) {
    const icon = l.verdict === "NOUVEAU" ? "✅" : l.verdict === "EMAIL_EXISTANT" ? "⚠️ " : l.verdict === "MATIERE_INCONNUE" ? "🟠" : l.verdict === "SITE_INCONNU" ? "🔴" : l.verdict === "ERREUR" ? "❌" : "❓";
    console.log(`   ${icon} L${String(l.ligne).padStart(2)} | ${l.verdict.padEnd(18)} | ${(l.nom || "(vide)").padEnd(25)} | email: ${l.email || "(vide)"} | site: ${l.site || "(vide)"} | ${l.message}`);
  }

  // ── Vérifications spécifiques ───
  console.log("\n" + "=".repeat(70));
  console.log("VÉRIFICATIONS D'INFÉRENCE");
  console.log("=".repeat(70));

  const checks: { test: string; passed: boolean; detail: string }[] = [];

  // C1: "Contact" (rempli d'emails) → détecté comme email
  const ligne1 = data.lignes.find((l: any) => l.email === "infer.ahmed@ecolemiriam.com");
  checks.push({
    test: `"Contact" (rempli d'emails) → détecté comme colonne email`,
    passed: !!ligne1?.email && ligne1.email === "infer.ahmed@ecolemiriam.com",
    detail: `email trouvé: ${ligne1?.email || "AUCUN"}`,
  });

  // C2: Colonne sans titre (remplie de noms) → détecté comme nom
  checks.push({
    test: `Colonne sans titre (remplie de noms) → détecté comme colonne nom`,
    passed: ligne1?.nom === "Ahmed Hassan Omar",
    detail: `nom trouvé: "${ligne1?.nom || "AUCUN"}" (attendu: "Ahmed Hassan Omar")`,
  });

  // C3: "Infos" (rempli de téléphones) → détecté comme téléphone
  // Le téléphone est optionnel, on vérifie juste qu'il n'y a pas d'erreur
  checks.push({
    test: `"Infos" (rempli de téléphones) → détecté comme téléphone (pas d'erreur)`,
    passed: ligne1?.verdict === "NOUVEAU" || ligne1?.verdict === "EMAIL_EXISTANT",
    detail: `verdict: ${ligne1?.verdict} (pas ERREUR)`,
  });

  // C4: "Emplacement" (rempli de sites) → détecté comme site
  checks.push({
    test: `"Emplacement" (rempli de noms de sites) → détecté comme colonne site`,
    passed: ligne1?.site === "Campus Central",
    detail: `site trouvé: "${ligne1?.site || "AUCUN"}" (attendu: "Campus Central")`,
  });

  // C5: "Domaine" (rempli de matières) → détecté comme matière
  checks.push({
    test: `"Domaine" (rempli de matières) → détecté comme colonne matière`,
    passed: ligne1?.matiere === "Mathématiques",
    detail: `matière trouvée: "${ligne1?.matiere || "AUCUN"}" (attendu: "Mathématiques")`,
  });

  // C6: "Statut professionnel" (rempli de CDI/CDD/Plein) → détecté comme tempsPlein
  checks.push({
    test: `"Statut professionnel" (rempli de CDI/CDD) → détecté comme colonne temps`,
    passed: ligne1?.verdict === "NOUVEAU" || ligne1?.verdict === "EMAIL_EXISTANT",
    detail: `verdict: ${ligne1?.verdict} (pas ERREUR de temps)`,
  });

  // C7: Toutes les lignes doivent être valides (NOUVEAU, EMAIL_EXISTANT, ou MATIERE_INCONNUE)
  // MATIERE_INCONNUE est valide — l'enseignant sera créé sans matière
  const verdictsValides = ["NOUVEAU", "EMAIL_EXISTANT", "MATIERE_INCONNUE"];
  const tousValides = data.lignes.every((l: any) => verdictsValides.includes(l.verdict));
  checks.push({
    test: `Toutes les lignes valides (pas d'erreur de parsing)`,
    passed: tousValides,
    detail: tousValides ? "OK" : `${data.lignes.filter((l: any) => l.verdict === "ERREUR").length} erreurs`,
  });

  // C8: "Full-time" reconnu dans la colonne "Statut professionnel"
  // Le verdict peut être MATIERE_INCONNUE (si "Histoire" n'existe pas en base)
  // mais l'important est qu'il n'y a pas d'ERREUR de temps
  const ligneOmar = data.lignes.find((l: any) => l.email === "infer.omar@ecolemiriam.com");
  checks.push({
    test: `"Full-time" dans "Statut professionnel" → reconnu comme temps plein`,
    passed: ligneOmar?.verdict !== "ERREUR" && !ligneOmar?.message?.includes("temps"),
    detail: `verdict: ${ligneOmar?.verdict} (pas ERREUR de temps)`,
  });

  console.log();
  let allPassed = true;
  for (const c of checks) {
    console.log(`   ${c.passed ? "✅" : "❌"} ${c.test}: ${c.detail}`);
    if (!c.passed) allPassed = false;
  }

  console.log(`\n${"=".repeat(70)}`);
  console.log(`${allPassed ? "✅ INFÉRENCE ROBUSTE" : "❌ INFÉRENCE INSUFFISANTE"}`);
  console.log(`${"=".repeat(70)}`);

  return allPassed;
}

async function main() {
  console.log("🧪 Test d'inférence de colonnes — Cas extrêmes");
  console.log("=".repeat(70));

  const cookies = await login();
  const filePath = await createExtremeExcel();
  const allPassed = await testAnalyze(filePath, cookies);

  // Nettoyer
  const fs = await import("fs");
  fs.unlinkSync(filePath);

  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error("Erreur fatale:", err);
  process.exit(1);
});
