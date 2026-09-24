import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });

async function main() {
  const tenantId = "cms8kt0b40001zbi3o63y7c5v";

  const existing = await prisma.candidature.findFirst({
    where: { tenantId, nom: "TEST QA", prenom: "Eleve" },
  });

  if (existing) {
    console.log("Candidature existe déjà:", JSON.stringify({ id: existing.id, statut: existing.statut }, null, 2));
  } else {
    const candidature = await prisma.candidature.create({
      data: {
        tenantId,
        nom: "TEST QA",
        prenom: "Eleve",
        dateNaissance: new Date("2010-05-15"),
        sexe: "M",
        classeVoulue: "8ème",
        annee: "2025-2026",
        parentNom: "PARENT TEST",
        parentPrenom: "Tuteur",
        parentPhone: "+253 77 123 456",
        parentLien: "PERE",
        statut: "SOUMISE",
      },
    });
    console.log("Candidature créée:", JSON.stringify({ id: candidature.id, statut: candidature.statut }, null, 2));
  }

  await prisma.$disconnect();
}
main();
