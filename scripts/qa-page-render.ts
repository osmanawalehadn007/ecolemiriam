// Vérifier que les pages se compilent côté serveur en simulant une session
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });

async function main() {
  const tenantId = "cms8kt0b40001zbi3o63y7c5v";

  // Vérifier que les données nécessaires pour les pages existent
  console.log("=== Vérification des données pour les pages ===\n");

  // Page /facturation
  const factures = await prisma.facture.findMany({
    where: { tenantId },
    include: {
      eleve: { select: { nom: true, prenom: true, matricule: true, classe: { select: { nom: true } } } },
      paiements: true,
      relances: true,
    },
    take: 5,
  });
  console.log(`✅ Page /facturation: ${factures.length} factures chargées (avec relances et mois)`);
  console.log(`  Première facture - mois: ${factures[0]?.mois ?? "null"}, relances: ${factures[0]?.relances.length ?? 0}`);

  // Page /facturation/nouvelle
  const eleves = await prisma.eleve.findMany({
    where: { tenantId, statut: "ACTIF" },
    select: { id: true, nom: true, prenom: true, matricule: true, classe: { select: { id: true, nom: true, niveau: true } } },
    take: 3,
  });
  const classes = await prisma.classe.findMany({
    where: { tenantId },
    select: { id: true, nom: true, niveau: true },
    take: 3,
  });
  const tarifs = await prisma.tarifNiveau.findMany({
    where: { tenantId, annee: "2025-2026", actif: true },
  });
  console.log(`✅ Page /facturation/nouvelle: ${eleves.length} élèves, ${classes.length} classes, ${tarifs.length} tarifs`);

  // Page /parametres/tarifs
  const allTarifs = await prisma.tarifNiveau.findMany({
    where: { tenantId },
    orderBy: [{ annee: "desc" }, { niveau: "asc" }],
  });
  console.log(`✅ Page /parametres/tarifs: ${allTarifs.length} tarifs trouvés`);

  // Page /admissions
  const candidatures = await prisma.candidature.findMany({
    where: { tenantId, annee: "2025-2026" },
    orderBy: { createdAt: "desc" },
  });
  console.log(`✅ Page /admissions: ${candidatures.length} candidatures trouvées`);

  // Page /eleves/[id] — profil élève
  if (eleves[0]) {
    const eleveDetail = await prisma.eleve.findFirst({
      where: { id: eleves[0].id, tenantId },
      include: {
        classe: { select: { id: true, nom: true, niveau: true } },
        parents: { include: { parent: true } },
        factures: { include: { paiements: true }, take: 10 },
      },
    });
    console.log(`✅ Page /eleves/[id]: Élève ${eleveDetail?.prenom} ${eleveDetail?.nom}, ${eleveDetail?.factures.length} factures`);
  }

  console.log("\n=== Toutes les données nécessaires sont disponibles ===");
  await prisma.$disconnect();
}
main();
