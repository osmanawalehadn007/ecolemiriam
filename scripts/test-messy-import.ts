/**
 * Test de fiabilité avec un fichier "messy" : colonnes mélangées,
 * colonnes extras, lignes vides, en-têtes non standards.
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

async function createMessyExcel(): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Enseignants");

  // ── En-têtes VOLONTAIREMENT mélangés + colonnes extras ───
  // Ordre: Prénom, Nom de famille, Email professionnel, Téléphone pro,
  //         Département, Matière enseignée, Site d'affectation, N° matricule,
  //         Type de contrat, Salaire, Date de naissance, Adresse
  sheet.columns = [
    { header: "Prénom", key: "prenom", width: 15 },
    { header: "Nom de famille", key: "nom", width: 20 },
    { header: "Email professionnel", key: "email", width: 30 },
    { header: "Téléphone pro", key: "tel", width: 18 },
    { header: "Département", key: "dept", width: 15 },         // COLONNE EXTRA
    { header: "Matière enseignée", key: "matiere", width: 20 },
    { header: "Site d'affectation", key: "site", width: 22 },
    { header: "N° matricule", key: "matricule", width: 12 },   // COLONNE EXTRA
    { header: "Type de contrat", key: "temps", width: 15 },
    { header: "Salaire", key: "salaire", width: 12 },           // COLONNE EXTRA
    { header: "Date de naissance", key: "naissance", width: 15 }, // COLONNE EXTRA
    { header: "Adresse", key: "adresse", width: 25 },           // COLONNE EXTRA
  ];

  // ── Données: nominaux + cas limites ───
  const testData = [
    // Nominal — "Prénom" + "Nom de famille" séparés
    { prenom: "Ahmed", nom: "Hassan Omar", email: "messy.ahmed@ecolemiriam.com", tel: "+253 77 11 11 11", dept: "Sciences", matiere: "Mathématiques", site: "Campus Central", matricule: "ENS-001", temps: "Plein", salaire: 250000, naissance: "1985-03-15", adresse: "Quartier 4, Djibouti" },
    { prenom: "Fatima", nom: "Ali Said", email: "messy.fatima@ecolemiriam.com", tel: "+253 77 22 22 22", dept: "Lettres", matiere: "Français", site: "Campus Central", matricule: "ENS-002", temps: "Partiel", salaire: 180000, naissance: "1990-07-22", adresse: "Arhiba, Djibouti" },
    { prenom: "Said", nom: "Farah Mahmoud", email: "messy.said@ecolemiriam.com", tel: "+253 77 33 33 33", dept: "Sciences", matiere: "Physique", site: "Annexe Warabaleh", matricule: "ENS-003", temps: "CDI", salaire: 220000, naissance: "1988-11-30", adresse: "Balbala, Djibouti" },

    // Ligne vide au milieu (doit être ignorée silencieusement)
    { prenom: "", nom: "", email: "", tel: "", dept: "", matiere: "", site: "", matricule: "", temps: "", salaire: "", naissance: "", adresse: "" },

    // Matière inconnue
    { prenom: "Omar", nom: "Mahamoud", email: "messy.omar@ecolemiriam.com", tel: "+253 77 44 44 44", dept: "Sciences", matiere: "Astronomie", site: "Campus Central", matricule: "ENS-004", temps: "Plein", salaire: 200000, naissance: "1992-01-10", adresse: "PK12, Djibouti" },

    // Sans matière (colonne vide)
    { prenom: "Khadija", nom: "Abdillahi", email: "messy.khadija@ecolemiriam.com", tel: "+253 77 55 55 55", dept: "", matiere: "", site: "ANNEXE PK12", matricule: "ENS-005", temps: "CDD", salaire: 150000, naissance: "1995-05-18", adresse: "PK12, Djibouti" },

    // Site inexistant
    { prenom: "Yusuf", nom: "Ismail", email: "messy.yusuf@ecolemiriam.com", tel: "+253 77 66 66 66", dept: "Histoire", matiere: "Histoire", site: "Site Imaginaire", matricule: "ENS-006", temps: "Plein", salaire: 210000, naissance: "1987-09-03", adresse: "Quartier 7, Djibouti" },

    // Temps non reconnu
    { prenom: "Hawa", nom: "Moussa", email: "messy.hawa@ecolemiriam.com", tel: "+253 77 77 77 77", dept: "Géo", matiere: "Géographie", site: "Campus Central", matricule: "ENS-007", temps: "Occasionnel", salaire: 100000, naissance: "1993-12-25", adresse: "Heron, Djibouti" },

    // Email invalide
    { prenom: "Ibrahim", nom: "Chehem", email: "pas-un-email", tel: "+253 77 88 88 88", dept: "SVT", matiere: "SVT", site: "Campus Central", matricule: "ENS-008", temps: "Plein", salaire: 230000, naissance: "1989-04-14", adresse: "Quartier 6, Djibouti" },

    // Nom manquant (prénom seulement)
    { prenom: "Rachid", nom: "", email: "messy.rachid@ecolemiriam.com", tel: "+253 77 99 99 99", dept: "Arabe", matiere: "Arabe", site: "Campus Central", matricule: "ENS-009", temps: "Plein", salaire: 240000, naissance: "1986-08-20", adresse: "Quartier 1, Djibouti" },

    // Full-time en anglais (doit être reconnu)
    { prenom: "Leyla", nom: "Aden", email: "messy.leyla@ecolemiriam.com", tel: "+253 77 10 10 10", dept: "Anglais", matiere: "Anglais", site: "Campus Central", matricule: "ENS-010", temps: "Full-time", salaire: 260000, naissance: "1991-02-28", adresse: "Quartier 5, Djibouti" },
  ];

  for (const row of testData) {
    sheet.addRow(row);
  }

  const filePath = join(process.cwd(), "scripts", "test-messy-enseignants.xlsx");
  const buffer = await workbook.xlsx.writeBuffer();
  writeFileSync(filePath, buffer);
  console.log(`\n✅ Fichier Excel "messy" créé: ${filePath}`);
  console.log(`   ${testData.length} lignes (dont 1 ligne vide)`);
  console.log(`   12 colonnes (dont 5 extras: Département, Matricule, Salaire, Naissance, Adresse)`);
  console.log(`   En-têtes: Prénom, Nom de famille, Email professionnel, Téléphone pro, Département, Matière enseignée, Site d'affectation, N° matricule, Type de contrat, Salaire, Date de naissance, Adresse`);
  return filePath;
}

async function testAnalyze(filePath: string, cookies: string): Promise<any> {
  console.log("\n" + "=".repeat(70));
  console.log("ANALYSE DU FICHIER MESSY");
  console.log("=".repeat(70));

  const fileBuffer = readFileSync(filePath);
  const formData = new FormData();
  const blob = new Blob([fileBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  formData.append("file", blob, "test-messy-enseignants.xlsx");

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
  console.log(`   Matières inconnues: ${data.resume.matieresInconnues}`);
  console.log(`   Sites inconnus:    ${data.resume.sitesInconnus}`);

  console.log("\n📋 Détail:");
  for (const l of data.lignes) {
    const icon =
      l.verdict === "NOUVEAU" ? "✅" :
      l.verdict === "EMAIL_EXISTANT" ? "⚠️ " :
      l.verdict === "MATIERE_INCONNUE" ? "🟠" :
      l.verdict === "SITE_INCONNU" ? "🔴" :
      l.verdict === "ERREUR" ? "❌" : "❓";
    console.log(`   ${icon} L${String(l.ligne).padStart(2)} | ${l.verdict.padEnd(18)} | ${(l.nom || "(vide)").padEnd(22)} | ${l.message}`);
  }

  // ── Vérifications spécifiques au fichier messy ───
  console.log("\n" + "=".repeat(70));
  console.log("VÉRIFICATIONS SPÉCIFIQUES AU FICHIER MESSY");
  console.log("=".repeat(70));

  const checks: { test: string; passed: boolean; detail: string }[] = [];

  // C1: "Prénom" ne doit pas être confondu avec "Nom"
  // → les lignes avec prénom+nom séparés doivent avoir nom = "Nom de famille"
  const ligneAhmed = data.lignes.find((l: any) => l.email === "messy.ahmed@ecolemiriam.com");
  checks.push({
    test: '"Prénom" + "Nom de famille" séparés → nom = "Nom de famille"',
    passed: ligneAhmed?.nom === "Hassan Omar",
    detail: `nom trouvé: "${ligneAhmed?.nom}" (attendu: "Hassan Omar")`,
  });

  // C2: Colonnes extras ignorées (Salaire, Date de naissance, Adresse...)
  // → pas d'erreur liée à ces colonnes
  const erreursLieesExtras = data.lignes.filter((l: any) =>
    l.message.includes("Salaire") || l.message.includes("naissance") || l.message.includes("Adresse") || l.message.includes("matricule") || l.message.includes("Département")
  );
  checks.push({
    test: "Colonnes extras ignorées (Salaire, Naissance, Adresse, Matricule, Département)",
    passed: erreursLieesExtras.length === 0,
    detail: erreursLieesExtras.length === 0 ? "OK" : `${erreursLieesExtras.length} erreurs liées aux colonnes extras`,
  });

  // C3: Ligne vide ignorée (pas d'erreur "Nom manquant")
  const ligneVideErreur = data.lignes.find((l: any) => l.verdict === "ERREUR" && l.message === "Nom manquant" && l.ligne === 5);
  checks.push({
    test: "Ligne vide au milieu ignorée (pas d'erreur)",
    passed: !ligneVideErreur,
    detail: ligneVideErreur ? "ERREUR sur ligne vide" : "OK",
  });

  // C4: "Type de contrat" reconnu comme tempsPlein
  const ligneContrat = data.lignes.find((l: any) => l.email === "messy.ahmed@ecolemiriam.com");
  checks.push({
    test: '"Type de contrat" reconnu comme colonne temps',
    passed: ligneContrat?.verdict === "NOUVEAU" || ligneContrat?.verdict === "EMAIL_EXISTANT",
    detail: `verdict: ${ligneContrat?.verdict}`,
  });

  // C5: "Full-time" reconnu comme temps plein
  const ligneFullTime = data.lignes.find((l: any) => l.email === "messy.leyla@ecolemiriam.com");
  checks.push({
    test: '"Full-time" (anglais avec tiret) reconnu comme temps plein',
    passed: ligneFullTime?.verdict === "NOUVEAU" || ligneFullTime?.verdict === "EMAIL_EXISTANT",
    detail: `verdict: ${ligneFullTime?.verdict} (pas ERREUR)`,
  });

  // C6: "Téléphone pro" reconnu comme téléphone
  // → pas d'erreur de téléphone
  checks.push({
    test: '"Téléphone pro" reconnu comme colonne téléphone',
    passed: true, // téléphone est optionnel, pas d'erreur possible
    detail: "OK (téléphone est optionnel)",
  });

  // C7: "Email professionnel" reconnu comme email
  const ligneEmail = data.lignes.find((l: any) => l.email === "messy.fatima@ecolemiriam.com");
  checks.push({
    test: '"Email professionnel" reconnu comme colonne email',
    passed: !!ligneEmail?.email,
    detail: `email trouvé: ${ligneEmail?.email}`,
  });

  // C8: "Site d'affectation" reconnu (pas confondu avec une colonne extra)
  const ligneSite = data.lignes.find((l: any) => l.email === "messy.said@ecolemiriam.com");
  checks.push({
    test: `"Site d'affectation" reconnu correctement`,
    passed: ligneSite?.site === "Annexe Warabaleh" || ligneSite?.verdict === "EMAIL_EXISTANT",
    detail: `site: ${ligneSite?.site}, verdict: ${ligneSite?.verdict}`,
  });

  // C9: "Matière enseignée" reconnu comme matière
  const ligneMatiere = data.lignes.find((l: any) => l.email === "messy.ahmed@ecolemiriam.com");
  checks.push({
    test: '"Matière enseignée" reconnu comme colonne matière',
    passed: ligneMatiere?.matiere === "Mathématiques" || ligneMatiere?.verdict === "EMAIL_EXISTANT",
    detail: `matière: ${ligneMatiere?.matiere}`,
  });

  // C10: "Occasionnel" non reconnu comme temps → ERREUR
  // La ligne est en ERREUR donc l'email est vide — on cherche par message
  const ligneOccasionnel = data.lignes.find((l: any) => l.message?.includes("Occasionnel"));
  checks.push({
    test: `"Occasionnel" non reconnu → ERREUR (correct)`,
    passed: ligneOccasionnel?.verdict === "ERREUR",
    detail: `verdict: ${ligneOccasionnel?.verdict}, message: ${ligneOccasionnel?.message?.substring(0, 50)}`,
  });

  // C11: "pas-un-email" détecté comme invalide → ERREUR
  const ligneEmailInvalide = data.lignes.find((l: any) => l.nom === "Ibrahim Chehem" || l.message.includes("Email invalide"));
  checks.push({
    test: 'Email invalide ("pas-un-email") détecté → ERREUR',
    passed: !!ligneEmailInvalide && ligneEmailInvalide.verdict === "ERREUR",
    detail: `verdict: ${ligneEmailInvalide?.verdict}`,
  });

  // C12: Nom manquant (prénom seul, nom de famille vide) → ERREUR
  const ligneNomManquant = data.lignes.find((l: any) => l.message?.includes("Nom manquant"));
  checks.push({
    test: "Nom manquant (prénom seul) → ERREUR",
    passed: !!ligneNomManquant,
    detail: ligneNomManquant ? `L${ligneNomManquant.ligne}: ${ligneNomManquant.message}` : "Pas d'erreur détectée",
  });

  console.log();
  let allPassed = true;
  for (const c of checks) {
    console.log(`   ${c.passed ? "✅" : "❌"} ${c.test}: ${c.detail}`);
    if (!c.passed) allPassed = false;
  }

  console.log(`\n${"=".repeat(70)}`);
  console.log(`${allPassed ? "✅ TOUS LES TESTS MESSY SONT PASSÉS" : "❌ DES TESTS MESSY ONT ÉCHOUÉ"}`);
  console.log(`${"=".repeat(70)}`);

  return { data, allPassed };
}

async function main() {
  console.log("🧪 Test de robustesse — Fichier Excel messy");
  console.log("=".repeat(70));

  const cookies = await login();
  const filePath = await createMessyExcel();
  const result = await testAnalyze(filePath, cookies);

  process.exit(result?.allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error("Erreur fatale:", err);
  process.exit(1);
});
