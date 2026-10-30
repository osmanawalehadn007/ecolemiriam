/**
 * EcolPro — Application de la grille tarifaire officielle
 * ============================================================
 *
 * Reconstruit la grille tarifaire par niveau depuis la règle métier :
 *
 *   Maternelle ........................ 5 000
 *   1ère → 4ème année ................. 7 000
 *   5ème année ........................ 8 000
 *   Collège 6ème → 8ème ............... 10 000
 *   9ème .............................. 12 000
 *   Lycée Seconde ..................... 13 000
 *           Première .................. 15 000
 *           Terminale ................. 20 000
 *
 * Plus les tarifs propres à un site, qui remplacent le tarif global sur ce
 * site (exemple : 1ère année = 6 000 à SITE-02). Un site sans tarif propre
 * hérite du tarif global — règle appliquée à la facturation par
 * `choisirTarif()` (src/lib/tarifs.ts).
 *
 * Comportement :
 *   - LECTURE SEULE par défaut : affiche le plan sans rien écrire.
 *   - `--apply`  : crée les tarifs manquants.
 *   - `--update` : aligne en plus la mensualité des tarifs existants.
 *   - Ne supprime JAMAIS un tarif.
 *
 * Usage :
 *   npx tsx prisma/seed-tarifs.ts
 *   npx tsx prisma/seed-tarifs.ts --apply
 *   npx tsx prisma/seed-tarifs.ts --apply --update --annee=2026-2027
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** Mensualité par niveau (tarif global, hérité par tous les sites). */
const GRILLE_GLOBALE: Record<string, number> = {
  Maternelle: 5000,
  "1ère": 7000,
  "2ème": 7000,
  "3ème": 7000,
  "4ème": 7000,
  "5ème": 8000,
  "6ème": 10000,
  "7ème": 10000,
  "8ème": 10000,
  "9ème": 12000,
  Seconde: 13000,
  Première: 15000,
  Terminale: 20000,
};

/**
 * Tarifs propres à un site (indexés par code de site) : ils remplacent le tarif
 * global sur ce site. Les niveaux absents restent couverts par le global.
 */
const GRILLE_PAR_SITE: Record<string, Record<string, number>> = {
  "SITE-02": {
    Maternelle: 5000,
    "1ère": 6000,
    "2ème": 6000,
    "3ème": 6000,
    "4ème": 7000,
    "5ème": 7000,
  },
};

/** Frais annexes : 2 500 pour la fin du cursus, 2 000 ailleurs. */
const NIVEAUX_FRAIS_2500 = new Set(["9ème", "Première", "Terminale"]);

interface LignePlan {
  siteId: string | null;
  siteLabel: string;
  niveau: string;
  annee: string;
  mensualite: number;
  fraisInscription: number;
  fraisRenouvellement: number;
  action: "CREER" | "ALIGNER" | "INCHANGE";
  mensualiteActuelle?: number;
  tarifId?: string;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const update = args.includes("--update");
  const anneeArg = args.find((a) => a.startsWith("--annee="))?.split("=")[1];

  const tenants = await prisma.tenant.findMany({ select: { id: true, name: true, currentYear: true } });
  if (tenants.length === 0) {
    console.log("Aucun établissement en base.");
    return;
  }

