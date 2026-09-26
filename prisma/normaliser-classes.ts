/**
 * EcolPro — Harmonisation des classes (noms + année scolaire)
 * ============================================================
 *
 * 1. NOMS — Primaire et collège : « X(ère|ème) Année [section] »
 *      « 1ére A »  → « 1ère Année A »
 *      « 2éme A »  → « 2ème Année A »
 *      « 1èreE »   → « 1ère Année E »
 *      « 6ème1 »   → « 6ème Année 1 »
 *      « 4èmeD »   → « 4ème Année D »
 *    Non modifiés : « Garderie » (maternelle) et les classes de LYCÉE, qui
 *    gardent leur intitulé propre (« 1èreSG/GFM », « 2nd1 », « Terminal SG »).
 *    Le champ `niveau` est VOLONTAIREMENT inchangé : il sert de clé à la grille
 *    tarifaire (le rapprochement est canonique, voir src/lib/tarifs.ts) et au
 *    filtrage des matières / des règles pédagogiques.
 *
 * 2. ANNÉE SCOLAIRE — Les classes restées sur une année révolue alors que
 *    l'établissement travaille sur l'année active sont traitées :
 *      • classe VIDE et doublon d'une classe du même nom déjà sur l'année
 *        cible → supprimée (après vérification qu'aucune donnée ne s'y
 *        rattache : emplois du temps, notes, évaluations, conversations) ;
 *      • classe vide sans doublon → son année est mise à jour ;
 *      • classe AVEC élèves et sans collision → déplacée avec ses élèves ;
 *      • classe AVEC élèves et collision de nom → signalée, jamais touchée.
 *
 * Comportement :
 *   - LECTURE SEULE par défaut.
 *   - `--apply` : applique les changements.
 *
 * Usage :
 *   npx tsx prisma/normaliser-classes.ts
 *   npx tsx prisma/normaliser-classes.ts --apply
 *   npx tsx prisma/normaliser-classes.ts --apply --annee=2026-2027
 */
import { PrismaClient } from "@prisma/client";
import { cleNiveau } from "../src/lib/tarifs";

const prisma = new PrismaClient();

/** « 1 » → « 1ère », « 6 » → « 6ème ». */
function ordinal(anneeScolaire: number): string {
  return anneeScolaire === 1 ? "1ère" : `${anneeScolaire}ème`;
}

export interface AnalyseNom {
  /** Année du niveau : 1 à 9 (primaire/collège). */
  numero: number;
  /**
   * Section saisie après le niveau : « A », « E », « 1 », « 2 »…
   * Chaîne vide quand le nom ne porte pas de section.
   */
  section: string;
  /** Vrai quand la section est un nombre (à remplacer par une lettre). */
  sectionNumerique: boolean;
}

/**
 * Analyse d'un intitulé de classe de primaire/collège : renvoie `null` pour
 * tout ce qui est hors périmètre (lycée, maternelle, niveau non numéroté).
 *
 * Les accents sont neutralisés AVANT la découpe : les saisies réelles mélangent
 * « 1ère », « 1ére » (é au lieu de è) et « 2éme ». La fonction est IDEMPOTENTE :
 * « 1ère Année A » redonne { numero: 1, section: "A" }.
 */
export function analyserNom(nom: string, niveau: string): AnalyseNom | null {
  const cle = cleNiveau(niveau);
  const numero = cle ? /^an([1-9])$/.exec(cle) : null;
  if (!numero) return null;

  const plat = nom
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const section = plat
    // Alternation du plus long au plus court : « 1eree » doit donner « e »,
    // pas « ee » (sinon « 1èreE » deviendrait « 1ère Année EE »).
    .replace(/^\s*\d{1,2}\s*(?:ere|eme|er|re|e)?\s*(?:annee)?\s*[-–—]?\s*/, "")
    .trim()
    .toUpperCase();

  return {
    numero: parseInt(numero[1], 10),
    section,
    sectionNumerique: section.length > 0 && /^\d{1,2}$/.test(section),
  };
}

/** « 6 » + « B » → « 6ème Année B ». */
export function nomAvecSection(numero: number, section: string): string {
  const base = `${ordinal(numero)} Année`;
  return section.length > 0 ? `${base} ${section}` : base;
}

/** Lettre de section d'après son rang : 0 → A, 1 → B, … */
export function lettreSection(rang: number): string {
  return String.fromCharCode("A".charCodeAt(0) + rang);
}

