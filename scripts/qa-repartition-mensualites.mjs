#!/usr/bin/env node
/**
 * QA — répartition des montants de mensualités d'un mois (LECTURE SEULE).
 * Sert à vérifier si la mensualité inclut ou non les frais de réinscription
 * de septembre, et quels sites/statuts sont couverts.
 *
 * Usage :
 *   set -a; . ./.env; set +a
 *   node scripts/qa-repartition-mensualites.mjs [mois=2026-09]
 */
import { PrismaClient } from "@prisma/client";

const p = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
const T = "cms8kt0b40001zbi3o63y7c5v";
const mois = process.argv[2] ?? "2026-09";

console.log(`--- libellés des mensualités ${mois} ---`);
console.table(
  await p.$queryRawUnsafe(
    `select libelle, statut, count(*)::int as n, sum(montant)::int as total
       from factures where "tenantId"=$1 and type='MENSUALITE' and mois=$2
      group by 1,2 order by 3 desc limit 15`,
    T,
    mois,
  ),
);

console.log(`--- répartition des montants (mensualités ${mois}, hors annulées) ---`);
console.table(
  await p.$queryRawUnsafe(
    `select montant::int as montant, count(*)::int as n
       from factures where "tenantId"=$1 and type='MENSUALITE' and mois=$2
         and statut <> 'ANNULEE'
      group by 1 order by 2 desc limit 30`,
    T,
    mois,
  ),
);

console.log(`--- couverture par site / statut (${mois}) ---`);
console.table(
  await p.$queryRawUnsafe(
    `select coalesce(s.nom,'(sans site)') as site, f.statut, count(*)::int as n
       from factures f left join sites s on s.id=f."siteId"
      where f."tenantId"=$1 and f.type='MENSUALITE' and f.mois=$2
      group by 1,2 order by 1,2`,
    T,
    mois,
  ),
);

await p.$disconnect();
