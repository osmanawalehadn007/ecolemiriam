/**
 * Audit: identifie tous les niveaux sans tarif configuré pour 2026-2027,
 * pour chaque site + global.
 *
 * Usage: npx tsx scripts/audit-tarifs-manquants.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
  datasourceUrl: process.env.DIRECT_URL,
});

const ANNEE = "2026-2027";
const TENANT_ID = "cms8kt0b40001zbi3o63y7c5v";

async function main() {
  // 1. Tous les sites
  const sites = await prisma.site.findMany({
    where: { tenantId: TENANT_ID, deletedAt: null },
    select: { id: true, nom: true },
    orderBy: { nom: "asc" },
  });

  console.log("\n=== SITES ===");
  for (const s of sites) {
    console.log(`  ${s.id} → ${s.nom}`);
  }

  // 2. Tous les niveaux distincts utilisés dans les classes pour 2026-2027
  const classes = await prisma.classe.findMany({
    where: { tenantId: TENANT_ID, annee: ANNEE },
    select: { niveau: true, siteId: true, nom: true },
    orderBy: { niveau: "asc" },
  });

  // Map: siteId → Set<niveau>
  const niveauxParSite = new Map<string, Set<string>>();
  for (const c of classes) {
    const key = c.siteId ?? "NULL";
    if (!niveauxParSite.has(key)) niveauxParSite.set(key, new Set());
    niveauxParSite.get(key)!.add(c.niveau);
  }

  console.log(`\n=== NIVEAUX PAR SITE (classes ${ANNEE}) ===`);
  for (const [siteId, niveaux] of niveauxParSite) {
    const siteName = sites.find((s) => s.id === siteId)?.nom ?? "GLOBAL/SANS-SITE";
    console.log(`  ${siteName} (${siteId}):`);
    for (const n of [...niveaux].sort()) {
      console.log(`    - ${n}`);
    }
  }

  // 3. Tous les tarifs configurés pour 2026-2027
  const tarifs = await prisma.tarifNiveau.findMany({
    where: { tenantId: TENANT_ID, annee: ANNEE },
    select: { id: true, niveau: true, siteId: true, mensualite: true, fraisInscription: true, fraisRenouvellement: true, actif: true },
    orderBy: [{ siteId: "asc" }, { niveau: "asc" }],
  });

  console.log(`\n=== TARIFS CONFIGURÉS (${ANNEE}) ===`);
  for (const t of tarifs) {
    const siteName = t.siteId ? sites.find((s) => s.id === t.siteId)?.nom ?? t.siteId : "GLOBAL";
    console.log(`  [${t.actif ? "ACTIF" : "INACTIF"}] ${t.niveau} | site=${siteName} | mensualité=${t.mensualite} | inscription=${t.fraisInscription} | renouvellement=${t.fraisRenouvellement}`);
  }

  // 4. Gap analysis: pour chaque (site, niveau) utilisé dans une classe,
  //    vérifier s'il existe un tarif actif (site-spécifique OU global)
  const tarifsActifsByNiveauSite = new Map<string, boolean>();
  const tarifsActifsGlobal = new Set<string>();
  for (const t of tarifs) {
    if (!t.actif) continue;
    const nKey = t.niveau.toLowerCase();
    if (t.siteId) {
      tarifsActifsByNiveauSite.set(`${nKey}|${t.siteId}`, true);
    } else {
      tarifsActifsGlobal.add(nKey);
    }
  }

  console.log(`\n=== NIVEAUX SANS TARIF ACTIF (${ANNEE}) ===`);
  let countMissing = 0;
  for (const [siteId, niveaux] of niveauxParSite) {
    const siteName = sites.find((s) => s.id === siteId)?.nom ?? "SANS-SITE";
    for (const niveau of [...niveaux].sort()) {
      const nKey = niveau.toLowerCase();
      const hasSiteSpecific = tarifsActifsByNiveauSite.get(`${nKey}|${siteId}`);
      const hasGlobal = tarifsActifsGlobal.has(nKey);
      if (!hasSiteSpecific && !hasGlobal) {
        console.log(`  ❌ ${siteName} → "${niveau}" (aucun tarif site-spécifique ni global)`);
        countMissing++;
      } else if (!hasSiteSpecific && hasGlobal) {
        console.log(`  ⚠️  ${siteName} → "${niveau}" (fallback global uniquement, pas de tarif site-spécifique)`);
      }
    }
  }

  if (countMissing === 0) {
    console.log("  ✅ Tous les niveaux ont au moins un tarif (global ou site-spécifique).");
  } else {
    console.log(`\n  TOTAL: ${countMissing} niveau(s) sans AUCUN tarif actif.`);
  }

  // 5. Niveaux orphelins: tarifs configurés pour un niveau qui n'existe dans aucune classe
  const allNiveauxInClasses = new Set<string>();
  for (const niv of niveauxParSite.values()) {
    for (const n of niv) allNiveauxInClasses.add(n.toLowerCase());
  }
  console.log(`\n=== TARIFS SANS CLASSE CORRESPONDANTE (niveau orphelin) ===`);
  for (const t of tarifs) {
    if (!allNiveauxInClasses.has(t.niveau.toLowerCase())) {
      const siteName = t.siteId ? sites.find((s) => s.id === t.siteId)?.nom ?? t.siteId : "GLOBAL";
      console.log(`  ℹ️  Tarif "${t.niveau}" (${siteName}) — aucune classe ${ANNEE} n'utilise ce niveau`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
