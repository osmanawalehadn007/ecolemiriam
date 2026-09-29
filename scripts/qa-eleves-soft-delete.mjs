#!/usr/bin/env node
/**
 * QA — intégrité élève : soft-delete vs statut (LECTURE SEULE).
 * Vérifie le risque de facturer un élève supprimé (la requête de l'action
 * manuelle `genererMensualites` filtre `statut = ACTIF` mais pas `deletedAt`).
 */
import { PrismaClient } from "@prisma/client";

const p = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
const T = "cms8kt0b40001zbi3o63y7c5v";

console.log("--- élèves par statut x soft-delete ---");
console.table(
  await p.$queryRawUnsafe(
    `select statut, ("deletedAt" is not null) as soft_deleted, count(*)::int as n
       from eleves where "tenantId"=$1 group by 1,2 order by 1,2`,
    T,
  ),
);

console.log("--- RISQUE : statut ACTIF + soft-deleted (facturables par le chemin legacy) ---");
console.table(
  await p.$queryRawUnsafe(
    `select coalesce(s.nom,'(sans site)') as site, count(*)::int as n
       from eleves e left join sites s on s.id=e."siteId"
      where e."tenantId"=$1 and e.statut='ACTIF' and e."deletedAt" is not null
      group by 1 order by 2 desc`,
    T,
  ),
);

await p.$disconnect();
