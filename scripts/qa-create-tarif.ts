import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });

async function main() {
  const tenantId = "cms8kt0b40001zbi3o63y7c5v";

  // Vérifier les niveaux existants dans les classes
  const niveaux = await prisma.classe.findMany({
    where: { tenantId },
    select: { niveau: true },
    distinct: ["niveau"],
  });
  console.log("Niveaux existants:", niveaux.map(n => n.niveau).sort());

  // Créer un tarif pour le niveau "8" (le plus commun)
  const existing = await prisma.tarifNiveau.findFirst({
    where: { tenantId, niveau: "8", annee: "2025-2026" },
  });
  
  if (existing) {
    console.log("Tarif existe déjà:", JSON.stringify(existing, null, 2));
  } else {
    const tarif = await prisma.tarifNiveau.create({
      data: {
        tenantId,
        niveau: "8",
        annee: "2025-2026",
        mensualite: 15000,
        fraisInscription: 50000,
        fraisRenouvellement: 25000,
        fraisCantine: 5000,
        fraisTransport: 3000,
        devise: "DJF",
        nbMois: 10,
        actif: true,
      },
    });
    console.log("Tarif créé:", JSON.stringify(tarif, null, 2));
  }

  await prisma.$disconnect();
}
main();
