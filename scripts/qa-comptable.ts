import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });

async function main() {
  const tenantId = "cms8kt0b40001zbi3o63y7c5v";

  // 1. Vérifier l'utilisateur comptable
  const comptable = await prisma.user.findUnique({
    where: { email: "comptable.test@ecolemiriam.com" },
    select: { id: true, email: true, role: true, tenantId: true, isActive: true },
  });
  console.log("=== Comptable ===");
  console.log(JSON.stringify(comptable, null, 2));

  // 2. Vérifier les permissions RBAC
  const { ROLE_PERMISSIONS, roleHasPermission } = await import("./../src/lib/rbac.ts").catch(() => ({ ROLE_PERMISSIONS: {}, roleHasPermission: () => false }));
  
  // 3. Vérifier qu'il y a des élèves pour tester
  const eleves = await prisma.eleve.findMany({
    where: { tenantId, statut: "ACTIF" },
    select: { id: true, nom: true, prenom: true, matricule: true, classe: { select: { id: true, nom: true, niveau: true } } },
    take: 3,
  });
  console.log("\n=== Élèves pour test ===");
  console.log(JSON.stringify(eleves, null, 2));

  // 4. Vérifier les tarifs existants
  const tarifs = await prisma.tarifNiveau.findMany({
    where: { tenantId, actif: true },
    select: { id: true, niveau: true, annee: true, mensualite: true, fraisInscription: true, devise: true },
  });
  console.log("\n=== Tarifs existants ===");
  console.log(JSON.stringify(tarifs, null, 2));

  // 5. Vérifier les factures existantes
  const factures = await prisma.facture.findMany({
    where: { tenantId },
    select: { id: true, numero: true, mois: true, statut: true, montant: true, libelle: true },
    take: 5,
  });
  console.log("\n=== Factures (5 dernières) ===");
  console.log(JSON.stringify(factures, null, 2));

  // 6. Vérifier les candidatures
  const candidatures = await prisma.candidature.findMany({
    where: { tenantId },
    select: { id: true, nom: true, prenom: true, statut: true },
    take: 3,
  });
  console.log("\n=== Candidatures ===");
  console.log(JSON.stringify(candidatures, null, 2));

  // 7. Vérifier le champ mois sur les factures
  const facturesAvecMois = await prisma.facture.count({
    where: { tenantId, mois: { not: null } },
  });
  console.log("\n=== Factures avec mois ===");
  console.log(`${facturesAvecMois} factures ont le champ mois rempli`);

  await prisma.$disconnect();
}
main();
