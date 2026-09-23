import { PrismaClient, PlanType, Role, Sexe, StatutEleve } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding EcolPro database...");

  // --- Tenant de démonstration ---
  const tenant = await prisma.tenant.upsert({
    where: { slug: "lycee-demo" },
    update: {},
    create: {
      name: "Lycée de Démonstration EcolPro",
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

  // --- Sites --------------------------------------------------------------
  // Deux sites DANS LE MÊME tenant : c'est la configuration minimale pour
  // pouvoir tester l'isolation inter-sites (un prof du site A ne doit pas voir
  // les données du site B).
  const siteA = await prisma.site.upsert({
    where: { id: "site-demo-central" },
    update: {},
    create: {
      id: "site-demo-central",
      tenantId: tenant.id,
      nom: "Campus Central",
      code: "SITE-01",
      ville: "Dakar",
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
      ville: "Dakar",
      actif: true,
    },
  });

  console.log(`✅ Sites créés: ${siteA.nom}, ${siteB.nom}`);

  // --- Utilisateurs ---
  const passwordHash = await bcrypt.hash("Demo@2026!", 12);

  const adminUser = await prisma.user.upsert({
    where: { email: "admin@lycee-demo.ecolpro.app" },
    update: { siteId: siteA.id },
    create: {
      tenantId: tenant.id,
      siteId: siteA.id,
      email: "admin@lycee-demo.ecolpro.app",
      password: passwordHash,
      name: "Mamadou Diallo",
      firstName: "Mamadou",
      lastName: "Diallo",
      role: Role.TENANT_ADMIN,
    },
  });

  // Enseignant A — rattaché au Campus Central. Sert de « prof légitime » dans
  // les tests d'isolation : il doit voir SES classes et rien d'autre.
  const enseignantUser = await prisma.user.upsert({
    where: { email: "enseignant@lycee-demo.ecolpro.app" },
    update: { siteId: siteA.id },
    create: {
      tenantId: tenant.id,
      siteId: siteA.id,
      email: "enseignant@lycee-demo.ecolpro.app",
      password: passwordHash,
      name: "Fatou Ndiaye",
      firstName: "Fatou",
      lastName: "Ndiaye",
      role: Role.CLASS_TEACHER,
    },
  });

  // Enseignant B — rattaché à l'Annexe Nord. C'est la CIBLE qui ne doit jamais
  // apparaître dans le périmètre de l'enseignant A.
  const enseignant2User = await prisma.user.upsert({
    where: { email: "enseignant2@lycee-demo.ecolpro.app" },
    update: { siteId: siteB.id },
    create: {
      tenantId: tenant.id,
      siteId: siteB.id,
      email: "enseignant2@lycee-demo.ecolpro.app",
      password: passwordHash,
      name: "Moussa Ba",
      firstName: "Moussa",
      lastName: "Ba",
      role: Role.TEACHER,
    },
  });

  const parentUser = await prisma.user.upsert({
    where: { email: "parent@lycee-demo.ecolpro.app" },
    update: { siteId: siteA.id },
    create: {
      tenantId: tenant.id,
      siteId: siteA.id,
      email: "parent@lycee-demo.ecolpro.app",
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

  // Fiche enseignant B — sert de cible « hors périmètre » côté Annexe Nord.
  const existingEnseignant2 = await prisma.enseignant.findFirst({
    where: { userId: enseignant2User.id, tenantId: tenant.id },
  });
  const enseignant2 = existingEnseignant2 ?? await prisma.enseignant.create({
      data: {
        tenantId: tenant.id,
        userId: enseignant2User.id,
        specialite: "Français",
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
  // Trois classes, deux sites :
  //  · Terminale A1 — site A, prof principal = enseignant A  → SON périmètre ;
  //  · 2nde C        — site A, AUCUN prof principal, créneau sans titulaire :
  //    même site que A, donc hors périmètre ENSEIGNANT mais dans son site. C'est
  //    la cible qui distingue « périmètre enseignant » de « filtre de site » :
  //    une implémentation qui n'applique que le filtre de site laisserait passer ;
  //  · 1ère B1       — site B, prof principal = enseignant B → cible inter-sites.
  const classe = await prisma.classe.upsert({
    where: { id: "classe-tle-a-demo" },
    update: { siteId: siteA.id, profPrincipalId: enseignant.id },
    create: {
      id: "classe-tle-a-demo",
      tenantId: tenant.id,
      siteId: siteA.id,
      nom: "Terminale A1",
      niveau: "Terminale",
      filiere: "Littéraire",
      effectifMax: 40,
      annee: "2025-2026",
      profPrincipalId: enseignant.id,
    },
  });

  const classeA2 = await prisma.classe.upsert({
    where: { id: "classe-2nde-c-demo" },
    update: { siteId: siteA.id, profPrincipalId: null },
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

  const classeB = await prisma.classe.upsert({
    where: { id: "classe-1ere-b-demo" },
    update: { siteId: siteB.id, profPrincipalId: enseignant2.id },
    create: {
      id: "classe-1ere-b-demo",
      tenantId: tenant.id,
      siteId: siteB.id,
      nom: "1ère B1",
      niveau: "Première",
      filiere: "Générale",
      effectifMax: 40,
      annee: "2025-2026",
      profPrincipalId: enseignant2.id,
    },
  });

  console.log("✅ Classes créées");

  // --- Emplois du temps ---------------------------------------------------
  // Ils FIXENT le périmètre enseignant : `getTeacherScope` le dérive des
  // créneaux et du rôle de prof principal. Enseignant A n'a donc que la
  // Terminale A1 et les mathématiques.
  const emploiTempsData = [
    { id: "edt-a-math-lundi", classeId: classe.id, matiereId: "mat-math-demo", enseignantId: enseignant.id, jour: "LUNDI" as const, heureDebut: "08:00", heureFin: "10:00" },
    { id: "edt-a-math-mercredi", classeId: classe.id, matiereId: "mat-math-demo", enseignantId: enseignant.id, jour: "MERCREDI" as const, heureDebut: "10:00", heureFin: "12:00" },
    // Créneau SANS titulaire : la 2nde C n'appartient au périmètre d'aucun enseignant.
    { id: "edt-a2-hist-jeudi", classeId: classeA2.id, matiereId: "mat-hist-demo", enseignantId: null, jour: "JEUDI" as const, heureDebut: "14:00", heureFin: "16:00" },
    { id: "edt-b-fr-mardi", classeId: classeB.id, matiereId: "mat-fr-demo", enseignantId: enseignant2.id, jour: "MARDI" as const, heureDebut: "08:00", heureFin: "10:00" },
  ];

  for (const creneau of emploiTempsData) {
    await prisma.emploiTemps.upsert({
      where: { id: creneau.id },
      update: { ...creneau },
      create: { tenantId: tenant.id, annee: "2025-2026", ...creneau },
    });
  }

  console.log("✅ Emplois du temps créés");

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
      email: "parent@lycee-demo.ecolpro.app",
      phone: "+221 77 123 45 67",
      profession: "Commerçant",
    },
  });

  // --- Élèves ---
  const eleveData = [
    // Identifiant FIXE pour le premier élève : les tests d'isolation visent une
    // fiche précise (élève DANS le périmètre de l'enseignant A).
    { id: "eleve-tle-a-1-demo", nom: "Sow", prenom: "Aminata", matricule: "2026-0001", sexe: Sexe.F, dateNaissance: new Date("2007-03-15") },
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
        // `update` réaligne un élève déjà présent : sans cela, une base seedée
        // avant l'introduction des sites gardait `siteId = null` et le filtre de
        // site l'excluait (« fail-closed ») — périmètre vide, tests impossibles.
        update: { classeId: classe.id, siteId: siteA.id },
        create: {
          tenantId: tenant.id,
          ...e,
          classeId: classe.id,
          siteId: siteA.id,
          statut: StatutEleve.ACTIF,
          regime: "externe",
          nationalite: "SN",
          anneeInscription: "2025-2026",
        },
      })
    )
  );

  // Élèves de la 2nde C (site A, hors périmètre enseignant A) et de la 1ère B1
  // (site B) : ce sont les CIBLES des tests d'isolation.
  const eleveDataA2 = [
    { id: "eleve-2nde-c-1-demo", nom: "Sy", prenom: "Abdoulaye", matricule: "2026-0101", sexe: Sexe.M, dateNaissance: new Date("2008-03-11") },
    { nom: "Faye", prenom: "Coumba", matricule: "2026-0102", sexe: Sexe.F, dateNaissance: new Date("2008-06-02") },
  ];
  const eleveDataB = [
    { id: "eleve-1ere-b-1-demo", nom: "Dieng", prenom: "Cheikh", matricule: "2026-0201", sexe: Sexe.M, dateNaissance: new Date("2009-01-19") },
    { nom: "Ndour", prenom: "Bineta", matricule: "2026-0202", sexe: Sexe.F, dateNaissance: new Date("2009-05-27") },
  ];

  const creerEleves = (
    // Type explicite : `typeof eleveData` figeait la forme du PREMIER tableau
    // (identifiant obligatoire) et refusait les tableaux de cibles.
    data: Array<{
      id?: string;
      nom: string;
      prenom: string;
      matricule: string;
      sexe: Sexe;
      dateNaissance: Date;
    }>,
    classeId: string,
    siteId: string
  ) =>
    Promise.all(
      data.map((e) =>
        prisma.eleve.upsert({
          where: { tenantId_matricule: { tenantId: tenant.id, matricule: e.matricule } },
          update: { classeId, siteId },
          create: {
            tenantId: tenant.id,
            ...e,
            classeId,
            siteId,
            statut: StatutEleve.ACTIF,
            regime: "externe",
            nationalite: "SN",
            anneeInscription: "2025-2026",
          },
        })
      )
    );

  const elevesA2 = await creerEleves(eleveDataA2, classeA2.id, siteA.id);
  const elevesB = await creerEleves(eleveDataB, classeB.id, siteB.id);

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

  // --- Évaluations --------------------------------------------------------
  // Une par classe : l'évaluation de la 2nde C (même site, hors périmètre) et
  // celle de la 1ère B1 (autre site) sont les cibles des scénarios d'isolation.
  const evaluations = await Promise.all([
    prisma.evaluation.upsert({
      where: { id: "eval-math-tle-a-demo" },
      update: {},
      create: {
        id: "eval-math-tle-a-demo",
        tenantId: tenant.id,
        titre: "Contrôle 1 — Mathématiques",
        classeId: classe.id,
        matiereId: "mat-math-demo",
        periodeId: "per-t2-demo",
        date: new Date("2026-02-10"),
        duree: 120,
        coefficient: 1,
      },
    }),
    prisma.evaluation.upsert({
      where: { id: "eval-hist-2nde-c-demo" },
      update: {},
      create: {
        id: "eval-hist-2nde-c-demo",
        tenantId: tenant.id,
        titre: "Contrôle 1 — Histoire-Géographie",
        classeId: classeA2.id,
        matiereId: "mat-hist-demo",
        periodeId: "per-t2-demo",
        date: new Date("2026-02-10"),
        duree: 120,
        coefficient: 1,
      },
    }),
    prisma.evaluation.upsert({
      where: { id: "eval-fr-1ere-b-demo" },
      update: {},
      create: {
        id: "eval-fr-1ere-b-demo",
        tenantId: tenant.id,
        titre: "Contrôle 1 — Français",
        classeId: classeB.id,
        matiereId: "mat-fr-demo",
        periodeId: "per-t2-demo",
        date: new Date("2026-02-11"),
        duree: 120,
        coefficient: 1,
      },
    }),
  ]);

  // --- Notes --------------------------------------------------------------
  // Deux notes DANS le périmètre de l'enseignant A : les tests positifs en ont
  // besoin — un test qui ne vérifie que le refus passerait même si le filtre
  // était trop large (ou vide).
  const notesData = [
    { id: "note-math-a-1", eleveId: eleves[0].id, valeur: 15.5 },
    { id: "note-math-a-2", eleveId: eleves[1].id, valeur: 12 },
  ];
  for (const n of notesData) {
    await prisma.note.upsert({
      where: { id: n.id },
      update: {},
      create: {
        id: n.id,
        tenantId: tenant.id,
        eleveId: n.eleveId,
        classeId: classe.id,
        matiereId: "mat-math-demo",
        periodeId: "per-t2-demo",
        intitule: "DS n°1",
        valeur: n.valeur,
        date: new Date("2026-02-12"),
        saisieParId: enseignantUser.id,
      },
    });
  }

  // --- Examens ------------------------------------------------------------
  // Un par site : « programmer une session hors périmètre » prend l'examen de
  // l'Annexe Nord comme cible.
  const examens = await Promise.all([
    prisma.examen.upsert({
      where: { id: "examen-a-demo" },
      update: {},
      create: {
        id: "examen-a-demo",
        tenantId: tenant.id,
        siteId: siteA.id,
        intitule: "Composition du 2ème trimestre — Campus Central",
        dateDebut: new Date("2026-03-02"),
        dateFin: new Date("2026-03-06"),
      },
    }),
    prisma.examen.upsert({
      where: { id: "examen-b-demo" },
      update: {},
      create: {
        id: "examen-b-demo",
        tenantId: tenant.id,
        siteId: siteB.id,
        intitule: "Composition du 2ème trimestre — Annexe Nord",
        dateDebut: new Date("2026-03-02"),
        dateFin: new Date("2026-03-06"),
      },
    }),
  ]);

  // --- Facture ------------------------------------------------------------
  // Facture d'un élève du site B : cible du scénario « l'admin du site A ne lit
  // pas une facture du site B ». `Facture.numero` n'est pas unique en base,
  // d'où le `findFirst` plutôt qu'un `upsert`.
  const existingFactureB = await prisma.facture.findFirst({
    where: { tenantId: tenant.id, numero: "FAC-2026-B-0001" },
  });
  if (!existingFactureB) {
    await prisma.facture.create({
      data: {
        id: "facture-b-demo",
        tenantId: tenant.id,
        siteId: siteB.id,
        eleveId: elevesB[0].id,
        numero: "FAC-2026-B-0001",
        libelle: "Scolarité 2025-2026 — 1ère B1",
        montant: 150000,
        devise: "XOF",
      },
    });
  }

  console.log(`✅ ${evaluations.length} évaluations et ${examens.length} examens créés`);

  console.log(`✅ ${eleves.length} élèves créés (+ ${elevesA2.length} pour la 2nde C, + ${elevesB.length} pour la 1ère B1)`);

  console.log("\n🎉 Seed terminé avec succès !");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📧 Admin:       admin@lycee-demo.ecolpro.app");
  console.log("📧 Enseignant:  enseignant@lycee-demo.ecolpro.app");
  console.log("📧 Parent:      parent@lycee-demo.ecolpro.app");
  console.log("🔑 Mot de passe: Demo@2026!");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
