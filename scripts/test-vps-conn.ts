// Test de connexion au VPS Postgres via tunnel SSH
import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  console.log('Test de connexion au VPS Postgres...\n');

  const tenant = await prisma.tenant.findFirst({
    select: { id: true, name: true, slug: true, plan: true, status: true, country: true, currentYear: true, currency: true },
  });
  console.log('✓ Tenant :', JSON.stringify(tenant, null, 2));

  const users = await prisma.user.findMany({
    select: { email: true, name: true, role: true, isActive: true, lastLoginAt: true },
    orderBy: { role: 'asc' },
  });
  console.log(`\n✓ Utilisateurs (${users.length}) :`);
  for (const u of users) {
    console.log(`  • ${u.email} — ${u.name} — ${u.role} — actif: ${u.isActive} — dernière connexion: ${u.lastLoginAt ?? 'jamais'}`);
  }

  const eleves = await prisma.eleve.count();
  const classes = await prisma.classe.count();
  const factures = await prisma.facture.count();
  const paiements = await prisma.paiement.count();
  console.log(`\n✓ Compteurs : ${eleves} élèves, ${classes} classes, ${factures} factures, ${paiements} paiements`);

  await prisma.$disconnect();
  console.log('\n✓ Connexion au VPS Postgres : OK');
}

main().catch((e) => {
  console.error('\n✗ Échec :', e.message);
  process.exit(1);
});
