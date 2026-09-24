/**
 * Test: démonstration des bugs de matching de colonnes.
 */
import { buildColumnMapping } from "@/lib/import-enseignants";

function test(label: string, headers: string[], expected: Record<string, string>) {
  const result = buildColumnMapping(headers.map((h) => h.toLowerCase()));
  const issues: string[] = [];
  for (const [key, expectedVal] of Object.entries(expected)) {
    if (result[key] !== expectedVal) {
      issues.push(`  ❌ "${key}" → "${result[key]}" (attendu: "${expectedVal}")`);
    } else {
      issues.push(`  ✅ "${key}" → "${result[key]}"`);
    }
  }
  const hasIssues = issues.some((i) => i.includes("❌"));
  console.log(`\n${hasIssues ? "❌" : "✅"} ${label}`);
  console.log(`   Headers: [${headers.join(", ")}]`);
  for (const i of issues) console.log(i);
}

// ─── Bug 1: "Prénom" contient "nom" → match la colonne nom ───
test(
  'Bug 1: "Prénom" avant "Nom" → nom pointe vers Prénom',
  ["Prénom", "Nom", "Email", "Site d'affectation", "Temps"],
  { nom: "nom", email: "email", site: "site d'affectation", tempsPlein: "temps" }
);

// ─── Bug 2: "Site web" match "site" avant "Site d'affectation" ───
test(
  'Bug 2: "Site web" avant "Site d\'affectation" → site pointe vers Site web',
  ["Nom", "Email", "Site web", "Site d'affectation", "Temps"],
  { nom: "nom", email: "email", site: "site d'affectation", tempsPlein: "temps" }
);

// ─── Bug 3: "Type de contrat" ET "Type de salle" → tempsPlein match n'importe lequel ───
test(
  'Bug 3: "Type de salle" match "type" pour tempsPlein',
  ["Nom", "Email", "Site", "Type de salle", "Temps"],
  { tempsPlein: "temps" }
);

// ─── Bug 4: "Hôtel" ou "Atelier" contient "tel" → match téléphone ───
test(
  'Bug 4: "Atelier" contient "tel" → téléphone ne match PAS (retourne "")',
  ["Nom", "Email", "Atelier", "Site", "Temps"],
  { telephone: "" }
);

// ─── Bug 5: "Email professionnel" ET "Email personnel" → premier match ───
test(
  'Bug 5: "Email personnel" avant "Email professionnel" → email prend le premier',
  ["Nom", "Email personnel", "Email professionnel", "Site", "Temps"],
  { email: "email personnel" }
);

// ─── Cas nominal (devrait marcher) ───
test(
  "Cas nominal: colonnes standards",
  ["Nom", "Email", "Téléphone", "Matière", "Site d'affectation", "Temps"],
  { nom: "nom", email: "email", telephone: "téléphone", matiere: "matière", site: "site d'affectation", tempsPlein: "temps" }
);

// ─── Cas: colonnes en anglais ───
test(
  "Cas anglais: Name, Email, Phone, Subject, Campus, Full-time",
  ["Name", "Email", "Phone", "Subject", "Campus", "Full-time"],
  { nom: "name", email: "email", telephone: "phone", matiere: "subject", site: "campus", tempsPlein: "full-time" }
);

// ─── Bug 6: "Nom de famille" ET "Prénom" → nom match "Prénom" (contient "nom") ───
test(
  'Bug 6: "Prénom" avant "Nom de famille" → nom pointe vers Prénom',
  ["Prénom", "Nom de famille", "Email", "Site", "Temps"],
  { nom: "nom de famille" }
);

process.exit(0);
