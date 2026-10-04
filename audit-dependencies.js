const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function auditDependencies() {
  try {
    console.log('\n=== AUDIT COMPLET DES DÉPENDANCES ===\n');
    
    const siteCampusCentral = 'cmsd80smv0001zbfn76yxe0gw';
    
    // Récupérer tous les IDs des élèves à supprimer
    const elevesIds = await prisma.eleve.findMany({
      where: {
        siteId: siteCampusCentral,
        classeId: null
      },
      select: { id: true }
    });
    
    const idsArray = elevesIds.map(e => e.id);
    console.log(`✓ Élèves à supprimer: ${idsArray.length}`);
    
    // 1. Factures
    const factures = await prisma.facture.count({
      where: { eleveId: { in: idsArray } }
    });
    console.log(`✓ Factures: ${factures}`);
    
    // 2. Paiements (via factures)
    const paiements = await prisma.$queryRaw`
      SELECT COUNT(*) as count
      FROM paiements p
      JOIN factures f ON f.id = p."factureId"
      WHERE f."eleveId" = ANY(${idsArray})
    `;
    console.log(`✓ Paiements: ${paiements[0].count}`);
    
    // 3. Relances
    const relances = await prisma.$queryRaw`
      SELECT COUNT(*) as count
      FROM relances r
      JOIN factures f ON f.id = r."factureId"
      WHERE f."eleveId" = ANY(${idsArray})
    `;
    console.log(`✓ Relances: ${relances[0].count}`);
    
    // 4. Absences
    const absences = await prisma.absence.count({
      where: { eleveId: { in: idsArray } }
    });
    console.log(`✓ Absences: ${absences}`);
    
    // 5. Notes
    const notes = await prisma.note.count({
      where: { eleveId: { in: idsArray } }
    });
    console.log(`✓ Notes: ${notes}`);
    
    // 6. Bulletins
    const bulletins = await prisma.bulletin.count({
      where: { eleveId: { in: idsArray } }
    });
    console.log(`✓ Bulletins: ${bulletins}`);
    
    // 7. Incidents
    const incidents = await prisma.incident.count({
      where: { eleveId: { in: idsArray } }
    });
    console.log(`✓ Incidents: ${incidents}`);
    
    // 8. Documents
    const documents = await prisma.document.count({
      where: { eleveId: { in: idsArray } }
    });
    console.log(`✓ Documents: ${documents}`);
    
    // 9. Parents (via EleveParent)
    const parents = await prisma.$queryRaw`
      SELECT COUNT(DISTINCT ep."parentId") as count
      FROM eleve_parents ep
      WHERE ep."eleveId" = ANY(${idsArray})
    `;
    console.log(`✓ Liens avec parents: ${parents[0].count}`);
    
    // 10. Exclusions
    const exclusions = await prisma.exclusionEleve.count({
      where: { eleveId: { in: idsArray } }
    });
    console.log(`✓ Exclusions: ${exclusions}`);
    
    // 11. Parcours scolaires
    const parcours = await prisma.parcoursScolaire.count({
      where: { eleveId: { in: idsArray } }
    });
    console.log(`✓ Parcours scolaires: ${parcours}`);
    
    // 12. Dispenses
    const dispenses = await prisma.dispenseMatiere.count({
      where: { eleveId: { in: idsArray } }
    });
    console.log(`✓ Dispenses matière: ${dispenses}`);
    
    console.log('\n=== RÉSUMÉ ===\n');
    console.log(`Total à supprimer:`);
    console.log(`- Élèves: ${idsArray.length}`);
    console.log(`- Factures: ${factures}`);
    console.log(`- Paiements: ${paiements[0].count}`);
    console.log(`- Relances: ${relances[0].count}`);
    console.log(`- Absences: ${absences}`);
    console.log(`- Notes: ${notes}`);
    console.log(`- Bulletins: ${bulletins}`);
    console.log(`- Incidents: ${incidents}`);
    console.log(`- Documents: ${documents}`);
    console.log(`- Liaisons Parents: ${parents[0].count}`);
    console.log(`- Exclusions: ${exclusions}`);
    console.log(`- Parcours: ${parcours}`);
    console.log(`- Dispenses: ${dispenses}`);
    
  } catch (error) {
    console.error('Erreur:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

auditDependencies();
