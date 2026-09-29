/**
 * Harmonisation des NIVEAUX — classes et grille tarifaire.
 * ============================================================
 * Le niveau est un champ texte indexé par la grille tarifaire : « 2 »,
 * « 2eme » ou « 2ème année » rendent une classe INFACTURABLE (constaté le
 * 28/09/2026 : 191 élèves de Campus Central invisibles du moteur).
 *
 * Ce script ramène toutes les valeurs au référentiel officiel
 * (`NIVEAUX_CANONIQUES`, src/lib/niveau.ts) et signale les divergences entre
 * le nom d'une classe et son niveau.
 *
 * LECTURE SEULE par défaut. Ajouter `--apply` pour écrire.
 *
 * Usage :
 *   set -a; . ./.env; set +a
 *   npx tsx scripts/harmoniser-niveaux-classes.ts              # audit
 *   npx tsx scripts/harmoniser-niveaux-classes.ts --apply      # correction
 */
import { PrismaClient } from "@prisma/client";
import { NIVEAUX_CANONIQUES, normaliserNiveau } from "@/lib/niveau";
import { cleNiveau } from "@/lib/tarifs";

const TENANT = "cms8kt0b40001zbi3o63y7c5v";

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });

interface LigneClasse {
  id: string;
  nom: string;
  niveau: string;
  annee: string;
  siteId: string | null;
  siteNom: string | null;
}

