/**
 * EcolPro — Audit des tarifs par classe
 * ============================================================
 * Pour CHAQUE classe de l'établissement, affiche le tarif réellement appliqué
 * par la facturation (mensualité, frais d'inscription, frais de renouvellement)
 * et son origine :
 *   - `SITE`   : tarif propre au site de la classe ;
 *   - `GLOBAL` : tarif hérité (aucun tarif propre au site).
 *
 * Une classe « ❌ AUCUN » ne sera jamais facturée automatiquement : compléter
 * la grille dans Paramètres → Tarifs.
 *
 * Usage : npx tsx scripts/audit-tarifs.ts
 */
import { PrismaClient } from "@prisma/client";
import { choisirTarif, cleNiveau } from "../src/lib/tarifs";

const prisma = new PrismaClient();

async function main() {
  const tarifs = await prisma.tarifNiveau.findMany({ where: { actif: true } });
  const classes = await prisma.classe.findMany({
    include: { site: { select: { code: true, nom: true } }, _count: { select: { eleves: true } } },
    orderBy: [{ site: { code: "asc" } }, { nom: "asc" }],
  });

  const lignes = classes.map((c) => {
    const choix = choisirTarif(
      tarifs.filter((t) => t.annee === c.annee),
      c.siteId,
      c.niveau
    );
    return {
      site: c.site?.code ?? "?",
      classe: c.nom,
      niveau: c.niveau,
      eleves: c._count.eleves,
      tarif: choix?.tarif.niveau ?? "❌ AUCUN",
      mensualite: choix ? choix.tarif.mensualite : "",
      inscription: choix ? choix.tarif.fraisInscription : "",
      renouvellement: choix ? choix.tarif.fraisRenouvellement : "",
      origine: choix ? choix.source : "",
    };
  });

  console.table(lignes);

  const sansTarif = lignes.filter((l) => l.tarif === "❌ AUCUN");
  console.log(`Classes SANS tarif : ${sansTarif.length}`);
  if (sansTarif.length > 0) console.table(sansTarif);

  // Couverture : chaque niveau de chaque site a-t-il un tarif ?
  const niveaux = await prisma.classe.groupBy({
    by: ["siteId", "niveau"],
    _count: { _all: true },
  });
  console.log("\nClés canoniques utilisées par les classes :");
  console.table(
    niveaux.map((n) => ({
      siteId: n.siteId,
      niveau: n.niveau,
      cle: cleNiveau(n.niveau),
      classes: n._count._all,
      tarif: choisirTarif(tarifs, n.siteId, n.niveau)?.tarif.niveau ?? "❌ AUCUN",
    }))
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
