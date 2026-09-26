import { PrismaClient, PlanType, Role } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Création des comptes d'accès...");

  const passwordHash = await bcrypt.hash("Demo@2026!", 12);

  // --- Super Admin (global, non lié à un tenant) ---
  const superAdmin = await prisma.user.upsert({
    where: { email: "superadmin@ecolemiriam.app" },
    update: {},
    create: {
      email: "superadmin@ecolemiriam.app",
      password: passwordHash,
      name: "Mariam",
      firstName: "Mariam",
      lastName: "Admin",
      role: Role.SUPER_ADMIN,
      isActive: true,
    },
  });

  console.log(`✅ Super Admin créé: ${superAdmin.email}`);

  // --- Tenant de démonstration ---
  // `lycee-demo-seed` et non `lycee-demo` : ce dernier est le slug du tenant de
  // PRODUCTION « ÉTABLISSEMENT PRIVÉ MIRIAM » (voir prisma/seed.ts).
  const tenant = await prisma.tenant.upsert({
    where: { slug: "lycee-demo-seed" },
    update: {},
    create: {
      name: "Lycée de Démonstration École Miriam",
      slug: "lycee-demo-seed",
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

  // --- Directeur (TENANT_ADMIN) ---
  const directeur = await prisma.user.upsert({
    where: { email: "admin@lycee-demo.ecolemiriam.app" },
    update: {},
    create: {
      tenantId: tenant.id,
      email: "admin@lycee-demo.ecolemiriam.app",
      password: passwordHash,
      name: "Ilyas Aden",
      firstName: "Ilyas",
      lastName: "Aden",
      role: Role.TENANT_ADMIN,
      isActive: true,
    },
  });

  console.log(`✅ Directeur créé: ${directeur.email}`);

  // --- UserTenant pour le directeur (obligatoire pour le switcher) ---
  await prisma.userTenant.upsert({
    where: { userId_tenantId: { userId: directeur.id, tenantId: tenant.id } },
    update: {},
    create: {
      userId: directeur.id,
      tenantId: tenant.id,
      role: Role.TENANT_ADMIN,
      isActive: true,
      isDefault: true,
    },
  });

  console.log("✅ UserTenant créé pour le directeur");

  console.log("\n🎉 Comptes d'accès créés avec succès !");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📧 Super Admin:  superadmin@ecolemiriam.app");
  console.log("📧 Directeur:    admin@lycee-demo.ecolemiriam.app");
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
