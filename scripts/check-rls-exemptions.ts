/**
 * Détection de dérive entre les exemptions RLS du code et celles de la base.
 *
 *   npm run rls:check
 *
 * POURQUOI CE SCRIPT EXISTE
 * -------------------------
 * Deux listes doivent rester identiques :
 *   - `EXEMPT_MODELS` (src/lib/prisma-rls.ts) : les modèles pour lesquels
 *     l'extension Prisma ne pose AUCUN contexte tenant ;
 *   - `public.rls_exemptions` (écrite par migration_rls_secure.sql) : les
 *     tables laissées hors RLS.
 *
 * Un écart ne provoque aucune erreur visible, et c'est ce qui le rend
 * dangereux :
 *   - exempté côté code mais protégé en base → aucun contexte n'est posé,
 *     les policies fail-closed rejettent tout : la fonctionnalité renvoie
 *     0 ligne, silencieusement, sans exception ni log ;
 *   - protégé côté code mais hors RLS en base → l'isolation ne repose plus
 *     que sur les clauses `where` applicatives.
 *
 * Lecture seule. Sort en code 1 en cas de dérive, pour être branché en CI.
 */

import { PrismaClient, Prisma } from "@prisma/client";
import { EXEMPT_MODELS } from "../src/lib/prisma-rls";

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
});

/** Nom de table réel d'un modèle Prisma (@@map), sinon son nom. */
function tableNameOf(model: string): string | null {
  const m = Prisma.dmmf.datamodel.models.find((x) => x.name === model);
  if (!m) return null;
  return m.dbName ?? m.name;
}

async function main(): Promise<void> {
  // Exemptions déclarées en base, restreintes à celles qui correspondent à
  // un modèle Prisma : `rls_exemptions` et `_prisma_migrations` sont des
  // tables de service, sans modèle, et n'ont pas d'équivalent côté code.
  const rows = await prisma.$queryRaw<{ table_name: string }[]>`
    SELECT table_name FROM public.rls_exemptions ORDER BY table_name`;

  const modelTables = new Set(
    Prisma.dmmf.datamodel.models.map((m) => m.dbName ?? m.name)
  );
  const dbExempt = new Set(
    rows.map((r) => r.table_name).filter((t) => modelTables.has(t))
  );

  const codeExempt = new Set<string>();
  const modelesInconnus: string[] = [];
  for (const model of EXEMPT_MODELS) {
    const table = tableNameOf(model);
    if (table === null) modelesInconnus.push(model);
    else codeExempt.add(table);
  }

  const manquantEnBase = [...codeExempt].filter((t) => !dbExempt.has(t)).sort();
  const manquantDansCode = [...dbExempt].filter((t) => !codeExempt.has(t)).sort();

  if (modelesInconnus.length === 0 && manquantEnBase.length === 0 && manquantDansCode.length === 0) {
    console.log(`✓ Exemptions RLS cohérentes (${codeExempt.size} tables).`);
    return;
  }

  console.error("✗ Dérive entre EXEMPT_MODELS et public.rls_exemptions\n");

  if (modelesInconnus.length > 0) {
    console.error("  Modèles listés dans EXEMPT_MODELS mais absents du schéma Prisma :");
    for (const m of modelesInconnus) console.error(`    - ${m}`);
    console.error("  → nom de modèle erroné : l'exemption ne s'applique à rien.\n");
  }

  if (manquantEnBase.length > 0) {
    console.error("  Exemptées côté code, mais protégées par RLS en base :");
    for (const t of manquantEnBase) console.error(`    - ${t}`);
    console.error(
      "  → aucun contexte tenant n'est posé sur ces tables : elles renverront\n" +
      "    0 ligne silencieusement. Les ajouter à rls_exemptions (section 0 de\n" +
      "    prisma/migration_rls_secure.sql), ou les retirer d'EXEMPT_MODELS.\n"
    );
  }

  if (manquantDansCode.length > 0) {
    console.error("  Hors RLS en base, mais non exemptées côté code :");
    for (const t of manquantDansCode) console.error(`    - ${t}`);
    console.error(
      "  → l'extension pose un contexte inutile et l'isolation ne repose que\n" +
      "    sur les clauses `where`. Les ajouter à EXEMPT_MODELS, ou les\n" +
      "    retirer de rls_exemptions pour les protéger réellement.\n"
    );
  }

  process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error("Échec du contrôle des exemptions RLS :", err);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
