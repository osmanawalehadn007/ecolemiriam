/**
 * Nettoyage: supprimer les enseignants de test créés lors des tests précédents.
 */
import prismaBase from "@/lib/prisma-base";

async function main() {
  const testEmails = [
    "ahmed.omar.test@ecolemiriam.com",
    "fatima.ali.test@ecolemiriam.com",
    "said.hassan.test@ecolemiriam.com",
    "amina.yusuf.test@ecolemiriam.com",
    "omar.mahamoud.test@ecolemiriam.com",
    "khadija.abdillahi.test@ecolemiriam.com",
  ];

  console.log("🧹 Nettoyage des enseignants de test...\n");

  for (const email of testEmails) {
    const user = await prismaBase.user.findUnique({
      where: { email },
      select: { id: true, name: true, enseignants: { select: { id: true } } },
    });

    if (!user) {
      console.log(`   ⏭️  ${email}: déjà absent`);
      continue;
    }

    // Supprimer les relations d'abord
    for (const ens of user.enseignants) {
      await prismaBase.enseignantMatiere.deleteMany({ where: { enseignantId: ens.id } });
      await prismaBase.enseignantAffectation.deleteMany({ where: { enseignantId: ens.id } });
      await prismaBase.enseignantSite.deleteMany({ where: { enseignantId: ens.id } });
      await prismaBase.enseignant.delete({ where: { id: ens.id } });
    }
    await prismaBase.userTenant.deleteMany({ where: { userId: user.id } });
    await prismaBase.verificationToken.deleteMany({ where: { identifier: email } });
    await prismaBase.user.delete({ where: { id: user.id } });

    console.log(`   🗑️  ${email} (${user.name}): supprimé`);
  }

  // Supprimer aussi les audit logs de test
  const deleted = await prismaBase.auditLog.deleteMany({
    where: { action: "enseignants.import", reason: "Import de test-enseignants.xlsx" },
  });
  console.log(`\n   🗑️  ${deleted.count} audit log(s) de test supprimé(s)`);

  console.log("\n✅ Nettoyage terminé");
  process.exit(0);
}

main().catch(console.error);
