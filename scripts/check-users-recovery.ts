/**
 * Diagnostic (LECTURE SEULE) — état des utilisateurs en base.
 *
 * Usage :
 *   npx tsx scripts/check-users-recovery.ts
 *   npx tsx scripts/check-users-recovery.ts ilyas mohamed abdi djama ahdimounomar
 *
 * Ne modifie rien. Sert à comparer la base courante avec un dump de sauvegarde
 * pour préparer une restauration d'utilisateurs supprimés.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const targets =
  process.argv.slice(2).length > 0
    ? process.argv.slice(2).map((t) => t.toLowerCase())
    : ["ilyas", "mohamed", "abdi", "djama", "ahdimounomar", "madina"];

async function main() {
  const total = await prisma.user.count();
  console.log(`Total utilisateurs en base : ${total}\n`);

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      email: true,
      name: true,
      firstName: true,
      lastName: true,
      role: true,
      isActive: true,
      tenantId: true,
      siteId: true,
      createdAt: true,
      updatedAt: true,
      lastLoginAt: true,
    },
  });

  console.log("=== CONTACTS DES CIBLES (recherche) ===");
  const matches = users.filter((u) => {
    const haystack = [u.email, u.name, u.firstName, u.lastName]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return targets.some((t) => haystack.includes(t));
  });

  if (matches.length === 0) {
    console.log("  (aucun utilisateur correspondant — ils ont bien disparu de la base)");
  } else {
    for (const u of matches) {
      console.log(
        `  [${u.isActive ? "ACTIF" : "INACTIF"}] ${u.email} | ${u.name ?? "-"} | ` +
          `${u.role} | tenant=${u.tenantId} | site=${u.siteId ?? "-"} | ` +
          `maj=${u.updatedAt.toISOString()}`,
      );
    }
  }

  console.log("\n=== TOUS LES UTILISATEURS ===");
  for (const u of users) {
    console.log(
      `  [${u.isActive ? "ACTIF" : "INACTIF"}] ${u.email} | ${u.name ?? "-"} | ` +
        `${u.role} | tenant=${u.tenantId} | maj=${u.updatedAt.toISOString()}`,
    );
  }
}

main()
  .catch((e) => {
    console.error("Erreur :", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
