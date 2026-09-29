#!/usr/bin/env node
/**
 * QA — périmètres des utilisateurs (LECTURE SEULE).
 * Combien de comptes non tenant-wide ont un rattachement de site explicite
 * (`user_sites` / `enseignant_sites`) ? Sert à mesurer la portée réelle du
 * risque « action réservée à parametres:write mais non bornée au site ».
 */
import { PrismaClient } from "@prisma/client";

const p = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
const T = "cms8kt0b40001zbi3o63y7c5v";

console.log("--- utilisateurs par rôle ---");
console.table(
  await p.$queryRawUnsafe(
    `select role, count(*)::int as n,
            count(*) filter (where "siteId" is not null)::int as avec_siteid
       from users where "tenantId"=$1 group by 1 order by 2 desc`,
    T,
  ),
);

console.log("--- rattachements de site explicites ---");
console.table(
  await p.$queryRawUnsafe(
    `select
       (select count(*)::int from user_sites us join users u on u.id=us."userId" where u."tenantId"=$1) as user_sites,
       (select count(*)::int from enseignant_sites es join enseignants e on e.id=es."enseignantId" where e."tenantId"=$1) as enseignant_sites,
       (select count(*)::int from users u where u."tenantId"=$1 and u.role='ACCOUNTANT') as comptables`,
    T,
  ),
);

await p.$disconnect();
