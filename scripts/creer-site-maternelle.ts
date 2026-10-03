/**
 * École Miriam — Création du site « Campus Maternelle »
 * =====================================================
 *
 * Contexte : des classes de maternelle ont été ajoutées sur le Campus Central.
 * La maternelle devient un site à part entière, dirigé par Mouna Mohamed.
 *
 * Ce script :
 *   1. crée (ou réutilise) le site « Campus Maternelle » ;
 *   2. y rattache la structure MATERNELLE du Campus Central (les classes
 *      gardent ainsi leur `structureId`, et l'unicité « une structure par
 *      type et par site » reste respectée) ;
 *   3. déplace les classes de cette structure, leurs élèves et les factures
 *      de ces élèves — `transferClasse` ne déplace que classes et élèves ;
 *   4. donne à la directrice l'accès au nouveau site (`UserSite`) et en fait
 *      son site principal, sans toucher à ses autres accès ;
 *   5. crée le tarif Maternelle propre au site, copie du tarif global déjà
 *      facturé à ces classes (5 000 DJF/mois) — trois tarifs globaux
 *      « Maternelle » coexistent, un tarif de site lève l'ambiguïté ;
 *   6. journalise l'opération dans `audit_logs`.
 *
 * Les paiements n'ont pas de `siteId` : ils suivent leur facture.
 *
 * Idempotent : relancé, il ne fait plus rien.
 *
 *   npx tsx scripts/creer-site-maternelle.ts          # simulation
 *   npx tsx scripts/creer-site-maternelle.ts --apply  # écriture
 */

import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";

dotenv.config();

const prisma = new PrismaClient({
  datasources: {
    db: { url: (process.env.DIRECT_URL ?? "") + "&connection_limit=1&pool_timeout=60" },
  },
});