  for (const tenant of tenants) {
    const anneeActive = await prisma.anneesScolaires.findFirst({
      where: { tenantId: tenant.id, isCurrent: true },
      select: { libelle: true },
    });
    const annee = anneeArg ?? anneeActive?.libelle ?? tenant.currentYear;
    if (!annee) {
      console.log(`\n[${tenant.name}] Aucune année scolaire (active ou courante) : ignoré.`);
      continue;
    }

    const sites = await prisma.site.findMany({
      where: { tenantId: tenant.id, deletedAt: null },
      select: { id: true, nom: true, code: true },
      orderBy: { code: "asc" },
    });

    // Plan : le tarif global par niveau, puis les dérogations par site.
    const plan: LignePlan[] = [];
    const ajouter = (siteId: string | null, siteLabel: string, niveaux: Record<string, number>) => {
      for (const [niveau, mensualite] of Object.entries(niveaux)) {
        plan.push({
          siteId,
          siteLabel,
          niveau,
          annee,
          mensualite,
          fraisInscription: NIVEAUX_FRAIS_2500.has(niveau) ? 2500 : 2000,
          fraisRenouvellement: NIVEAUX_FRAIS_2500.has(niveau) ? 2500 : 2000,
          action: "CREER",
        });
      }
    };

    ajouter(null, "Tous les sites", GRILLE_GLOBALE);
    for (const site of sites) {
      const grille = site.code ? GRILLE_PAR_SITE[site.code] : undefined;
      if (grille) ajouter(site.id, site.code ? `${site.code} — ${site.nom}` : site.nom, grille);
    }

    // Confronter le plan à l'existant (aucune écriture à ce stade).
    for (const ligne of plan) {
      const existant = await prisma.tarifNiveau.findFirst({
        where: {
          tenantId: tenant.id,
          niveau: ligne.niveau,
          annee: ligne.annee,
          siteId: ligne.siteId,
        },
      });

      if (!existant) continue;

      ligne.tarifId = existant.id;
      ligne.mensualiteActuelle = existant.mensualite;
      ligne.fraisInscription = existant.fraisInscription;
      ligne.fraisRenouvellement = existant.fraisRenouvellement;
      ligne.action = existant.mensualite === ligne.mensualite ? "INCHANGE" : "ALIGNER";
    }

    console.log(`\n########## ${tenant.name} — année ${annee} ##########`);
    console.log(`Sites : ${sites.map((s) => s.code ?? s.nom).join(", ") || "—"}`);
    console.table(
      plan.map((l) => ({
        site: l.siteLabel,
        niveau: l.niveau,
        mensualite: l.mensualite,
        actuelle: l.mensualiteActuelle ?? "",
        action: l.action,
      }))
    );

    const aCreer = plan.filter((l) => l.action === "CREER");
    const aAligner = plan.filter((l) => l.action === "ALIGNER");
    console.log(
      `Bilan : ${aCreer.length} à créer, ${aAligner.length} à aligner (mensualité), ` +
        `${plan.length - aCreer.length - aAligner.length} déjà conformes.`
    );

    if (!apply) {
      console.log("MODE LECTURE SEULE — relancer avec --apply pour écrire.");
      continue;
    }

    let crees = 0;
    let alignes = 0;
    for (const ligne of aCreer) {
      await prisma.tarifNiveau.create({
        data: {
          tenantId: tenant.id,
          siteId: ligne.siteId,
          niveau: ligne.niveau,
          annee: ligne.annee,
          mensualite: ligne.mensualite,
          fraisInscription: ligne.fraisInscription,
          fraisRenouvellement: ligne.fraisRenouvellement,
          devise: "DJF",
          nbMois: 10,
          actif: true,
        },
      });
      crees++;
    }

    if (update) {
      for (const ligne of aAligner) {
        if (!ligne.tarifId) continue;
        await prisma.tarifNiveau.update({
          where: { id: ligne.tarifId },
          data: { mensualite: ligne.mensualite },
        });
        alignes++;
      }
    }

    console.log(
      `✔ ${crees} tarif(s) créé(s)` +
        (update
          ? `, ${alignes} mensualité(s) alignée(s)`
          : `, ${aAligner.length} non aligné(s) (--update pour le faire)`) +
        "."
    );

    // ── Tarif global d'exonération (mensualité 0) pour ce tenant ──
    // Ce tarif spécial (niveau "EXONERE", siteId null) s'applique à tout
    // élève auquel on le lie directement via Eleve.tarifPersonnaliseId.
    // Il prime sur le tarif standard de son niveau.
    const tarifExonereExistant = await prisma.tarifNiveau.findFirst({
      where: {
        tenantId: tenant.id,
        niveau: "EXONERE",
        siteId: null,
      },
    });
    if (!tarifExonereExistant) {
      await prisma.tarifNiveau.create({
        data: {
          tenantId: tenant.id,
          siteId: null,
          niveau: "EXONERE",
          annee: annee,
          mensualite: 0,
          fraisInscription: 0,
          fraisRenouvellement: 0,
          fraisCantine: 0,
          fraisTransport: 0,
          devise: "DJF",
          nbMois: 10,
          actif: true,
        },
      });
      console.log(`✔ Tarif EXONERE (0 DJF) créé pour ${tenant.name}`);
    } else if (!tarifExonereExistant.actif) {
      await prisma.tarifNiveau.update({
        where: { id: tarifExonereExistant.id },
        data: { actif: true },
      });
      console.log(`✔ Tarif EXONERE réactivé pour ${tenant.name}`);
    }

    // Signaler les années scolaires restées sans grille : elles ne produiraient
    // aucune facture automatique.
    const anneesClasses = await prisma.classe.findMany({
      where: { tenantId: tenant.id },
      select: { annee: true },
      distinct: ["annee"],
      orderBy: { annee: "asc" },
    });
    for (const c of anneesClasses) {
      if (c.annee === annee) continue;
      const nbTarifs = await prisma.tarifNiveau.count({
        where: { tenantId: tenant.id, annee: c.annee },
      });
      if (nbTarifs === 0) {
        console.log(
          `⚠ Aucun tarif pour ${c.annee} alors que des classes existent — la génération les ignorera.`
        );
      }
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
