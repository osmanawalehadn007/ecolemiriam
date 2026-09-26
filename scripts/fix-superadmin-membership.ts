/**
 * Correctif — rattachement des comptes SUPER_ADMIN à un établissement.
 * ============================================================
 * Symptôme : après restauration, un compte SUPER_ADMIN ne voit AUCUN
 * utilisateur. Cause : `deriveClaims()` lit `user_tenants` (adhésions) et
 * `users.tenantId`. Pour un SUPER_ADMIN sans adhésion ET sans `tenantId`,
 * la fonction renvoie `tenantId: null` ; la page Paramètres → Utilisateurs
 * fait alors `if (!session.user.tenantId) return []`.
 *
 * Ce script crée l'adhésion manquante (rôle SUPER_ADMIN, isDefault = true)
 * et renseigne `users.tenantId`. Idempotent.
 *
 * Usage :
 *   npx tsx scripts/fix-superadmin-membership.ts                 # simulation
 *   npx tsx scripts/fix-superadmin-membership.ts --apply
 *   npx tsx scripts/fix-superadmin-membership.ts --apply --tenant=<id|slug>
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const tenantArg = (argv.find((a) => a.startsWith("--tenant=")) ?? "").slice(9);

  // Tenant cible : argument, sinon celui qui porte le plus d'utilisateurs réels.
  let tenant: { id: string; name: string; slug: string } | undefined;
  if (tenantArg) {
    tenant = (await prisma.tenant.findFirst({
      where: { OR: [{ id: tenantArg }, { slug: tenantArg }] },
      select: { id: true, name: true, slug: true },
    })) ?? undefined;
  } else {
    const tous = await prisma.tenant.findMany({
      select: { id: true, name: true, slug: true, _count: { select: { users: true } } },
    });
    tous.sort((a, b) => b._count.users - a._count.users);
    tenant = tous[0];
  }

  if (!tenant) throw new Error("Tenant cible introuvable.");
  console.log(`Tenant cible : ${tenant.name} (${tenant.slug}) — ${tenant.id}`);
  console.log(`Mode         : ${apply ? "APPLICATION" : "simulation"}\n`);

  const admins = await prisma.user.findMany({
    where: { role: "SUPER_ADMIN" },
    select: {
      id: true,
      email: true,
      tenantId: true,
      userTenants: { select: { id: true, tenantId: true, isDefault: true } },
    },
    orderBy: { email: "asc" },
  });

  if (admins.length === 0) console.log("Aucun compte SUPER_ADMIN.");
  let touches = 0;

  for (const u of admins) {
    const deja = u.userTenants.find((m) => m.tenantId === tenant.id);
    const manqueTenantId = u.tenantId !== tenant.id;
    if (deja && !manqueTenantId) {
      console.log(`= ${u.email} : déjà rattaché (rien à faire)`);
      continue;
    }
    console.log(`→ ${u.email} : adhésion=${deja ? "présente" : "À CRÉER"}, tenantId=${u.tenantId ?? "NULL"} → ${tenant.id}`);
    if (!apply) continue;

    await prisma.$transaction(async (tx) => {
      if (!deja) {
        await tx.userTenant.create({
          data: { userId: u.id, tenantId: tenant.id, role: "SUPER_ADMIN", isActive: true, isDefault: true },
        });
      } else {
        await tx.userTenant.update({ where: { id: deja.id }, data: { isActive: true, isDefault: true } });
      }
      await tx.user.update({ where: { id: u.id }, data: { tenantId: tenant.id } });
    });
    touches++;
  }

  if (!apply) {
    console.log("\n(simulation — relancez avec --apply)");
    return;
  }

  console.log(`\n✓ ${touches} compte(s) corrigé(s).\n`);
  const apres = await prisma.user.findMany({
    where: { role: "SUPER_ADMIN" },
    select: {
      email: true,
      tenantId: true,
      userTenants: { select: { tenantId: true, role: true, isDefault: true } },
    },
  });
  for (const u of apres) {
    console.log(
      `${u.email} → tenantId=${u.tenantId ?? "NULL"} | adhésions=${
        u.userTenants.map((m) => `${m.tenantId}/${m.role}${m.isDefault ? "(défaut)" : ""}`).join(", ") || "aucune"
      }`,
    );
  }
}

main()
  .catch((e) => {
    console.error("\nERREUR :", e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