const SITE_SOURCE_ID = "cmsd80smv0001zbfn76yxe0gw"; // Campus Central
const NOUVEAU_SITE = { nom: "Campus Maternelle", code: "SITE-04" };
const DIRECTRICE_ID = "cmsiugl410003zbbo4ku7zdpa"; // Mouna Mohamed
const TARIF_MODELE_ID = "cmuiiipah0001zbozs9hee3wt"; // Maternelle 2026-2027 global, 5 000 DJF × 10 mois

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(`Mode : ${apply ? "ÉCRITURE" : "SIMULATION"}\n`);

  const source = await prisma.site.findUnique({
    where: { id: SITE_SOURCE_ID },
    select: { id: true, nom: true, tenantId: true, ville: true },
  });
  if (!source) throw new Error("Site source introuvable");
  const tenantId = source.tenantId;

  const directrice = await prisma.user.findFirst({
    where: { id: DIRECTRICE_ID, tenantId },
    select: { id: true, name: true, role: true, siteId: true },
  });
  if (!directrice) throw new Error("Directrice introuvable");

  const modele = await prisma.tarifNiveau.findFirst({
    where: { id: TARIF_MODELE_ID, tenantId, siteId: null },
  });
  if (!modele) throw new Error("Tarif modèle introuvable");

  const cible = await prisma.site.findFirst({
    where: { tenantId, nom: NOUVEAU_SITE.nom, deletedAt: null },
    select: { id: true },
  });
  const codePris = await prisma.site.findFirst({
    where: { tenantId, code: NOUVEAU_SITE.code, NOT: { nom: NOUVEAU_SITE.nom } },
    select: { nom: true },
  });
  if (codePris) throw new Error(`Le code ${NOUVEAU_SITE.code} est déjà utilisé par « ${codePris.nom} »`);

  // La structure est sur le site source avant migration, sur la cible après.
  const structure = await prisma.structure.findFirst({
    where: {
      tenantId,
      type: "MATERNELLE",
      siteId: { in: [SITE_SOURCE_ID, ...(cible ? [cible.id] : [])] },
    },
    select: { id: true, siteId: true },
    orderBy: { createdAt: "asc" },
  });
  if (!structure) throw new Error("Structure MATERNELLE introuvable");

  const classes = await prisma.classe.findMany({
    where: { tenantId, structureId: structure.id, siteId: SITE_SOURCE_ID },
    select: { id: true, nom: true, annee: true, _count: { select: { eleves: true } } },
    orderBy: { nom: "asc" },
  });
  const classeIds = classes.map((c) => c.id);

  const eleves = await prisma.eleve.findMany({
    where: { tenantId, classeId: { in: classeIds } },
    select: { id: true, matricule: true },
  });
  const eleveIds = eleves.map((e) => e.id);

  const factureWhere = { tenantId, eleveId: { in: eleveIds }, siteId: SITE_SOURCE_ID };
  const factures = await prisma.facture.aggregate({
    where: factureWhere,
    _count: true,
    _sum: { montant: true },
  });
  // eslint-disable-next-line ecolemiriam/require-site-filter -- script de maintenance, périmètre porté par la facture
  const paiements = await prisma.paiement.aggregate({
    where: { facture: factureWhere },
    _count: true,
    _sum: { montant: true },
  });
  const acces = cible
    ? await prisma.userSite.findUnique({
        where: { userId_siteId: { userId: directrice.id, siteId: cible.id } },
      })
    : null;
  const tarifSite = cible
    ? await prisma.tarifNiveau.findFirst({
        where: { tenantId, siteId: cible.id, niveau: modele.niveau, annee: modele.annee },
        select: { id: true },
      })
    : null;
  const principalOk = !!cible && directrice.siteId === cible.id;

  console.log(`Site source : ${source.nom}`);
  console.log(`Site cible  : ${NOUVEAU_SITE.nom} [${NOUVEAU_SITE.code}] — ${cible ? "existe déjà" : "à créer"}`);
  console.log(`Structure   : MATERNELLE — ${structure.siteId === SITE_SOURCE_ID ? "à rattacher au site cible" : "déjà rattachée"}`);
  console.log(`Directrice  : ${directrice.name} (${directrice.role}) — accès ${acces ? "déjà accordé" : "à accorder"}, site principal ${principalOk ? "déjà à jour" : "à basculer"}`);
  console.log(
    `Tarif       : ${modele.niveau} ${modele.annee} — ${modele.mensualite} ${modele.devise} × ${modele.nbMois} mois, ` +
      `inscription ${modele.fraisInscription}, renouvellement ${modele.fraisRenouvellement}, ` +
      `transport ${modele.fraisTransport ?? "-"} — ${tarifSite ? "existe déjà sur le site" : "à créer sur le site"}`
  );
  console.log(`\nClasses à déplacer : ${classes.length}`);
  for (const c of classes) console.log(`  - ${c.nom} (${c.annee}) : ${c._count.eleves} élève(s)`);
  console.log(`Élèves à déplacer   : ${eleves.length}`);
  console.log(`Factures à déplacer : ${factures._count} (${factures._sum.montant ?? 0} DJF)`);
  console.log(`Paiements qui suivent leur facture : ${paiements._count} (${paiements._sum.montant ?? 0} DJF)`);

  const rienAFaire =
    cible && structure.siteId === cible.id && classes.length === 0 && factures._count === 0 && acces && principalOk && tarifSite;
  if (rienAFaire) {
    console.log("\nRien à faire : la migration est déjà appliquée.");
    return;
  }
  if (!apply) {
    console.log("\nSimulation uniquement. Relancer avec --apply pour écrire.");
    return;
  }

  await prisma.$transaction(async (tx) => {
    const site =
      cible ??
      (await tx.site.create({
        data: { tenantId, nom: NOUVEAU_SITE.nom, code: NOUVEAU_SITE.code, ville: source.ville, actif: true },
        select: { id: true },
      }));

    await tx.structure.update({ where: { id: structure.id }, data: { siteId: site.id } });
    const c = await tx.classe.updateMany({ where: { id: { in: classeIds } }, data: { siteId: site.id } });
    const e = await tx.eleve.updateMany({ where: { id: { in: eleveIds } }, data: { siteId: site.id } });
    const f = await tx.facture.updateMany({ where: factureWhere, data: { siteId: site.id } });

    await tx.userSite.upsert({
      where: { userId_siteId: { userId: directrice.id, siteId: site.id } },
      create: { userId: directrice.id, siteId: site.id },
      update: {},
    });
    await tx.user.update({ where: { id: directrice.id }, data: { siteId: site.id } });

    if (!tarifSite) {
      const { id: _id, createdAt: _c, updatedAt: _u, ...valeurs } = modele;
      await tx.tarifNiveau.create({ data: { ...valeurs, siteId: site.id } });
    }

    await tx.auditLog.create({
      data: {
        tenantId,
        action: "maintenance.creation-site-maternelle",
        verdict: "ALLOWED",
        resource: "sites",
        resourceId: site.id,
        reason:
          `Création du site « ${NOUVEAU_SITE.nom} » depuis ${source.nom} : ${c.count} classe(s), ` +
          `${e.count} élève(s) et ${f.count} facture(s) déplacés. Directrice : ${directrice.name}.`,
        metadata: {
          script: "creer-site-maternelle.ts",
          siteSourceId: SITE_SOURCE_ID,
          structureId: structure.id,
          classeIds,
          eleves: eleves.map((x) => x.matricule),
          directriceId: directrice.id,
          sitePrincipalPrecedent: directrice.siteId,
          tarifModeleId: TARIF_MODELE_ID,
        },
      },
    });

    console.log(`\n✅ ${c.count} classe(s), ${e.count} élève(s), ${f.count} facture(s) déplacés vers ${NOUVEAU_SITE.nom}.`);
  }, { timeout: 30000, maxWait: 60000 });

  console.log("✅ Migration appliquée.");
}

main()
  .catch((e) => {
    console.error("❌", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
