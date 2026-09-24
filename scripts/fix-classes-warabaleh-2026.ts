/**
 * École Miriam — Correction du rattachement de classe (Annexe Warabaleh)
 * =====================================================================
 *
 * Contexte : le sélecteur de classe du formulaire d'admission ne filtrait que
 * par site, pas par année scolaire. Les classes de 2025-2026 restées en base
 * étaient donc proposées pour des candidatures 2026-2027. Résultat :
 *
 *   - 13 admissions 2026-2027 (créées le 2026-08-27) rangées dans la classe
 *     « 6ème1 » de 2025-2026 — alors qu'aucune 6ème n'existe pour 2026-2027 ;
 *   - 1 élève réellement issu de 2025-2026 (DIRANEH OKIEH AMAR) resté dans sa
 *     classe d'origine, qui doit être promu 6ème → 7ème.
 *
 * Ce script :
 *   1. crée (ou réutilise) la classe « 6ème1 » 2026-2027 sur le site ;
 *   2. y déplace les élèves dont `anneeInscription` = 2026-2027 ;
 *   3. promeut en 7ème1 les élèves dont `anneeInscription` = 2025-2026,
 *      conformément à `niveauSuivant()` (6ème → 7ème) ;
 *   4. journalise l'opération dans `audit_logs`.
 *
 * Idempotent : relancé, il ne fait plus rien.
 *
 *   npx tsx scripts/fix-classes-warabaleh-2026.ts          # simulation
 *   npx tsx scripts/fix-classes-warabaleh-2026.ts --apply  # écriture
 */

import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";

dotenv.config();

const prisma = new PrismaClient({
  datasources: {
    db: { url: (process.env.DIRECT_URL ?? "") + "&connection_limit=1&pool_timeout=60" },
  },
});

const SITE_ID = "cmsd9algo0003zbfn2w712q0w"; // Annexe Warabaleh
const CLASSE_SOURCE = "6ème1";
const ANNEE_SOURCE = "2025-2026";
const ANNEE_CIBLE = "2026-2027";
const NIVEAU_SUIVANT_NOM = "7ème1"; // 6ème → 7ème (cf. src/lib/niveau-suivant.ts)

