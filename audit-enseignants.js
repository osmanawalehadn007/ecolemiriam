const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function auditEnseignants() {
  try {
    console.log('\n=== AUDIT ENSEIGNANTS DU SITE 01 ===\n');
    
    const siteCampusCentral = 'cmsd80smv0001zbfn76yxe0gw';
    
    // 1. Enseignants via EnseignantSite
    const enseignantsLies = await prisma.enseignantSite.findMany({
      where: { siteId: siteCampusCentral },
      select: {
        enseignant: {
          select: {
            id: true,
            userId: true,
            matricule: true,
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                firstName: true,
                lastName: true
              }
            }
          }
        }
      }
    });
    
    console.log(`✓ Enseignants liés au site 01: ${enseignantsLies.length}`);
    
    if (enseignantsLies.length > 0) {
      console.log('\nDétail:\n');
      enseignantsLies.forEach((es, idx) => {
        const e = es.enseignant;
        console.log(`${idx + 1}. ${e.user?.name || 'Sans nom'} (${e.user?.email || 'Sans email'})`);
        console.log(`   ID Enseignant: ${e.id}`);
        console.log(`   ID User: ${e.userId}`);
        console.log(`   Matricule: ${e.matricule || 'N/A'}`);
      });
    }
    
    const idsEnseignants = enseignantsLies.map(es => es.enseignant.id);
    
    // 2. Vérifier les dépendances pour chaque enseignant
    if (idsEnseignants.length > 0) {
      console.log('\n✓ Dépendances:\n');
      
      // Classes où ils sont prof principal
      const classesProfPrinc = await prisma.classe.count({
        where: { profPrincipalId: { in: idsEnseignants } }
      });
      console.log(`  - Classes (prof principal): ${classesProfPrinc}`);
      
      // Emploi du temps
      const emploiTemps = await prisma.emploiTemps.count({
        where: { enseignantId: { in: idsEnseignants } }
      });
      console.log(`  - Emploi du temps: ${emploiTemps}`);
      
      // Disponibilités
      const disponibilites = await prisma.disponibiliteEnseignant.count({
        where: { enseignantId: { in: idsEnseignants } }
      });
      console.log(`  - Disponibilités: ${disponibilites}`);
      
      // Indisponibilités
      const indisponibilites = await prisma.indisponibiliteEnseignant.count({
        where: { enseignantId: { in: idsEnseignants } }
      });
      console.log(`  - Indisponibilités: ${indisponibilites}`);
      
      // Enseignant Matière
      const enseignantMatiere = await prisma.enseignantMatiere.count({
        where: { enseignantId: { in: idsEnseignants } }
      });
      console.log(`  - Enseignant Matière: ${enseignantMatiere}`);
      
      // Enseignant Affectation
      const enseignantAffectation = await prisma.enseignantAffectation.count({
        where: { enseignantId: { in: idsEnseignants } }
      });
      console.log(`  - Enseignant Affectation: ${enseignantAffectation}`);
      
      // Absences Personnel
      const absencesPersonnel = await prisma.absencePersonnel.count({
        where: { enseignantId: { in: idsEnseignants } }
      });
      console.log(`  - Absences Personnel: ${absencesPersonnel}`);
      
      // Congés
      const conges = await prisma.congePersonnel.count({
        where: { enseignantId: { in: idsEnseignants } }
      });
      console.log(`  - Congés: ${conges}`);
      
      // Fiche RH
      const ficheRH = await prisma.ficheRH.count({
        where: { enseignantId: { in: idsEnseignants } }
      });
      console.log(`  - Fiches RH: ${ficheRH}`);
      
      // Cahier de texte
      const cahierTexte = await prisma.cahierTexte.count({
        where: { enseignantId: { in: idsEnseignants } }
      });
      console.log(`  - Cahier de texte: ${cahierTexte}`);
    }
    
    console.log('\n=== RÉSUMÉ ===\n');
    console.log(`À supprimer: ${idsEnseignants.length} enseignants du site 01`);
    
  } catch (error) {
    console.error('Erreur:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

auditEnseignants();
