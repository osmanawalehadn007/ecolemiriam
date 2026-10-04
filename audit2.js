const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function audit() {
  try {
    console.log('\n=== RECHERCHE: Élèves du site 01 sans classe ===\n');
    
    // Site Campus Central (SITE-01)
    const siteCampusCentral = 'cmsd80smv0001zbfn76yxe0gw';
    
    // 1. Élèves du site 01 avec classeId NULL
    const elevesSanClasse = await prisma.eleve.findMany({
      where: {
        siteId: siteCampusCentral,
        classeId: null
      },
      select: {
        id: true,
        matricule: true,
        nom: true,
        prenom: true,
        dateNaissance: true,
        statut: true,
        siteId: true,
        classeId: true
      },
      orderBy: { prenom: 'asc' }
    });
    
    console.log(`✓ Élèves du site "Campus Central" (SITE-01) SANS classe: ${elevesSanClasse.length}`);
    
    if (elevesSanClasse.length > 0) {
      console.log('\nDétail:\n');
      elevesSanClasse.forEach((e, idx) => {
        console.log(`${idx + 1}. ${e.nom} ${e.prenom}`);
        console.log(`   Matricule: ${e.matricule}`);
        console.log(`   Statut: ${e.statut}`);
        console.log(`   ID: ${e.id}`);
      });
    }
    
    // 2. Total élèves du site
    const elevesTotalSite = await prisma.eleve.count({
      where: { siteId: siteCampusCentral }
    });
    console.log(`\n✓ Total élèves du site "Campus Central": ${elevesTotalSite}`);
    
    // 3. Élèves du site avec classe
    const elevesAvecClasse = await prisma.eleve.count({
      where: {
        siteId: siteCampusCentral,
        classeId: { not: null }
      }
    });
    console.log(`✓ Élèves du site avec classe: ${elevesAvecClasse}`);
    
    // 4. Breakdown par statut
    const parStatut = await prisma.eleve.groupBy({
      by: ['statut'],
      where: { 
        siteId: siteCampusCentral,
        classeId: null
      },
      _count: true
    });
    
    if (parStatut.length > 0) {
      console.log(`\n✓ Breakdown par statut (sans classe):`);
      parStatut.forEach(s => {
        console.log(`  - ${s.statut}: ${s._count}`);
      });
    }
    
  } catch (error) {
    console.error('Erreur:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

audit();
