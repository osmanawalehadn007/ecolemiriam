// Test des permissions RBAC pour le comptable
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });

// Répliquer la logique RBAC
const ACCOUNTANT_PERMS = [
  "finance:*", "rh:*", "eleves:read", "parents:read", "inventaire:*",
  "analytics:read", "messages:*", "rapports:read",
  "admissions:read", "admissions:write",
];

function roleHasPermission(perms: string[], permission: string): boolean {
  if (perms.includes("*")) return true;
  if (perms.includes(permission)) return true;
  const moduleName = permission.split(":")[0];
  if (perms.includes(`${moduleName}:*`)) return true;
  return false;
}

async function main() {
  console.log("=== TEST QA RBAC — Comptable ===\n");

  // Tests de permissions
  const tests = [
    { perm: "finance:read", expected: true, desc: "Lire la facturation" },
    { perm: "finance:write", expected: true, desc: "Créer/modifier factures" },
    { perm: "admissions:read", expected: true, desc: "Lire les admissions" },
    { perm: "admissions:write", expected: true, desc: "Modifier les candidatures" },
    { perm: "eleves:read", expected: true, desc: "Lire les élèves" },
    { perm: "eleves:write", expected: false, desc: "Modifier les élèves (interdit)" },
    { perm: "parametres:read", expected: false, desc: "Lire les paramètres (interdit)" },
    { perm: "notes:read", expected: false, desc: "Lire les notes (interdit)" },
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    const result = roleHasPermission(ACCOUNTANT_PERMS, test.perm);
    const status = result === test.expected ? "✅ PASS" : "❌ FAIL";
    if (result === test.expected) passed++;
    else failed++;
    console.log(`${status} — ${test.desc}: ${test.perm} → ${result} (attendu: ${test.expected})`);
  }

  console.log(`\n=== Résultat: ${passed}/${tests.length} tests passés, ${failed} échoués ===`);

  // Vérifier que le tarif créé est bien accessible
  const tarif = await prisma.tarifNiveau.findFirst({
    where: { tenantId: "cms8kt0b40001zbi3o63y7c5v", niveau: "8", annee: "2025-2026", actif: true },
  });
  console.log(`\n=== Tarif niveau 8: ${tarif ? "✅ Trouvé" : "❌ Non trouvé"} ===`);
  if (tarif) {
    console.log(`  Mensualité: ${tarif.mensualite} ${tarif.devise}`);
    console.log(`  Frais inscription: ${tarif.fraisInscription} ${tarif.devise}`);
  }

  // Vérifier que le champ mois existe sur le modèle Facture
  const factureWithMois = await prisma.facture.findFirst({
    where: { tenantId: "cms8kt0b40001zbi3o63y7c5v" },
    select: { mois: true },
  });
  console.log(`\n=== Champ mois sur Facture: ${factureWithMois ? "✅ Accessible" : "❌ Non accessible"} ===`);

  // Vérifier la candidature
  const candidature = await prisma.candidature.findFirst({
    where: { tenantId: "cms8kt0b40001zbi3o63y7c5v", nom: "TEST QA" },
  });
  console.log(`\n=== Candidature test: ${candidature ? "✅ Trouvée (statut: " + candidature.statut + ")" : "❌ Non trouvée"} ===`);

  await prisma.$disconnect();
}
main();