interface LigneRenommage {
  id: string;
  site: string;
  ancien: string;
  nouveau: string;
  eleves: number;
}

interface LigneAnnee {
  id: string;
  site: string;
  nom: string;
  ancienneAnnee: string;
  action: "SUPPRIMER (doublon vide)" | "DÉPLACER" | "BLOQUÉ (collision)" | "BLOQUÉ (données liées)";
  motif: string;
}

/** Données rattachées qui interdisent la suppression d'une classe. */
async function compterDependances(classeId: string): Promise<number> {
  const [emploisTemps, notes, evaluations, conversations] = await Promise.all([
    prisma.emploiTemps.count({ where: { classeId } }),
    prisma.note.count({ where: { classeId } }),
    prisma.evaluation.count({ where: { classeId } }),
    prisma.conversation.count({ where: { classeId } }),
  ]);
  return emploisTemps + notes + evaluations + conversations;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const anneeForcee = args.find((a) => a.startsWith("--annee="))?.split("=")[1];

  const tenants = await prisma.tenant.findMany({ select: { id: true, name: true } });

  for (const tenant of tenants) {
    const anneeActive = await prisma.anneesScolaires.findFirst({
      where: { tenantId: tenant.id, isCurrent: true },
      select: { libelle: true },
    });
    const anneeCible = anneeForcee ?? anneeActive?.libelle;
    if (!anneeCible) {
      console.log(`\n[${tenant.name}] Aucune année scolaire active : ignoré.`);
      continue;
    }

    const classes = await prisma.classe.findMany({
      where: { tenantId: tenant.id },
      include: { site: { select: { code: true, nom: true } }, _count: { select: { eleves: true } } },
      orderBy: [{ annee: "asc" }, { nom: "asc" }],
    });

    // 1) Analyse des classes de primaire/collège (lycée et garderie exclus).
    const analyses = new Map<string, AnalyseNom>();
    for (const c of classes) {
      const analyse = analyserNom(c.nom, c.niveau);
      if (analyse) analyses.set(c.id, analyse);
    }

    // 2) Regroupement par (site, année scolaire, niveau) : quand un même niveau
    //    compte plusieurs classes, la section devient une LETTRE attribuée dans
    //    l'ordre alphabétique (A, B, C…), jamais un numéro.
    const groupes = new Map<string, typeof classes>();
    for (const c of classes) {
      const analyse = analyses.get(c.id);
      if (!analyse) continue;
      const cle = `${c.siteId ?? "—"}|${c.annee}|${analyse.numero}`;
      const liste = groupes.get(cle);
      if (liste) liste.push(c);
      else groupes.set(cle, [c]);
    }

    const sectionParClasse = new Map<string, string>();
    for (const liste of groupes.values()) {
      const analysesDuGroupe = liste.map((c) => analyses.get(c.id) as AnalyseNom);
      const dejaLettré = analysesDuGroupe.every((a) => !a.sectionNumerique);
      if (liste.length > 1 && !dejaLettré) {
        // Ordre des classes numérotées : 1, 2, 3… (une classe sans section
        // passe en premier), puis A, B, C…
        const ordonnees = liste
          .map((c, i) => ({ c, analyse: analysesDuGroupe[i] }))
          .sort((a, b) => {
            const na = a.analyse.section === "" ? 0 : parseInt(a.analyse.section, 10);
            const nb = b.analyse.section === "" ? 0 : parseInt(b.analyse.section, 10);
            return na - nb || a.c.nom.localeCompare(b.c.nom, "fr");
          });
        ordonnees.forEach((entree, rang) => sectionParClasse.set(entree.c.id, lettreSection(rang)));
      } else {
        // Classe unique, ou groupe déjà lettré (A, B, C… / E, D… conservés).
        liste.forEach((c, i) => sectionParClasse.set(c.id, analysesDuGroupe[i].section));
      }
    }

    // 3) Nom cible de chaque classe (inchangé si déjà conforme → idempotent).
    const nomCible = new Map<string, string>();
    const renommages: LigneRenommage[] = [];
    for (const c of classes) {
      const analyse = analyses.get(c.id);
      if (!analyse) continue;
      const nouveau = nomAvecSection(analyse.numero, sectionParClasse.get(c.id) ?? analyse.section);
      if (nouveau !== c.nom) {
        nomCible.set(c.id, nouveau);
        renommages.push({
          id: c.id,
          site: c.site?.code ?? c.site?.nom ?? "—",
          ancien: c.nom,
          nouveau,
          eleves: c._count.eleves,
        });
      }
    }

    const nomFinal = (c: { id: string; nom: string }) => nomCible.get(c.id) ?? c.nom;

    // Noms déjà présents sur l'année cible (après renommage), par site.
    const nomsAnneesCible = new Set(
      classes
        .filter((c) => c.annee === anneeCible)
        .map((c) => `${c.siteId ?? "—"}|${nomFinal(c)}`)
    );

    // Classes restées sur une autre année.
    const planAnnees: LigneAnnee[] = [];
    for (const c of classes) {
      if (c.annee === anneeCible) continue;

      const nom = nomFinal(c);
      const memeNomSurCible = nomsAnneesCible.has(`${c.siteId ?? "—"}|${nom}`);
      const dependances = await compterDependances(c.id);
      const site = c.site?.code ?? c.site?.nom ?? "—";

      if (c._count.eleves === 0 && dependances === 0 && memeNomSurCible) {
        planAnnees.push({
          id: c.id,
          site,
          nom,
          ancienneAnnee: c.annee,
          action: "SUPPRIMER (doublon vide)",
          motif: `doublon vide de « ${nom} » déjà en ${anneeCible}`,
        });
      } else if (c._count.eleves > 0 && memeNomSurCible) {
        planAnnees.push({
          id: c.id,
          site,
          nom,
          ancienneAnnee: c.annee,
          action: "BLOQUÉ (collision)",
          motif: `${c._count.eleves} élève(s) et une classe « ${nom} » existe déjà en ${anneeCible} : à fusionner manuellement`,
        });
      } else if (c._count.eleves === 0 && dependances > 0) {
        planAnnees.push({
          id: c.id,
          site,
          nom,
          ancienneAnnee: c.annee,
          action: "DÉPLACER",
          motif: `aucun élève, ${dependances} donnée(s) liée(s) suivent la classe`,
        });
      } else {
        planAnnees.push({
          id: c.id,
          site,
          nom,
          ancienneAnnee: c.annee,
          action: "DÉPLACER",
          motif:
            c._count.eleves === 0
              ? "aucun élève"
              : `${c._count.eleves} élève(s) suivent la classe`,
        });
      }
    }

    console.log(`\n########## ${tenant.name} — année cible ${anneeCible} ##########`);
    console.log(`Classes : ${classes.length} | à renommer : ${renommages.length} | hors année cible : ${planAnnees.length}`);
    if (renommages.length > 0) {
      console.log("\n— Renommages —");
      console.table(renommages.map((r) => ({ site: r.site, ancien: r.ancien, nouveau: r.nouveau, eleves: r.eleves })));
    }
    if (planAnnees.length > 0) {
      console.log("\n— Classes hors année cible —");
      console.table(planAnnees.map((l) => ({ site: l.site, classe: l.nom, annee: l.ancienneAnnee, action: l.action, motif: l.motif })));
    }

    if (!apply) {
      console.log("\nMODE LECTURE SEULE — relancer avec --apply pour écrire.");
      continue;
    }

    let renommees = 0;
    for (const r of renommages) {
      await prisma.classe.update({ where: { id: r.id }, data: { nom: r.nouveau } });
      renommees++;
    }

    let supprimees = 0;
    let deplacees = 0;
    for (const l of planAnnees) {
      if (l.action === "SUPPRIMER (doublon vide)") {
        await prisma.classe.delete({ where: { id: l.id } });
        supprimees++;
      } else if (l.action === "DÉPLACER") {
        await prisma.classe.update({ where: { id: l.id }, data: { annee: anneeCible } });
        deplacees++;
      }
    }

    console.log(
      `\n✔ ${renommees} classe(s) renommée(s), ${deplacees} déplacée(s) en ${anneeCible}, ` +
        `${supprimees} doublon(s) vide(s) supprimé(s).`
    );
    const bloques = planAnnees.filter((l) => l.action.startsWith("BLOQUÉ"));
    if (bloques.length > 0) {
      console.log(`⚠ ${bloques.length} classe(s) NON traitée(s) — action manuelle requise (voir tableau).`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
