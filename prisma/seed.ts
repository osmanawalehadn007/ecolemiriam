import { PrismaClient, PlanType, Role, Sexe, StatutEleve } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding École Miriam database...");

  // --- Tenant de démonstration ---
  const tenant = await prisma.tenant.upsert({
    where: { slug: "lycee-demo" },
    update: {},
    create: {
      name: "Lycée de Démonstration École Miriam",
      slug: "lycee-demo",
      plan: PlanType.PRO,
      country: "SN",
      city: "Dakar",
      currentYear: "2025-2026",
      notationMax: 20,
      langue: "fr",
      timezone: "Africa/Dakar",
      currency: "XOF",
      primaryColor: "#16a34a",
    },
  });

  console.log(`✅ Tenant créé: ${tenant.name}`);

  // --- Utilisateurs ---
  const passwordHash = await bcrypt.hash("Demo@2026!", 12);

  const adminUser = await prisma.user.upsert({
    where: { email: "admin@lycee-demo.ecolemiriam.app" },
    update: {},
    create: {
      tenantId: tenant.id,
      email: "admin@lycee-demo.ecolemiriam.app",
      password: passwordHash,
      name: "Mamadou Diallo",
      firstName: "Mamadou",
      lastName: "Diallo",
      role: Role.TENANT_ADMIN,
    },
  });

  const enseignantUser = await prisma.user.upsert({
    where: { email: "enseignant@lycee-demo.ecolemiriam.app" },
    update: {},
    create: {
      tenantId: tenant.id,
      email: "enseignant@lycee-demo.ecolemiriam.app",
      password: passwordHash,
      name: "Fatou Ndiaye",
      firstName: "Fatou",
      lastName: "Ndiaye",
      role: Role.TEACHER,
    },
  });

  const parentUser = await prisma.user.upsert({
    where: { email: "parent@lycee-demo.ecolemiriam.app" },
    update: {},
    create: {
      tenantId: tenant.id,
      email: "parent@lycee-demo.ecolemiriam.app",
      password: passwordHash,
      name: "Oumar Sow",
      firstName: "Oumar",
      lastName: "Sow",
      role: Role.PARENT,
    },
  });

  console.log("✅ Utilisateurs créés");

  // --- Enseignant ---
  const existingEnseignant = await prisma.enseignant.findFirst({
    where: { userId: enseignantUser.id, tenantId: tenant.id },
  });
  const enseignant = existingEnseignant ?? await prisma.enseignant.create({
      data: {
        tenantId: tenant.id,
        userId: enseignantUser.id,
        specialite: "Mathématiques",
        typeContrat: "CDI",
      },
  });

  // --- Matières ---
  const matieres = await Promise.all([
    prisma.matiere.upsert({
      where: { id: "mat-math-demo" },
      update: {},
      create: {
        id: "mat-math-demo",
        tenantId: tenant.id,
        nom: "Mathématiques",
        code: "MATH",
        coefficient: 5,
        couleur: "#3b82f6",
      },
    }),
    prisma.matiere.upsert({
      where: { id: "mat-fr-demo" },
      update: {},
      create: {
        id: "mat-fr-demo",
        tenantId: tenant.id,
        nom: "Français",
        code: "FR",
        coefficient: 4,
        couleur: "#ef4444",
      },
    }),
    prisma.matiere.upsert({
      where: { id: "mat-ang-demo" },
      update: {},
      create: {
        id: "mat-ang-demo",
        tenantId: tenant.id,
        nom: "Anglais",
        code: "ANG",
        coefficient: 3,
        couleur: "#f59e0b",
      },
    }),
    prisma.matiere.upsert({
      where: { id: "mat-sci-demo" },
      update: {},
      create: {
        id: "mat-sci-demo",
        tenantId: tenant.id,
        nom: "Sciences Physiques",
        code: "SCI",
        coefficient: 4,
        couleur: "#8b5cf6",
      },
    }),
    prisma.matiere.upsert({
      where: { id: "mat-svt-demo" },
      update: {},
      create: {
        id: "mat-svt-demo",
        tenantId: tenant.id,
        nom: "SVT",
        code: "SVT",
        coefficient: 3,
        couleur: "#10b981",
      },
    }),
    prisma.matiere.upsert({
      where: { id: "mat-hist-demo" },
      update: {},
      create: {
        id: "mat-hist-demo",
        tenantId: tenant.id,
        nom: "Histoire-Géographie",
        code: "HIST",
        coefficient: 3,
        couleur: "#f97316",
      },
    }),
  ]);

  console.log("✅ Matières créées");

  // --- Années & Périodes ---
  const annee = await prisma.anneesScolaires.upsert({
    where: { id: "annee-2025-2026-demo" },
    update: {},
    create: {
      id: "annee-2025-2026-demo",
      tenantId: tenant.id,
      libelle: "2025-2026",
      dateDebut: new Date("2025-10-01"),
      dateFin: new Date("2026-07-31"),
      isCurrent: true,
    },
  });

  const periodes = await Promise.all([
    prisma.periode.upsert({
      where: { id: "per-t1-demo" },
      update: {},
      create: {
        id: "per-t1-demo",
        anneeId: annee.id,
        nom: "1er Trimestre",
        numero: 1,
        dateDebut: new Date("2025-10-01"),
        dateFin: new Date("2026-01-10"),
        isCurrent: false,
      },
    }),
    prisma.periode.upsert({
      where: { id: "per-t2-demo" },
      update: {},
      create: {
        id: "per-t2-demo",
        anneeId: annee.id,
        nom: "2ème Trimestre",
        numero: 2,
        dateDebut: new Date("2026-01-12"),
        dateFin: new Date("2026-04-10"),
        isCurrent: true,
      },
    }),
    prisma.periode.upsert({
      where: { id: "per-t3-demo" },
      update: {},
      create: {
        id: "per-t3-demo",
        anneeId: annee.id,
        nom: "3ème Trimestre",
        numero: 3,
        dateDebut: new Date("2026-04-20"),
        dateFin: new Date("2026-07-15"),
        isCurrent: false,
      },
    }),
  ]);

  console.log("✅ Périodes créées");

  // --- Classes ---
  const classe = await prisma.classe.upsert({
    where: { id: "classe-tle-a-demo" },
    update: {},
    create: {
      id: "classe-tle-a-demo",
      tenantId: tenant.id,
      nom: "Terminale A1",
      niveau: "Terminale",
      filiere: "Littéraire",
      effectifMax: 40,
      annee: "2025-2026",
      profPrincipalId: enseignant.id,
    },
  });

  console.log("✅ Classe créée");

  // --- Parent ---
  const existingParent = await prisma.parent.findFirst({
    where: { userId: parentUser.id, tenantId: tenant.id },
  });
  const parent = existingParent ?? await prisma.parent.create({
    data: {
      tenantId: tenant.id,
      userId: parentUser.id,
      nom: "Sow",
      prenom: "Oumar",
      email: "parent@lycee-demo.ecolemiriam.app",
      phone: "+221 77 123 45 67",
      profession: "Commerçant",
    },
  });

  // --- Élèves ---
  const eleveData = [
    { nom: "Sow", prenom: "Aminata", matricule: "2026-0001", sexe: Sexe.F, dateNaissance: new Date("2007-03-15") },
    { nom: "Diop", prenom: "Ibrahima", matricule: "2026-0002", sexe: Sexe.M, dateNaissance: new Date("2007-07-22") },
    { nom: "Fall", prenom: "Mariama", matricule: "2026-0003", sexe: Sexe.F, dateNaissance: new Date("2006-11-08") },
    { nom: "Ba", prenom: "Ousmane", matricule: "2026-0004", sexe: Sexe.M, dateNaissance: new Date("2007-01-30") },
    { nom: "Camara", prenom: "Aissatou", matricule: "2026-0005", sexe: Sexe.F, dateNaissance: new Date("2007-05-12") },
    { nom: "Ndiaye", prenom: "Moussa", matricule: "2026-0006", sexe: Sexe.M, dateNaissance: new Date("2006-09-18") },
    { nom: "Mbaye", prenom: "Rokhaya", matricule: "2026-0007", sexe: Sexe.F, dateNaissance: new Date("2007-02-25") },
    { nom: "Diouf", prenom: "Serigne", matricule: "2026-0008", sexe: Sexe.M, dateNaissance: new Date("2007-08-04") },
    { nom: "Gueye", prenom: "Ndéye", matricule: "2026-0009", sexe: Sexe.F, dateNaissance: new Date("2006-12-19") },
    { nom: "Toure", prenom: "Lamine", matricule: "2026-0010", sexe: Sexe.M, dateNaissance: new Date("2007-04-07") },
  ];

  const eleves = await Promise.all(
    eleveData.map((e) =>
      prisma.eleve.upsert({
        where: { tenantId_matricule: { tenantId: tenant.id, matricule: e.matricule } },
        update: {},
        create: {
          tenantId: tenant.id,
          ...e,
          classeId: classe.id,
          statut: StatutEleve.ACTIF,
          regime: "externe",
          nationalite: "SN",
          anneeInscription: "2025-2026",
        },
      })
    )
  );

  // Lier le premier élève au parent de démo
  await prisma.eleveParent.upsert({
    where: { eleveId_parentId: { eleveId: eleves[0].id, parentId: parent.id } },
    update: {},
    create: {
      eleveId: eleves[0].id,
      parentId: parent.id,
      lien: "PERE",
      isGardien: true,
    },
  });

  console.log(`✅ ${eleves.length} élèves créés`);

  console.log("\n🎉 Seed terminé avec succès !");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📧 Admin:       admin@lycee-demo.ecolemiriam.app");
  console.log("📧 Enseignant:  enseignant@lycee-demo.ecolemiriam.app");
  console.log("📧 Parent:      parent@lycee-demo.ecolemiriam.app");
  console.log("🔑 Mot de passe: Demo@2026!");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

  // ============================================================
  // FIXTURES E2E — Isolation multi-sites (tests/e2e/isolation.spec.ts)
  // Idempotent : upserts sur des ids figés référencés par la suite e2e.
  // ============================================================
  const siteA = await prisma.site.upsert({
    where: { id: "site-demo-central" },
    update: {},
    create: {
      id: "site-demo-central",
      tenantId: tenant.id,
      nom: "Campus Central",
      code: "SITE-01",
      ville: "Djibouti",
      actif: true,
    },
  });
  const siteB = await prisma.site.upsert({
    where: { id: "site-demo-annexe" },
    update: {},
    create: {
      id: "site-demo-annexe",
      tenantId: tenant.id,
      nom: "Annexe Nord",
      code: "SITE-02",
      ville: "Djibouti",
      actif: true,
    },
  });

  // Rattachements UserSite — SANS eux, resolveSiteScope renvoie NONE
  // (fail-closed) : le personnel ne voit RIEN, listes vides et 404.
  for (const [user, site] of [
    [adminUser, siteA],
    [enseignantUser, siteA],
  ] as const) {
    await prisma.userSite.upsert({
      where: { userId_siteId: { userId: user.id, siteId: site.id } },
      update: {},
      create: { userId: user.id, siteId: site.id },
    });
  }
  // L'admin est borné au site A : c'est l'« admin du site A » des scénarios
  // 5.12 → 5.14 ; le prof A ne voit que le Campus Central.
  await prisma.user.update({ where: { id: adminUser.id }, data: { siteId: siteA.id } });
  await prisma.user.update({ where: { id: enseignantUser.id }, data: { siteId: siteA.id } });

  // Prof B — enseignant de l'Annexe Nord, jamais visible du périmètre du A.
  const enseignant2User = await prisma.user.upsert({
    where: { email: "enseignant2@lycee-demo.ecolemiriam.app" },
    update: { siteId: siteB.id },
    create: {
      tenantId: tenant.id,
      siteId: siteB.id,
      email: "enseignant2@lycee-demo.ecolemiriam.app",
      password: passwordHash,
      name: "Moussa Ba",
      firstName: "Moussa",
      lastName: "Ba",
      role: Role.TEACHER,
    },
  });
  await prisma.userSite.upsert({
    where: { userId_siteId: { userId: enseignant2User.id, siteId: siteB.id } },
    update: {},
    create: { userId: enseignant2User.id, siteId: siteB.id },
  });
  const existingEnseignant2 = await prisma.enseignant.findFirst({
    where: { userId: enseignant2User.id, tenantId: tenant.id },
  });
  if (!existingEnseignant2) {
    await prisma.enseignant.create({
      data: {
        tenantId: tenant.id,
        userId: enseignant2User.id,
        specialite: "Français",
        typeContrat: "CDI",
      },
    });
  }
  console.log("✅ Sites + rattachements + prof B créés");

  // Classes des scénarios : 2nde C (MÊME site, hors périmètre du prof A),
  // 1ère B1 (Annexe Nord — isolation inter-sites).
  await prisma.classe.upsert({
    where: { id: "classe-2nde-c-demo" },
    update: {},
    create: {
      id: "classe-2nde-c-demo",
      tenantId: tenant.id,
      siteId: siteA.id,
      nom: "2nde C",
      niveau: "Seconde",
      effectifMax: 40,
      annee: "2025-2026",
    },
  });
  await prisma.classe.upsert({
    where: { id: "classe-1ere-b-demo" },
    update: {},
    create: {
      id: "classe-1ere-b-demo",
      tenantId: tenant.id,
      siteId: siteB.id,
      nom: "1ère B1",
      niveau: "Première",
      effectifMax: 40,
      annee: "2025-2026",
    },
  });

  // Élèves de référence — un par scénario d'isolation.
  const eleveProfA = await prisma.eleve.upsert({
    where: { tenantId_matricule: { tenantId: tenant.id, matricule: "2026-0201" } },
    update: { siteId: siteA.id },
    create: {
      id: "eleve-tle-a-1-demo",
      tenantId: tenant.id,
      siteId: siteA.id,
      nom: "Farah",
      prenom: "Amina",
      matricule: "2026-0201",
      sexe: Sexe.F,
      dateNaissance: new Date("2007-03-15"),
      classeId: classe.id,
      statut: StatutEleve.ACTIF,
      regime: "externe",
      nationalite: "SN",
      anneeInscription: "2025-2026",
    },
  });
  const eleveHorsPerimetre = await prisma.eleve.upsert({
    where: { tenantId_matricule: { tenantId: tenant.id, matricule: "2026-0101" } },
    update: { siteId: siteA.id },
    create: {
      id: "eleve-2nde-c-1-demo",
      tenantId: tenant.id,
      siteId: siteA.id,
      nom: "Sy",
      prenom: "Abdoulaye",
      matricule: "2026-0101",
      sexe: Sexe.M,
      dateNaissance: new Date("2007-06-02"),
      classeId: "classe-2nde-c-demo",
      statut: StatutEleve.ACTIF,
      regime: "externe",
      nationalite: "SN",
      anneeInscription: "2025-2026",
    },
  });
  const eleveSiteB = await prisma.eleve.upsert({
    where: { tenantId_matricule: { tenantId: tenant.id, matricule: "2026-0301" } },
    update: { siteId: siteB.id },
    create: {
      id: "eleve-1ere-b-1-demo",
      tenantId: tenant.id,
      siteId: siteB.id,
      nom: "Waberi",
      prenom: "Leila",
      matricule: "2026-0301",
      sexe: Sexe.F,
      dateNaissance: new Date("2007-09-11"),
      classeId: "classe-1ere-b-demo",
      statut: StatutEleve.ACTIF,
      regime: "externe",
      nationalite: "SN",
      anneeInscription: "2025-2026",
    },
  });

  // Facture du site B — cible du scénario 5.12.
  const existingFactureB = await prisma.facture.findFirst({
    where: { tenantId: tenant.id, numero: "FAC-2026-B-0001" },
  });
  if (!existingFactureB) {
    await prisma.facture.create({
      data: {
        id: "facture-b-demo",
        tenantId: tenant.id,
        siteId: siteB.id,
        eleveId: eleveSiteB.id,
        numero: "FAC-2026-B-0001",
        libelle: "Scolarité 2025-2026 — 1ère B1",
        montant: 150000,
        devise: "DJF",
      },
    });
  }
  void eleveProfA;
  void eleveHorsPerimetre;
  console.log("✅ Fixtures e2e isolation créées (2 classes, 3 élèves, facture B)");

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
