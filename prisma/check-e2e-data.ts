import { PrismaClient } from "@prisma/client";

// Vérification des données e2e — exécuter : npx tsx prisma/check-e2e-data.ts
// Sortie 0 si le tree contient tout ce que la suite e2e attend.
const prisma = new PrismaClient();

async function main() {
  const emailAdmin = "admin@lycee-demo.ecolemiriam.app";
  const emailProfA = "enseignant@lycee-demo.ecolemiriam.app";
  const emailProfB = "enseignant2@lycee-demo.ecolemiriam.app";
  const emailParent = "parent@lycee-demo.ecolemiriam.app";

  console.log("Vérification des données e2e…");
  const checks: { libelle: string; ok: boolean }[] = [];

  const addUserCheck = async (libelle: string, email: string, role?: string) => {
    const u = await prisma.user.findFirst({ where: { email }, include: { userSites: true } });
    checks.push({ libelle: `${libelle} (${email})`, ok: !!u && (!!role ? u.role === role : true) });
  };
  await addUserCheck("Admin", emailAdmin, "ADMIN");
  await addUserCheck("Prof A", emailProfA, "TEACHER");
  await addUserCheck("Prof B", emailProfB, "TEACHER");
  await addUserCheck("Parent", emailParent);

  const tenant = await prisma.tenant.findFirst();
  if (!tenant) {
    console.error("Tenant introuvable");
    process.exit(1);
  }
  const tree = await prisma.site.findMany({ where: { tenantId: tenant.id, actif: true } });
  checks.push({ libelle: "2 sites", ok: tree.length >= 2 });

  const profA = await prisma.user.findFirst({ where: { email: emailProfA } });
  const eleveProfA = profA
    ? await prisma.eleve.findFirst({
        where: { id: "eleve-tle-a-1-demo", classe: { profPrincipalId: profA.id } },
      })
    : null;
  checks.push({ libelle: "Élève du prof A", ok: !!eleveProfA });

  const eleveHorsPerimetre = await prisma.eleve.findFirst({ where: { id: "eleve-2nde-c-1-demo" } });
  checks.push({ libelle: "Élève hors périmètre", ok: !!eleveHorsPerimetre });

  const eleveSiteB = await prisma.eleve.findFirst({ where: { id: "eleve-1ere-b-1-demo" } });
  checks.push({ libelle: "Élève du site B", ok: !!eleveSiteB });

  const factureB = await prisma.facture.findFirst({ where: { numero: "FAC-2026-B-0001" } });
  checks.push({ libelle: "Facture du site B", ok: !!factureB });

  const parent = await prisma.user.findFirst({ where: { email: emailParent } });
  const eleveParent = parent
    ? await prisma.eleveParent.findFirst({ where: { parentId: parent.id }, include: { eleve: true } })
    : null;
  checks.push({ libelle: "Lien parent-élève", ok: !!eleveParent });

  let failures = 0;
  for (const c of checks) {
    if (c.ok) {
      console.log(`  OK   ${c.libelle}`);
    } else {
      console.error(`  FAIL ${c.libelle}`);
      failures++;
    }
  }
  if (failures > 0) {
    console.error(`Vérification échouée : ${failures} FAIL`);
    process.exit(1);
  }
  console.log("Vérification réussie : le tree contient tout ce que la suite e2e attend.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });