/**
 * QA — aperçu (dryRun) de la facturation du mois, SITE PAR SITE.
 * LECTURE SEULE : n'écrit aucune facture, ne réserve aucun numéro.
 *
 * Même moteur que le cron (`genererMensualitesPourTenant`), donc mêmes règles
 * de résolution tarifaire que la production (clé de niveau canonique,
 * tarif du site sinon tarif global).
 *
 * Usage :
 *   set -a; . ./.env; set +a
 *   npx tsx scripts/qa-facturation-par-site.ts [--mois=9]
 */
import { PrismaClient } from "@prisma/client";
import { runWithTenant } from "@/lib/prisma";
import { genererMensualitesPourTenant } from "@/lib/factures/mensualites";

const prisma = new PrismaClient();

async function main() {
  const mois = parseInt(
    process.argv.find((a) => a.startsWith("--mois="))?.split("=")[1] ??
      String(new Date().getMonth() + 1),
    10,
  );

  const tenant = await prisma.tenant.findFirst({ select: { id: true, name: true } });
  if (!tenant) throw new Error("Aucun tenant en base");

  const annee = (
    await prisma.anneesScolaires.findFirst({
      where: { tenantId: tenant.id, isCurrent: true },
      select: { libelle: true },
    })
  )?.libelle;
  if (!annee) throw new Error("Aucune année scolaire active");

  const sites = await prisma.site.findMany({
    where: { tenantId: tenant.id, deletedAt: null },
    select: { id: true, nom: true },
    orderBy: { nom: "asc" },
  });

  // Élèves facturables par site (pour mesurer la couverture du périmètre).
  const eleves = await prisma.eleve.findMany({
    where: { tenantId: tenant.id, statut: "ACTIF", deletedAt: null },
    select: { siteId: true, classe: { select: { niveau: true } } },
  });

  console.log(`\nTenant ${tenant.name} — année ${annee} — mois ${mois}`);
  console.log(`Sites : ${sites.length} | élèves actifs : ${eleves.length}\n`);

  const cibles: { id: string | null; nom: string }[] = [
    ...sites.map((s) => ({ id: s.id as string | null, nom: s.nom })),
    { id: null, nom: "TOUS SITES (périmètre global)" },
  ];

  let cumulGen = 0;
  let cumulMontant = 0;
  let cumulSansTarif = 0;

  for (const site of cibles) {
    const eleveWhere = site.id ? { siteId: site.id } : {};
    // Un site peut facturer avec son tarif propre OU le tarif global : on
    // reproduit exactement ce que voit l'action serveur site-scopée.
    const tarifWhere = site.id ? { OR: [{ siteId: site.id }, { siteId: null }] } : {};

    const r = await runWithTenant(tenant.id, site.id, () =>
      genererMensualitesPourTenant({
        tenantId: tenant.id,
        mois,
        annee,
        eleveWhere,
        tarifWhere,
        dryRun: true,
        acteurId: null,
      }),
    );

    const elevesSite = eleves.filter((e) => (site.id ? e.siteId === site.id : true));
    const sansClasse = elevesSite.filter((e) => !e.classe?.niveau).length;

    console.log(
      `• ${site.nom}\n` +
        `    élèves actifs du périmètre : ${elevesSite.length}` +
        (sansClasse ? ` (dont ${sansClasse} sans classe → non facturables)` : "") +
        `\n    → à créer : ${r.generated} | déjà facturés/ignorés : ${r.skipped - r.sansTarif}` +
        ` | SANS TARIF : ${r.sansTarif}\n    → montant projeté : ${r.montantTotal} DJF`,
    );

    if (!site.id) {
      cumulGen = r.generated;
      cumulMontant = r.montantTotal;
      cumulSansTarif = r.sansTarif;
    }
  }

  console.log(
    `\n═══ TOTAL tenant (tous sites, une passe) : ${cumulGen} facture(s) à créer, ` +
      `${cumulMontant} DJF, ${cumulSansTarif} sans tarif ═══`,
  );
  console.log("APERÇU UNIQUEMENT — aucune écriture effectuée.\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