async function main() {
  const apply = process.argv.includes("--apply");
  const mode = apply ? "ÉCRITURE" : "SIMULATION";
  console.log(`Mode : ${mode}\n`);

  const site = await prisma.site.findUnique({
    where: { id: SITE_ID },
    select: { id: true, nom: true, tenantId: true },
  });
  if (!site) throw new Error("Site introuvable");
  console.log(`Site : ${site.nom}`);

  const source = await prisma.classe.findFirst({
    where: { siteId: SITE_ID, nom: CLASSE_SOURCE, annee: ANNEE_SOURCE },
    select: { id: true, nom: true, niveau: true, effectifMax: true, structureId: true, profPrincipalId: true },
  });
  if (!source) {
    console.log("✅ Rien à faire : la classe source n'existe plus.");
    return;
  }

  const eleves = await prisma.eleve.findMany({
    where: { classeId: source.id },
    select: { id: true, nom: true, prenom: true, matricule: true, anneeInscription: true },
    orderBy: { nom: "asc" },
  });
  if (eleves.length === 0) {
    console.log("✅ Rien à faire : plus aucun élève dans la classe source.");
    return;
  }

  // ── Répartition : admissions de l'année cible vs élèves à promouvoir ──────
  const aDeplacer = eleves.filter((e) => e.anneeInscription === ANNEE_CIBLE);
  const aPromouvoir = eleves.filter((e) => e.anneeInscription !== ANNEE_CIBLE);

  // ── Classe de destination des admissions : même niveau, année cible ───────
  let cible = await prisma.classe.findFirst({
    where: { siteId: SITE_ID, nom: CLASSE_SOURCE, annee: ANNEE_CIBLE },
    select: { id: true, nom: true },
  });

  const classeSuivante = await prisma.classe.findFirst({
    where: { siteId: SITE_ID, nom: NIVEAU_SUIVANT_NOM, annee: ANNEE_CIBLE },
    select: { id: true, nom: true },
  });
  if (aPromouvoir.length > 0 && !classeSuivante) {
    throw new Error(`Classe « ${NIVEAU_SUIVANT_NOM} » (${ANNEE_CIBLE}) introuvable sur ce site.`);
  }

  console.log(`\nClasse source : ${source.nom} (${source.niveau}, ${ANNEE_SOURCE}) — ${eleves.length} élève(s)`);
  console.log(`\n→ ${aDeplacer.length} admission(s) ${ANNEE_CIBLE} vers « ${CLASSE_SOURCE} » (${ANNEE_CIBLE})${cible ? " [classe existante]" : " [classe à créer]"} :`);
  for (const e of aDeplacer) console.log(`   ${e.matricule} — ${e.nom} ${e.prenom}`);
  console.log(`\n→ ${aPromouvoir.length} promotion(s) 6ème → 7ème vers « ${NIVEAU_SUIVANT_NOM} » (${ANNEE_CIBLE}) :`);
  for (const e of aPromouvoir) console.log(`   ${e.matricule} — ${e.nom} ${e.prenom} (inscrit ${e.anneeInscription})`);

  if (!apply) {
    console.log("\nSimulation terminée. Relancer avec --apply pour écrire.");
    return;
  }

  await prisma.$transaction(async (tx) => {
    if (aDeplacer.length > 0) {
      if (!cible) {
        const creee = await tx.classe.create({
          data: {
            tenantId: site.tenantId,
            siteId: SITE_ID,
            nom: CLASSE_SOURCE,
            niveau: source.niveau,
            annee: ANNEE_CIBLE,
            effectifMax: source.effectifMax,
            structureId: source.structureId,
            profPrincipalId: source.profPrincipalId,
          },
          select: { id: true, nom: true },
        });
        cible = creee;
        console.log(`\n✅ Classe créée : ${creee.nom} (${source.niveau}, ${ANNEE_CIBLE}) — ${creee.id}`);
      }
      await tx.eleve.updateMany({
        where: { id: { in: aDeplacer.map((e) => e.id) } },
        data: { classeId: cible.id },
      });
      console.log(`✅ ${aDeplacer.length} élève(s) déplacé(s) vers ${cible.nom} (${ANNEE_CIBLE}).`);
    }

    if (aPromouvoir.length > 0) {
      await tx.eleve.updateMany({
        where: { id: { in: aPromouvoir.map((e) => e.id) } },
        data: { classeId: classeSuivante!.id },
      });
      console.log(`✅ ${aPromouvoir.length} élève(s) promu(s) vers ${classeSuivante!.nom} (${ANNEE_CIBLE}).`);
    }

    await tx.auditLog.create({
      data: {
        tenantId: site.tenantId,
        action: "maintenance.correction-classe-annee",
        verdict: "ALLOWED",
        resource: "eleves",
        resourceId: source.id,
        reason:
          `Correction du rattachement de classe sur ${site.nom} : ${aDeplacer.length} admission(s) ` +
          `${ANNEE_CIBLE} déplacée(s) de « ${CLASSE_SOURCE} » ${ANNEE_SOURCE} vers ${ANNEE_CIBLE}, ` +
          `${aPromouvoir.length} promotion(s) 6ème → 7ème.`,
        metadata: {
          script: "fix-classes-warabaleh-2026.ts",
          siteId: SITE_ID,
          classeSourceId: source.id,
          deplaces: aDeplacer.map((e) => e.matricule),
          promus: aPromouvoir.map((e) => e.matricule),
        },
      },
    });
  }, { timeout: 30000, maxWait: 60000 });

  console.log("\n✅ Correction appliquée.");
}

main()
  .catch((e) => {
    console.error("Erreur:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
