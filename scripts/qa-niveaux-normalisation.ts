/**
 * Vérification rapide du référentiel de niveaux (outil de QA, lecture seule).
 * Usage : npx tsx scripts/qa-niveaux-normalisation.ts
 */
import { normaliserNiveau } from "@/lib/niveau";

const CAS: string[] = [
  "Maternelle", "maternel", "PS", "MS", "GS", "PS/MS", "MS/GS", "petite section",
  "1ère", "1ere", "1er", "1ère année", "1ère A", "1ère année B", "niveau 1ère", "classe de 1ère",
  "2", "2e", "2eme", "2ème", "2ème année", "2ème ANNÉE", "2ème Année B", "3ème Année C", "3eme",
  "4", "5", "6ème", "6eme", "7ème", "8ème", "9ème", "9eme",
  "Seconde", "seconde", "2nde", "2nd", "Première", "premiere", "1ere lycee",
  "Terminale", "terminale", "Tle", "TLE", "terminal",
  "CP", "cp", "CE1", "CE2", "CM1", "CM2",
  "10", "11", "12", "13", "99", "99ème Z", "Zorglub", "", "  ",
];

console.log("saisie".padEnd(18), "→", "normalisé");
console.log("-".repeat(40));
for (const c of CAS) {
  const r = normaliserNiveau(c);
  console.log(JSON.stringify(c).padEnd(18), "→", r ?? "❌ null (refusé)");
}
