/**
 * Migration : numérotation atomique des factures.
 *
 *   DIRECT_URL=… npx tsx scripts/migrate-numerotation-factures.ts --etape=1
 *   DIRECT_URL=… npx tsx scripts/migrate-numerotation-factures.ts --etape=2
 *
 * POURQUOI
 * --------
 * Les numéros étaient calculés par `prisma.facture.count() + 1`, requête
 * filtrée par RLS : chaque site repartait de sa propre séquence, et deux
 * créations simultanées pouvaient obtenir le même numéro. Constat du
 * 2026-09-27 : 322 factures pour 257 numéros distincts.
 *
 * ÉTAPE 1 — avant le déploiement (sans effet sur le code actuel)
 *   - table `facture_sequences` : dernier numéro émis par (tenant, préfixe) ;
 *   - fonction `next_facture_numeros(tenant, prefixe, nombre)` en SECURITY
 *     DEFINER : réserve un bloc de numéros sous verrou et renvoie le premier.
 *     À la première utilisation d'un préfixe, elle part du plus grand numéro
 *     existant pour ce tenant, TOUS SITES CONFONDUS — les anciens numéros ne
 *     sont donc jamais réattribués ;
 *   - la table n'est accessible à aucun rôle applicatif : seule la fonction
 *     y touche. EXECUTE est accordé au seul rôle `ecolemiriam_app`.
 *
 * ÉTAPE 2 — après la promotion en production
 *   Index unique (tenantId, numero) sur les factures créées à partir de
 *   maintenant. Les 65 numéros en double déjà émis sont conservés tels quels
 *   (imprimés, remis aux parents) : l'index est partiel pour ne pas les
 *   couvrir. Le lancer avant la promotion ferait échouer les créations de
 *   l'ancien code, qui produit encore des doublons entre sites.
 *
 * Les deux étapes sont idempotentes.
 */

import { PrismaClient } from "@prisma/client";

const ETAPE_1 = [
  `CREATE TABLE IF NOT EXISTS facture_sequences (
     "tenantId" TEXT NOT NULL,
     prefixe    TEXT NOT NULL,
     dernier    INTEGER NOT NULL CHECK (dernier >= 0),
     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
     CONSTRAINT facture_sequences_pkey PRIMARY KEY ("tenantId", prefixe)
   )`,
  `ALTER TABLE facture_sequences ENABLE ROW LEVEL SECURITY`,
  `REVOKE ALL ON TABLE facture_sequences FROM PUBLIC`,
  `DO $$
   DECLARE r TEXT;
   BEGIN
     FOREACH r IN ARRAY ARRAY['ecolemiriam_app', 'anon', 'authenticated'] LOOP
       IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
         EXECUTE format('REVOKE ALL ON TABLE facture_sequences FROM %I', r);
       END IF;
     END LOOP;
   END $$`,
  String.raw`CREATE OR REPLACE FUNCTION next_facture_numeros(p_tenant TEXT, p_prefixe TEXT, p_nombre INTEGER)
   RETURNS INTEGER
   LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = public, pg_temp
   AS $fn$
   DECLARE
     v_dernier INTEGER;
   BEGIN
     IF p_tenant IS NULL OR p_prefixe IS NULL OR p_prefixe !~ '^\d{4}$' THEN
       RAISE EXCEPTION 'next_facture_numeros: tenant ou préfixe invalide (%)', p_prefixe;
     END IF;
     IF p_nombre IS NULL OR p_nombre < 1 OR p_nombre > 50000 THEN
       RAISE EXCEPTION 'next_facture_numeros: nombre invalide (%)', p_nombre;
     END IF;

     -- Sérialise l'initialisation d'un préfixe encore absent de la table ;
     -- ensuite, le verrou de ligne de l'UPDATE suffit.
     PERFORM pg_advisory_xact_lock(hashtext('facture_sequences:' || p_tenant || ':' || p_prefixe));

     UPDATE facture_sequences
        SET dernier = dernier + p_nombre, "updatedAt" = now() AT TIME ZONE 'utc'
      WHERE "tenantId" = p_tenant AND prefixe = p_prefixe
      RETURNING dernier INTO v_dernier;

     IF NOT FOUND THEN
       SELECT COALESCE(MAX(substring(numero FROM '(\d+)$')::INTEGER), 0) + p_nombre
         INTO v_dernier
         FROM factures
        WHERE "tenantId" = p_tenant
          AND numero LIKE 'FAC-' || p_prefixe || '-%';
       INSERT INTO facture_sequences ("tenantId", prefixe, dernier)
       VALUES (p_tenant, p_prefixe, v_dernier);
     END IF;

     RETURN v_dernier - p_nombre + 1;
   END
   $fn$`,
  `REVOKE ALL ON FUNCTION next_facture_numeros(TEXT, TEXT, INTEGER) FROM PUBLIC`,
  `DO $$
   BEGIN
     IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
       REVOKE ALL ON FUNCTION next_facture_numeros(TEXT, TEXT, INTEGER) FROM anon;
     END IF;
     IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
       REVOKE ALL ON FUNCTION next_facture_numeros(TEXT, TEXT, INTEGER) FROM authenticated;
     END IF;
     IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ecolemiriam_app') THEN
       RAISE EXCEPTION 'Rôle ecolemiriam_app introuvable : la fonction serait inutilisable par l''application';
     END IF;
     GRANT EXECUTE ON FUNCTION next_facture_numeros(TEXT, TEXT, INTEGER) TO ecolemiriam_app;
   END $$`,
];

const ETAPE_2 = [
  `DO $$
   BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'factures_numero_unique') THEN
       EXECUTE format(
         'CREATE UNIQUE INDEX factures_numero_unique ON factures ("tenantId", numero) WHERE "createdAt" >= %L::timestamp',
         now() AT TIME ZONE 'utc'
       );
     END IF;
   END $$`,
];

async function main(): Promise<void> {
  const arg = process.argv.find((a) => a.startsWith("--etape="));
  const etape = arg?.split("=")[1];
  if (etape !== "1" && etape !== "2") {
    throw new Error("Préciser --etape=1 (avant déploiement) ou --etape=2 (après promotion)");
  }

  const url = process.env.DIRECT_URL;
  if (!url) throw new Error("DIRECT_URL requis (rôle owner)");
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  try {
    const statements = etape === "1" ? ETAPE_1 : ETAPE_2;
    await prisma.$transaction(async (tx) => {
      for (const [i, sql] of statements.entries()) {
        console.log(`[${i + 1}/${statements.length}] ${sql.trim().split("\n")[0].slice(0, 90)}`);
        await tx.$executeRawUnsafe(sql);
      }
    });

    if (etape === "1") {
      const [check] = await prisma.$queryRaw<{ fonction: boolean; execute_app: boolean; table_app: boolean }[]>`
        SELECT to_regprocedure('next_facture_numeros(text,text,integer)') IS NOT NULL AS fonction,
               has_function_privilege('ecolemiriam_app', 'next_facture_numeros(text,text,integer)', 'EXECUTE') AS execute_app,
               has_table_privilege('ecolemiriam_app', 'facture_sequences', 'SELECT') AS table_app`;
      console.log(check);
      if (!check.fonction || !check.execute_app || check.table_app) {
        throw new Error("Vérification des droits en échec");
      }
    } else {
      const [check] = await prisma.$queryRaw<{ indexdef: string }[]>`
        SELECT indexdef FROM pg_indexes WHERE indexname = 'factures_numero_unique'`;
      console.log(check?.indexdef);
    }
    console.log(`Étape ${etape} appliquée.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