async function main() {
  const apply = process.argv.includes("--apply");

  const [classes, sites, tarifs] = await Promise.all([
    prisma.$queryRawUnsafe<LigneClasse[]>(
      `select c.id, c.nom, c.niveau, c.annee, c."siteId", s.nom as "siteNom"
         from classes c left join sites s on s.id = c."siteId"
        where c."tenantId" = $1
        order by c.annee, s.nom, c.niveau, c.nom`,
      TENANT,
    ),
    prisma.$queryRawUnsafe<{ id: string; nom: string }[]>(
      `select id, nom from sites where "tenantId" = $1 order by nom`,
      TENANT,
    ),
    prisma.$queryRawUnsafe<{ id: string; niveau: string; annee: string; siteId: string | null }[]>(
      `select id, niveau, annee, "siteId" from tarifs_niveau where "tenantId" = $1 order by annee, niveau`,
      TENANT,
    ),
  ]);

  console.log(`Référentiel officiel : ${NIVEAUX_CANONIQUES.join(", ")}`);
  console.log(`${classes.length} classe(s), ${tarifs.length} tarif(s), ${sites.length} site(s)\n`);

  // ── 1. Valeurs de niveau rencontrées (classes) ──────────────────
  const parValeur = new Map<string, number>();
  for (const c of classes) parValeur.set(c.niveau, (parValeur.get(c.niveau) ?? 0) + 1);
  console.log("=== VALEURS DE NIVEAU EN BASE (classes) ===");
  console.table(
    [...parValeur.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([niveau, n]) => ({
        niveau,
        classes: n,
        officiel: normaliserNiveau(niveau) ?? "❌ INCONNU",
        statut: normaliserNiveau(niveau) === niveau ? "✔ conforme" : "⛔ à corriger",
      })),
  );

  // ── 2. Classes à corriger ───────────────────────────────────────
  const aCorriger = classes.filter((c) => normaliserNiveau(c.niveau) !== c.niveau);
  console.log("=== CLASSES À CORRIGER ===");
  if (aCorriger.length === 0) {
    console.log("  ✅ aucun niveau de classe non conforme.");
  } else {
    console.table(
      aCorriger.map((c) => ({
        site: c.siteNom ?? "(sans site)",
        annee: c.annee,
        nom: c.nom,
        actuel: c.niveau,
        cible: normaliserNiveau(c.niveau) ?? "⚠️ INCLASSABLE — à trancher manuellement",
      })),
    );
  }

  // ── 3. Divergences nom ↔ niveau (avertissement, pas de correction) ──
  const incoherentes = classes.filter((c) => {
    const duNom = normaliserNiveau(c.nom);
    return duNom !== null && duNom !== c.niveau;
  });
  console.log("=== DIVERGENCES nom ↔ niveau (à vérifier à la main) ===");
  if (incoherentes.length === 0) {
    console.log("  ✅ aucun nom de classe ne contredit son niveau.");
  } else {
    console.table(
      incoherentes.map((c) => ({
        site: c.siteNom ?? "(sans site)",
        nom: c.nom,
        niveauStocke: c.niveau,
        niveauDeduitDuNom: normaliserNiveau(c.nom),
      })),
    );
  }
  // ── 4. Tarifs non conformes ────────────────────────────────────
  const tarifsACorriger = tarifs.filter((t) => normaliserNiveau(t.niveau) !== t.niveau);
  console.log("=== TARIFS À CORRIGER ===");
  if (tarifsACorriger.length === 0) {
    console.log("  ✅ aucun niveau de tarif non conforme.");
  } else {
    console.table(
      tarifsACorriger.map((t) => ({
        annee: t.annee,
        site: t.siteId ? (sites.find((s) => s.id === t.siteId)?.nom ?? t.siteId) : "GLOBAL",
        actuel: t.niveau,
        cible: normaliserNiveau(t.niveau) ?? "⚠️ INCLASSABLE",
      })),
    );
  }

  // ── 5. Niveaux utilisés par des classes mais absents de la grille ──
  const niveauxClasses = new Set(classes.map((c) => normaliserNiveau(c.niveau) ?? c.niveau));
  const niveauxTarifs = new Set(tarifs.map((t) => normaliserNiveau(t.niveau) ?? t.niveau));
  const sansTarif = [...niveauxClasses].filter((n) => !niveauxTarifs.has(n));
  console.log("=== NIVEAUX DE CLASSE SANS AUCUN TARIF ===");
  console.log(sansTarif.length === 0 ? "  ✅ tous couverts." : `  ⛔ ${sansTarif.join(", ")}`);

  if (!apply) {
    console.log("\nAUDIT UNIQUEMENT — relancer avec --apply pour écrire les corrections.");
    return;
  }

  // ── 6. Application des corrections ─────────────────────────────
  let corrigees = 0;
  const echecs: string[] = [];

  for (const c of aCorriger) {
    const cible = normaliserNiveau(c.niveau);
    if (!cible) {
      echecs.push(`classe ${c.id} (« ${c.nom} ») : niveau « ${c.niveau} » inclassable — ignorée`);
      continue;
    }
    try {
      await prisma.classe.update({ where: { id: c.id }, data: { niveau: cible } });
      corrigees++;
      console.log(`  ✔ ${c.nom} (${c.siteNom ?? "sans site"}) : « ${c.niveau} » → « ${cible} »`);
    } catch (e) {
      echecs.push(`classe ${c.id} (« ${c.nom} ») : ${e instanceof Error ? e.message : "erreur"}`);
    }
  }

  let tarifsCorriges = 0;
  for (const t of tarifsACorriger) {
    const cible = normaliserNiveau(t.niveau);
    if (!cible) continue;
    const collision = tarifs.some(
      (x) => x.id !== t.id && x.annee === t.annee && x.siteId === t.siteId && x.niveau === cible,
    );
    if (collision) {
      echecs.push(
        `tarif ${t.id} (${t.niveau} ${t.annee}) : « ${cible} » existe déjà pour ce site — fusion manuelle requise`,
      );
      continue;
    }
    try {
      await prisma.tarifNiveau.update({ where: { id: t.id }, data: { niveau: cible } });
      tarifsCorriges++;
      console.log(`  ✔ tarif ${t.annee} : « ${t.niveau} » → « ${cible} »`);
    } catch (e) {
      echecs.push(`tarif ${t.id} : ${e instanceof Error ? e.message : "erreur"}`);
    }
  }

  await prisma.auditLog.create({
    data: {
      tenantId: TENANT,
      userId: null,
      action: "maintenance.harmoniser-niveaux",
      verdict: "ALLOWED",
      resource: "classe",
      reason: `Harmonisation des niveaux : ${corrigees} classe(s), ${tarifsCorriges} tarif(s)`,
      metadata: {
        classesCorrigees: corrigees,
        tarifsCorriges,
        referentiel: [...NIVEAUX_CANONIQUES],
        clesCanoniques: [...new Set(classes.map((c) => cleNiveau(c.niveau) ?? "?"))].sort(),
        echecs,
      },
    },
  });

  console.log(`\n✅ ${corrigees} classe(s) et ${tarifsCorriges} tarif(s) corrigés.`);
  if (echecs.length) {
    console.log(`⚠️  ${echecs.length} élément(s) à trancher manuellement :`);
    for (const e of echecs) console.log(`   - ${e}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
