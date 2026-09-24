/**
 * École Miriam — Audit de cohérence (site × année scolaire)
 * =========================================================
 *
 * L'isolation par site est vérifiée par `audit-site-isolation.ts`. Ce script
 * couvre la dimension oubliée : l'ANNÉE SCOLAIRE, et le croisement des deux.
 *
 * Une classe d'une année révolue reste en base (historique des notes, des
 * bulletins, des absences) mais n'est plus une structure d'accueil. Tant que
 * les sélecteurs de classe ne filtraient que par site, ces structures mortes
 * réapparaissaient dans les formulaires d'inscription — d'où l'impression
 * d'une « fuite entre sites » alors que la classe appartenait bien au site,
 * mais à l'année précédente.
 *
 * Contrôles :
 *   1. Classes en double  : même (tenant, site, nom, année) → ambiguïté dans
 *      tous les sélecteurs ; empêche la contrainte d'unicité.
 *   2. Classes orphelines : siteId NULL → visibles depuis tous les sites
 *      (la policy RLS laisse toujours passer `"siteId" IS NULL`).
 *   3. Élèves hors-site   : eleve.siteId ≠ classe.siteId → l'élève est compté
 *      dans un site et scolarisé dans un autre.
 *   4. Élèves hors-année  : élève actif rattaché à une classe d'une année
 *      autre que l'année courante du tenant.
 *   5. Candidatures sans site : ne peuvent produire qu'un élève orphelin.
 *
 * Lecture seule — aucune écriture.
 *
 *   npx tsx scripts/audit-coherence-site-annee.ts
 */

import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";

dotenv.config();

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
});

let problemes = 0;

function titre(s: string) {
  console.log(`\n${s}\n${"─".repeat(s.length)}`);
}

async function main() {
  const tenants = await prisma.tenant.findMany({ select: { id: true, name: true } });

  for (const tenant of tenants) {
    console.log(`\n═══ ${tenant.name} (${tenant.id}) ═══`);

    const anneeCourante = await prisma.anneesScolaires.findFirst({
      where: { tenantId: tenant.id, isCurrent: true },
      select: { libelle: true },
    });
    console.log(`Année courante : ${anneeCourante?.libelle ?? "AUCUNE (à déclarer dans Paramètres)"}`);
    if (!anneeCourante) problemes++;

    const sites = await prisma.site.findMany({
      where: { tenantId: tenant.id },
      select: { id: true, nom: true },
    });
    const nomSite = new Map(sites.map((s) => [s.id, s.nom]));

    const classes = await prisma.classe.findMany({
      where: { tenantId: tenant.id },
      select: { id: true, nom: true, niveau: true, annee: true, siteId: true },
    });

    // 1. Doublons (tenant, site, nom, année)
    const parCle = new Map<string, typeof classes>();
    for (const c of classes) {
      const cle = `${c.siteId ?? "SANS-SITE"}|${c.annee}|${c.nom}`;
      (parCle.get(cle) ?? parCle.set(cle, []).get(cle)!).push(c);
    }
    const doublons = [...parCle.entries()].filter(([, v]) => v.length > 1);
    if (doublons.length > 0) {
      titre("1. Classes en double (site, année, nom)");
      for (const [cle, v] of doublons) {
        console.log(`  ⚠️  ${cle} → ${v.length} exemplaires : ${v.map((c) => c.id).join(", ")}`);
        problemes++;
      }
    }

    // 2. Classes sans site
    const sansSite = classes.filter((c) => !c.siteId);
    if (sansSite.length > 0) {
      titre("2. Classes sans site (visibles depuis tous les sites)");
      for (const c of sansSite) {
        console.log(`  ⚠️  ${c.nom} (${c.niveau}, ${c.annee}) — ${c.id}`);
        problemes++;
      }
    }

    // 3 & 4. Élèves incohérents
    const eleves = await prisma.eleve.findMany({
      where: { tenantId: tenant.id, statut: "ACTIF" },
      select: {
        id: true, nom: true, prenom: true, siteId: true, anneeInscription: true,
        classe: { select: { id: true, nom: true, annee: true, siteId: true } },
      },
    });

    const horsSite = eleves.filter(
      (e) => e.classe && e.classe.siteId && e.siteId && e.classe.siteId !== e.siteId
    );
    if (horsSite.length > 0) {
      titre("3. Élèves dont la classe appartient à un AUTRE site");
      for (const e of horsSite) {
        console.log(
          `  ⚠️  ${e.prenom} ${e.nom} — site ${nomSite.get(e.siteId!) ?? e.siteId}` +
            ` / classe ${e.classe!.nom} du site ${nomSite.get(e.classe!.siteId!) ?? e.classe!.siteId}`
        );
        problemes++;
      }
    }

    if (anneeCourante) {
      const horsAnnee = eleves.filter(
        (e) => e.classe && e.classe.annee !== anneeCourante.libelle
      );
      if (horsAnnee.length > 0) {
        titre(`4. Élèves actifs rattachés à une classe hors année courante (${anneeCourante.libelle})`);
        for (const e of horsAnnee) {
          console.log(
            `  ⚠️  ${e.prenom} ${e.nom} — classe ${e.classe!.nom} (${e.classe!.annee})` +
              ` sur ${nomSite.get(e.classe!.siteId ?? "") ?? "site inconnu"} — eleve ${e.id}`
          );
          problemes++;
        }
      }
    }

    // 5. Candidatures sans site
    const candSansSite = await prisma.candidature.count({
      where: { tenantId: tenant.id, siteId: null },
    });
    if (candSansSite > 0) {
      titre("5. Candidatures sans site");
      console.log(`  ⚠️  ${candSansSite} candidature(s) sans site — inscriptions bloquées (élève orphelin).`);
      problemes++;
    }
  }

  console.log(
    problemes === 0
      ? "\n✅ Aucune incohérence site × année détectée."
      : `\n❌ ${problemes} incohérence(s) détectée(s) — voir le détail ci-dessus.`
  );
  await prisma.$disconnect();
  process.exit(problemes === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("Erreur:", e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exit(2);
});
