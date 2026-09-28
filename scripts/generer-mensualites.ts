/**
 * EcolPro — Génération manuelle des factures d'un mois (outil d'exploitation)
 * ============================================================
 * Même moteur que le cron `GET /api/cron/facturation-mensuelle`, utilisable
 * depuis un terminal pour rattraper un mois oublié ou rejouer un mois donné.
 *
 * LECTURE SEULE par défaut : affiche le nombre d'élèves facturables et le
 * nombre déjà facturés, sans rien écrire.
 *
 * Usage :
 *   set -a; . ./.env; set +a
 *   npx tsx scripts/generer-mensualites.ts                       # aperçu (mois courant)
 *   npx tsx scripts/generer-mensualites.ts --apply
 *   npx tsx scripts/generer-mensualites.ts --apply --mois=10
 *   npx tsx scripts/generer-mensualites.ts --apply --cantine --transport
 */
import { PrismaClient } from "@prisma/client";
import { runWithTenant } from "@/lib/prisma";
import {
  MOIS_NOMS,
  genererMensualitesPourTenant,
  libellesMensualite,
} from "../src/lib/factures/mensualites";

const prisma = new PrismaClient();

function argValeur(nom: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${nom}=`))?.split("=")[1];
}

async function main() {
  const apply = process.argv.includes("--apply");
  const mois = parseInt(argValeur("mois") ?? String(new Date().getMonth() + 1), 10);
  const anneeForcee = argValeur("annee");
  const tenantFiltre = argValeur("tenant");
  const inclureCantine = process.argv.includes("--cantine");
  const inclureTransport = process.argv.includes("--transport");

  if (!Number.isInteger(mois) || mois < 1 || mois > 12) {
    console.error("--mois doit être compris entre 1 et 12");
    process.exit(2);
  }

  const tenants = await prisma.tenant.findMany({
    where: tenantFiltre ? { id: tenantFiltre } : {},
    select: { id: true, name: true },
  });

  for (const tenant of tenants) {
    const anneeActive = await prisma.anneesScolaires.findFirst({
      where: { tenantId: tenant.id, isCurrent: true },
      select: { libelle: true },
    });
    const annee = anneeForcee ?? anneeActive?.libelle;
    if (!annee) {
      console.log(`[${tenant.name}] aucune année scolaire active — ignoré.`);
      continue;
    }

    const libelles = libellesMensualite(mois, annee);

    const [eleves, factures] = await Promise.all([
      prisma.eleve.findMany({
        where: { tenantId: tenant.id, statut: "ACTIF", deletedAt: null },
        select: { id: true, classe: { select: { niveau: true } } },
      }),
      // eslint-disable-next-line ecolemiriam/require-site-filter -- outil d'exploitation : lecture tenant-wide assumée
      prisma.facture.findMany({
        where: { tenantId: tenant.id },
        select: { eleveId: true, libelle: true },
      }),
    ]);

    const dejaFactures = new Set(
      factures.filter((f) => libelles.includes(f.libelle)).map((f) => f.eleveId)
    );
    const facturables = eleves.filter((e) => e.classe?.niveau);

    console.log(
      `\n[${tenant.name}] ${annee} — ${MOIS_NOMS[mois - 1]}\n` +
        `  élèves actifs : ${eleves.length} | avec classe : ${facturables.length}\n` +
        `  déjà facturés pour ce mois : ${dejaFactures.size} (libellés reconnus : ${libelles.join(" | ")})\n` +
        `  à facturer : ${facturables.filter((e) => !dejaFactures.has(e.id)).length}` +
        (inclureCantine ? " | + cantine" : "") +
        (inclureTransport ? " | + transport" : "")
    );

    if (!apply) continue;

    // Le cœur de génération passe par le client RLS, « fail-closed » : hors
    // requête HTTP il n'y a aucun contexte de session, on ouvre donc
    // explicitement celui de l'établissement traité (siteId null : tous les
    // sites). Sans cela : « prisma-rls: contexte tenant manquant ».
    const resultat = await runWithTenant(tenant.id, null, () =>
      genererMensualitesPourTenant({
        tenantId: tenant.id,
        mois,
        annee,
        inclureCantine,
        inclureTransport,
        acteurId: null,
      })
    );
    console.log(
      `  ✔ ${resultat.generated} facture(s) créée(s) au statut impayée — ` +
        `${resultat.montantTotal} ${"DJF"} facturés, ${resultat.skipped} ignorée(s) ` +
        `(dont ${resultat.sansTarif} sans tarif)`
    );
  }

  if (!apply) console.log("\nMODE LECTURE SEULE — relancer avec --apply pour écrire.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
