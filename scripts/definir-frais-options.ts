/**
 * Renseigne les frais d'OPTION (cantine, transport) de la grille tarifaire.
 * ============================================================
 * Ces deux colonnes sont saisissables dans Paramètres → Tarifs, mais elles
 * étaient restées vides : cocher « cantine » ou « transport » dans l'écran
 * Facturation n'ajoutait donc rien (le montant est lu dans la grille, plus
 * aucun forfait n'est codé en dur — voir AGENTS.md §18).
 *
 * LECTURE SEULE par défaut. `--apply` écrit, et journalise l'opération.
 *
 * Usage :
 *   set -a; . ./.env; set +a
 *   npx tsx scripts/definir-frais-options.ts --transport=4000 --cantine=4000
 *   npx tsx scripts/definir-frais-options.ts --transport=4000 --cantine=4000 --apply
 *   npx tsx scripts/definir-frais-options.ts --transport=5000 --niveau="6ème" --apply
 *
 * Options :
 *   --annee=2026-2027   grille visée (défaut : année scolaire active)
 *   --site=<id>         ne toucher qu'un site (défaut : tous, global compris)
 *   --niveau=<niveau>   ne toucher qu'un niveau (valeur officielle requise)
 *   --transport=<n>     montant mensuel du transport (0 = option non proposée)
 *   --cantine=<n>       montant mensuel de la cantine (0 = option non proposée)
 */
import { PrismaClient } from "@prisma/client";
import { NIVEAUX_CANONIQUES, normaliserNiveau } from "@/lib/niveau";

const TENANT = "cms8kt0b40001zbi3o63y7c5v";

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });

function argValeur(nom: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${nom}=`))?.split("=").slice(1).join("=");
}

async function main() {
  const apply = process.argv.includes("--apply");
  const anneeForcee = argValeur("annee");
  const siteFiltre = argValeur("site");
  const niveauFiltre = argValeur("niveau");
  const transport = argValeur("transport");
  const cantine = argValeur("cantine");

  if (transport === undefined && cantine === undefined) {
    console.error(
      "Rien à faire : précisez --transport=<montant> et/ou --cantine=<montant>.\n" +
        "Exemple : npx tsx scripts/definir-frais-options.ts --transport=4000 --cantine=4000",
    );
    process.exitCode = 2;
    return;
  }

  const montants: { champ: "fraisTransport" | "fraisCantine"; valeur: number; libelle: string }[] = [];
  for (const [cle, brut, champ, libelle] of [
    ["transport", transport, "fraisTransport", "Transport"],
    ["cantine", cantine, "fraisCantine", "Cantine"],
  ] as const) {
    if (brut === undefined) continue;
    const valeur = Number(brut);
    if (!Number.isFinite(valeur) || valeur < 0) {
      console.error(`--${cle} doit être un montant positif (reçu : « ${brut} »).`);
      process.exitCode = 2;
      return;
    }
    montants.push({ champ, valeur, libelle });
  }

  const annee =
    anneeForcee ??
    (
      await prisma.anneesScolaires.findFirst({
        where: { tenantId: TENANT, isCurrent: true },
        select: { libelle: true },
      })
    )?.libelle;

  if (!annee) {
    console.error("Aucune année scolaire active : précisez --annee=AAAA-AAAA.");
    process.exitCode = 1;
    return;
  }

  let niveauCanonique: string | null = null;
  if (niveauFiltre !== undefined) {
    niveauCanonique = normaliserNiveau(niveauFiltre);
    if (!niveauCanonique) {
      console.error(
        `--niveau=« ${niveauFiltre} » non reconnu. Valeurs autorisées : ${NIVEAUX_CANONIQUES.join(", ")}.`,
      );
      process.exitCode = 2;
      return;
    }
  }

  const tarifs = await prisma.tarifNiveau.findMany({
    where: {
      tenantId: TENANT,
      annee,
      ...(siteFiltre ? { siteId: siteFiltre } : {}),
      ...(niveauCanonique ? { niveau: niveauCanonique } : {}),
    },
    select: {
      id: true,
      niveau: true,
      siteId: true,
      actif: true,
      fraisCantine: true,
      fraisTransport: true,
      devise: true,
    },
    orderBy: [{ siteId: "asc" }, { niveau: "asc" }],
  });

  const sites = await prisma.site.findMany({
    where: { tenantId: TENANT },
    select: { id: true, nom: true },
  });
  const nomSite = new Map(sites.map((s) => [s.id, s.nom]));

  console.log(
    `Année ${annee} · ${tarifs.length} tarif(s) visé(s)` +
      (niveauCanonique ? ` · niveau ${niveauCanonique}` : "") +
      `\nMontants demandés : ${montants.map((m) => `${m.libelle} = ${m.valeur} DJF`).join(" · ")}\n`,
  );

  console.table(
    tarifs.map((t) => ({
      site: t.siteId ? (nomSite.get(t.siteId) ?? t.siteId) : "GLOBAL",
      niveau: t.niveau,
      actif: t.actif ? "oui" : "non",
      cantine_avant: t.fraisCantine ?? "—",
      transport_avant: t.fraisTransport ?? "—",
    })),
  );

  if (!apply) {
    console.log("AUDIT UNIQUEMENT — relancer avec --apply pour écrire.");
    return;
  }

  let modifies = 0;
  for (const t of tarifs) {
    const data: { fraisCantine?: number; fraisTransport?: number } = {};
    for (const m of montants) {
      const avant = m.champ === "fraisTransport" ? t.fraisTransport : t.fraisCantine;
      if (avant === m.valeur) continue; // idempotent : rien à faire
      data[m.champ] = m.valeur;
    }
    if (Object.keys(data).length === 0) continue;
    await prisma.tarifNiveau.update({ where: { id: t.id }, data });
    modifies++;
  }

  await prisma.auditLog.create({
    data: {
      tenantId: TENANT,
      userId: null,
      action: "tarif:frais-options",
      verdict: "ALLOWED",
      resource: "tarif",
      reason: `Frais d'option ${annee} : ${montants.map((m) => `${m.libelle}=${m.valeur}`).join(", ")} (${modifies} tarif(s))`,
      metadata: {
        annee,
        siteId: siteFiltre ?? null,
        niveau: niveauCanonique,
        montants: Object.fromEntries(montants.map((m) => [m.champ, m.valeur])),
        tarifsModifies: modifies,
      },
    },
  });

  console.log(`\n✅ ${modifies} tarif(s) mis à jour sur ${tarifs.length} visé(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
