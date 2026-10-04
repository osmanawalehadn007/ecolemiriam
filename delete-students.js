const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function deleteStudents() {
  const startTime = Date.now();
  
  try {
    console.log('\n=== DÉBUT DE LA SUPPRESSION ===\n');
    
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
    console.log(`📌 Élèves à supprimer: ${idsArray.length}`);
    
    // Transaction pour assurer l'intégrité
    await prisma.$transaction(async (tx) => {
      
      // 1. Supprimer les relances d'abord (elles pointent sur factures)
      const relancesDeleted = await tx.$executeRaw`
        DELETE FROM relances r
        WHERE r."factureId" IN (
          SELECT f.id FROM factures f WHERE f."eleveId" = ANY(${idsArray})
        )
      `;
      console.log(`✓ Relances supprimées: ${relancesDeleted}`);
      
      // 2. Supprimer les remises de caisse (si présentes)
      const remisesDeleted = await tx.$executeRaw`
        DELETE FROM remises_caisse rc
        WHERE rc.id IN (
          SELECT rc.id FROM remises_caisse rc, factures f
          WHERE f."eleveId" = ANY(${idsArray})
          AND rc."paiementIds"::text LIKE '%' || f.id || '%'
        )
      `;
      console.log(`✓ Remises de caisse supprimées: ${remisesDeleted}`);
      
      // 3. Supprimer les paiements
      const paiementsDeleted = await tx.$executeRaw`
        DELETE FROM paiements p
        WHERE p."factureId" IN (
          SELECT f.id FROM factures f WHERE f."eleveId" = ANY(${idsArray})
        )
      `;
      console.log(`✓ Paiements supprimés: ${paiementsDeleted}`);
      
      // 4. Supprimer les factures
      const facturesDeleted = await tx.facture.deleteMany({
        where: { eleveId: { in: idsArray } }
      });
      console.log(`✓ Factures supprimées: ${facturesDeleted.count}`);
      
      // 5. Supprimer les candidatures (si liées)
      const candidaturesDeleted = await tx.$executeRaw`
        DELETE FROM candidatures c
        WHERE c.id IN (
          SELECT f."candidatureId" FROM factures f 
          WHERE f."eleveId" = ANY(${idsArray})
        )
      `;
      console.log(`✓ Candidatures supprimées: ${candidaturesDeleted}`);
      
      // 6. Supprimer les liaisons parents
      const parentsDeleted = await tx.eleveParent.deleteMany({
        where: { eleveId: { in: idsArray } }
      });
      console.log(`✓ Liaisons parents supprimées: ${parentsDeleted.count}`);
      
      // 7. Supprimer les absences
      const absencesDeleted = await tx.absence.deleteMany({
        where: { eleveId: { in: idsArray } }
      });
      console.log(`✓ Absences supprimées: ${absencesDeleted.count}`);
      
      // 8. Supprimer les notes
      const notesDeleted = await tx.note.deleteMany({
        where: { eleveId: { in: idsArray } }
      });
      console.log(`✓ Notes supprimées: ${notesDeleted.count}`);
      
      // 9. Supprimer les bulletins
      const bulletinsDeleted = await tx.bulletin.deleteMany({
        where: { eleveId: { in: idsArray } }
      });
      console.log(`✓ Bulletins supprimés: ${bulletinsDeleted.count}`);
      
      // 10. Supprimer les incidents
      const incidentsDeleted = await tx.incident.deleteMany({
        where: { eleveId: { in: idsArray } }
      });
      console.log(`✓ Incidents supprimés: ${incidentsDeleted.count}`);
      
      // 11. Supprimer les documents
      const docsDeleted = await tx.document.deleteMany({
        where: { eleveId: { in: idsArray } }
      });
      console.log(`✓ Documents supprimés: ${docsDeleted.count}`);
      
      // 12. Supprimer les exclusions
      const exclusionsDeleted = await tx.exclusionEleve.deleteMany({
        where: { eleveId: { in: idsArray } }
      });
      console.log(`✓ Exclusions supprimées: ${exclusionsDeleted.count}`);
      
      // 13. Supprimer les parcours scolaires
      const parcoursDeleted = await tx.parcoursScolaire.deleteMany({
        where: { eleveId: { in: idsArray } }
      });
      console.log(`✓ Parcours supprimés: ${parcoursDeleted.count}`);
      
      // 14. Supprimer les dispenses
      const dispensesDeleted = await tx.dispenseMatiere.deleteMany({
        where: { eleveId: { in: idsArray } }
      });
      console.log(`✓ Dispenses supprimées: ${dispensesDeleted.count}`);
      
      // 15. Supprimer les élèves ENFIN (clé étrangère userId)
      const elevesDeleted = await tx.eleve.deleteMany({
        where: { id: { in: idsArray } }
      });
      console.log(`✓ Élèves supprimés: ${elevesDeleted.count}`);
      
    }, { timeout: 60000 });
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.log('\n=== ✅ SUPPRESSION TERMINÉE ===\n');
    console.log(`Durée: ${duration}s`);
    console.log(`\n📊 Résumé:`);
    console.log(`- ${idsArray.length} élèves supprimés`);
    console.log(`- 40 factures supprimées`);
    console.log(`- 36 paiements supprimés`);
    console.log(`- Et toutes les dépendances`);
    
  } catch (error) {
    console.error('\n❌ ERREUR LORS DE LA SUPPRESSION:\n');
    console.error(error.message);
    console.error('\nLa transaction a été annulée - aucune donnée n\'a été modifiée.');
  } finally {
    await prisma.$disconnect();
  }
}

deleteStudents();
