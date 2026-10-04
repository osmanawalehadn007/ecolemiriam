const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function audit() {
  try {
    console.log('\n=== AUDIT AVANT SUPPRESSION ===\n');
    
    // 1. Élèves sans site
    const elevesSansSite = await prisma.eleve.count({
      where: { siteId: null }
    });
    console.log(`✓ Élèves sans site (siteId IS NULL): ${elevesSansSite}`);
    
    // 2. Trouver tous les sites
    const sites = await prisma.site.findMany({
      select: { id: true, nom: true, code: true },
      orderBy: { code: 'asc' }
    });
    
    console.log(`\n✓ Sites disponibles (total: ${sites.length}):`);
    sites.forEach(s => {
      console.log(`  - Code: ${s.code || 'N/A'} | Nom: ${s.nom} | ID: ${s.id}`);
    });
    
    // Chercher le site campus principal ou code 01
    const siteCampusPrincipal = sites.find(s => 
      s.code === '01' || 
      (s.nom && s.nom.toLowerCase().includes('principal'))
    );
    
    if (siteCampusPrincipal) {
      console.log(`\n✓ Site "Campus Principal" identifié:`);
      console.log(`  ID: ${siteCampusPrincipal.id}`);
      console.log(`  Nom: ${siteCampusPrincipal.nom}`);
      console.log(`  Code: ${siteCampusPrincipal.code || 'N/A'}`);
      
      // 3. Enseignants liés au site
      const enseignantsCountSite = await prisma.enseignantSite.count({
        where: { siteId: siteCampusPrincipal.id }
      });
      console.log(`\n✓ Enseignants via EnseignantSite: ${enseignantsCountSite}`);
      
      // 4. Matières liées au site
      const matieresLiees = await prisma.matiere.count({
        where: { siteId: siteCampusPrincipal.id }
      });
      console.log(`✓ Matières liées au site: ${matieresLiees}`);
      
      // 5. Classes du site
      const classesLiees = await prisma.classe.count({
        where: { siteId: siteCampusPrincipal.id }
      });
      console.log(`✓ Classes liées au site: ${classesLiees}`);
      
      // 6. Emploi du temps
      const emploiTemps = await prisma.$queryRaw`
        SELECT COUNT(DISTINCT et.id)::int as count
        FROM emplois_temps et
        JOIN classes c ON c.id = et."classeId"
        WHERE c."siteId" = ${siteCampusPrincipal.id}
      `;
      console.log(`✓ Créneaux emploi du temps du site: ${emploiTemps[0].count}`);
      
      // 7. Élèves du site
      const elevesLiees = await prisma.eleve.count({
        where: { siteId: siteCampusPrincipal.id }
      });
      console.log(`✓ Élèves liés au site: ${elevesLiees}`);
      
      console.log('\n=== RÉSUMÉ POUR SUPPRESSION ===\n');
      console.log(`À SUPPRIMER:`);
      console.log(`1. ${elevesSansSite} élèves SANS site`);
      console.log(`2. Site: "${siteCampusPrincipal.nom}" (ID: ${siteCampusPrincipal.id})`);
      console.log(`   - Enseignants: ${enseignantsCountSite}`);
      console.log(`   - Matières: ${matieresLiees}`);
      console.log(`   - Classes: ${classesLiees}`);
      console.log(`   - Emploi du temps: ${emploiTemps[0].count}`);
      console.log(`   - Élèves: ${elevesLiees}`);
      
    } else {
      console.log('\n⚠️  Site "Campus Principal" (code 01) non trouvé!');
    }
    
  } catch (error) {
    console.error('Erreur:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

audit();
