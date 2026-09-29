/**
 * QA — Écart entre l'ANCIEN moteur tarifaire (boutons de l'écran Facturation,
 * `src/lib/actions/facturation-avancee.ts`) et le moteur CANONIQUE utilisé par
 * le cron et le CLI (`src/lib/tarifs.ts` + `src/lib/factures/mensualites.ts`).
 *
 * LECTURE SEULE : mesure combien d'élèves chaque chemin sait facturer, site
 * par site, sur les données réelles.
 *
 * Usage :
 *   set -a; . ./.env; set +a
 *   npx tsx scripts/qa-legacy-vs-canonique.ts
 */
import { PrismaClient } from "@prisma/client";
import { choisirTarif, cleNiveau } from "@/lib/tarifs";

const TENANT = "cms8kt0b40001zbi3o63y7c5v";
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });

interface Tarif {
  niveau: string;
  siteId: string | null;
  mensualite: number;
  fraisInscription: number;
  fraisRenouvellement: number;
  devise: string;
  actif: boolean;
}

/** Reproduction EXACTE du lookup de l'ancien moteur (chaîne brute, lowercase). */
function legacyFindTarif(tarifs: Tarif[], niveau: string, siteId: string | null) {
  const parSite = new Map<string, Tarif>();
  const global = new Map<string, Tarif>();
  for (const t of tarifs) {
    if (t.siteId) parSite.set(`${t.niveau.toLowerCase()}|${t.siteId}`, t);
    else global.set(t.niveau.toLowerCase(), t);
  }
  return parSite.get(`${niveau.toLowerCase()}|${siteId}`) ?? global.get(niveau.toLowerCase());
}

async function main() {
  const annee = (
    await prisma.anneesScolaires.findFirst({ where: { tenantId: TENANT, isCurrent: true }, select: { libelle: true } })
  )?.libelle;
  if (!annee) throw new Error("Aucune année scolaire active");

  const [sites, tarifs, eleves] = await Promise.all([
    prisma.site.findMany({ where: { tenantId: TENANT, deletedAt: null }, select: { id: true, nom: true } }),
    prisma.tarifNiveau.findMany({
      where: { tenantId: TENANT, annee, actif: true },
      select: { niveau: true, siteId: true, mensualite: true, fraisInscription: true, fraisRenouvellement: true, devise: true, actif: true },
    }),
    prisma.eleve.findMany({
      where: { tenantId: TENANT, statut: "ACTIF", deletedAt: null, classe: { annee } },
      select: { siteId: true, classe: { select: { niveau: true } } },
    }),
  ]);

  const nomSite = new Map(sites.map((s) => [s.id, s.nom]));
  const groupes = new Map<string, number>();
  for (const e of eleves) {
    const niveau = e.classe?.niveau;
    if (!niveau) continue;
    const key = `${e.siteId ?? "GLOBAL"}|${niveau}`;
    groupes.set(key, (groupes.get(key) ?? 0) + 1);
  }

  const lignes: Record<string, string | number>[] = [];
  let legacyTotal = 0;
  let canoniqueTotal = 0;
  let manquantsLegacy = 0;

  for (const [key, nb] of [...groupes.entries()].sort()) {
    const [siteId, niveau] = key.split("|");
    const sid = siteId === "GLOBAL" ? null : siteId;
    const ancien = legacyFindTarif(tarifs, niveau, sid);
    const canon = choisirTarif(tarifs, sid, niveau);

    if (ancien) legacyTotal += nb;
    else {
      manquantsLegacy += nb;
      console.log(`  ⛔ ancien moteur ne trouve RIEN pour ${nomSite.get(sid ?? "") ?? "GLOBAL"} / « ${niveau} » → ${nb} élève(s) silencieusement ignoré(s)`);
    }
    if (canon) canoniqueTotal += nb;

    lignes.push({
      site: nomSite.get(sid ?? "") ?? "GLOBAL",
      niveau,
      eleves: nb,
      ancien: ancien ? `${ancien.mensualite} (${ancien.siteId ? "site" : "global"})` : "— AUCUN",
      canonique: canon ? `${canon.tarif.mensualite} (${canon.source})` : "— AUCUN",
      ecart: canon && ancien && ancien.mensualite !== canon.tarif.mensualite ? canon.tarif.mensualite - ancien.mensualite : 0,
    });
  }

  console.log(`\nAnnée ${annee} — ${eleves.length} élève(s) actif(s) avec classe\n`);
  console.table(lignes);
  console.log(
    `\nÉlèves facturables : ancien moteur = ${legacyTotal} | canonique = ${canoniqueTotal} | ` +
      `perte ancien moteur = ${manquantsLegacy} élève(s)`,
  );
  console.log(`Clés de niveau distinctes en base : ${[...new Set(eleves.map((e) => cleNiveau(e.classe?.niveau ?? "") ?? "?"))].sort().join(", ")}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
