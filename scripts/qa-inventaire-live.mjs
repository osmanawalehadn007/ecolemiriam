#!/usr/bin/env node
/**
 * QA — inventaire LECTURE SEULE de la base live (tarifs, élèves, factures,
 * enseignants). Aucune écriture, aucun DDL.
 *
 * Usage :
 *   set -a; . ./.env; set +a
 *   node scripts/qa-inventaire-live.mjs
 */
import { PrismaClient } from "@prisma/client";

const url = process.env.DIRECT_URL;
if (!url) {
  console.error("❌ DIRECT_URL manquant (rôle direct/owner, pas le pooler applicatif).");
  process.exit(1);
}

const prisma = new PrismaClient({ datasources: { db: { url } } });
const TENANT = "cms8kt0b40001zbi3o63y7c5v";

const ligne = (t) => console.log(`\n${"═".repeat(4)} ${t} ${"═".repeat(4)}`);

async function main() {
  ligne("ANNÉES SCOLAIRES");
  console.table(
    await prisma.$queryRawUnsafe(
      `select libelle, "isCurrent", to_char("dateDebut",'YYYY-MM-DD') as debut,
              to_char("dateFin",'YYYY-MM-DD') as fin
         from annees_scolaires where "tenantId" = $1 order by "dateDebut" desc`,
      TENANT,
    ),
  );

  ligne("TARIFS — volumétrie par année / actif");
  console.table(
    await prisma.$queryRawUnsafe(
      `select annee, actif, count(*)::int as n
         from tarifs_niveau where "tenantId" = $1
        group by annee, actif order by annee desc, actif desc`,
      TENANT,
    ),
  );

  ligne("TARIFS — dernières modifications (updatedAt)");
  console.table(
    await prisma.$queryRawUnsafe(
      `select niveau, annee, coalesce("siteId",'GLOBAL') as site, mensualite,
              "fraisInscription" as inscr, "fraisRenouvellement" as renouv, actif,
              to_char("updatedAt",'YYYY-MM-DD HH24:MI') as maj,
              to_char("createdAt",'YYYY-MM-DD HH24:MI') as cree
         from tarifs_niveau where "tenantId" = $1
        order by "updatedAt" desc limit 15`,
      TENANT,
    ),
  );

  ligne("TARIFS — journal d'audit (actions contenant 'tarif')");
  console.table(
    await prisma.$queryRawUnsafe(
      `select action, count(*)::int as n, to_char(max("createdAt"),'YYYY-MM-DD HH24:MI') as dernier
         from audit_logs where "tenantId" = $1 and action ilike '%tarif%'
        group by action order by dernier desc`,
      TENANT,
    ),
  );

  ligne("ÉLÈVES — par site / statut");
  console.table(
    await prisma.$queryRawUnsafe(
      `select coalesce(s.nom,'(sans site)') as site, e.statut, count(*)::int as n,
              count(e."classeId")::int as avec_classe
         from eleves e left join sites s on s.id = e."siteId"
        where e."tenantId" = $1 and e."deletedAt" is null
        group by 1,2 order by 1,2`,
      TENANT,
    ),
  );

  ligne("ÉLÈVES ACTIFS AVEC CLASSE — niveaux par site");
  console.table(
    await prisma.$queryRawUnsafe(
      `select coalesce(s.nom,'(sans site)') as site, c.niveau, c.annee, count(*)::int as eleves
         from eleves e
         join classes c on c.id = e."classeId"
         left join sites s on s.id = e."siteId"
        where e."tenantId" = $1 and e."deletedAt" is null and e.statut = 'ACTIF'
        group by 1,2,3 order by 1,2`,
      TENANT,
    ),
  );

  ligne("ÉLÈVES ACTIFS SANS CLASSE (non facturables)");
  console.table(
    await prisma.$queryRawUnsafe(
      `select coalesce(s.nom,'(sans site)') as site, count(*)::int as n
         from eleves e left join sites s on s.id = e."siteId"
        where e."tenantId" = $1 and e."deletedAt" is null and e.statut = 'ACTIF'
          and e."classeId" is null
        group by 1 order by 2 desc`,
      TENANT,
    ),
  );
  ligne("FACTURES — par type / statut / mois 2026");
  console.table(
    await prisma.$queryRawUnsafe(
      `select type, statut, coalesce(mois,'—') as mois, count(*)::int as n,
              sum(montant)::int as montant
         from factures where "tenantId" = $1 and mois like '2026%'
        group by 1,2,3 order by 3,1,2`,
      TENANT,
    ),
  );

  ligne("FACTURES — volumétrie totale + numéros distincts");
  console.table(
    await prisma.$queryRawUnsafe(
      `select count(*)::int as total,
              count(*) filter (where type='MENSUALITE')::int as mensualites,
              count(distinct numero)::int as numeros_distincts,
              count(*) filter (where statut='EN_ATTENTE')::int as impayees
         from factures where "tenantId" = $1`,
      TENANT,
    ),
  );

  ligne("FACTURES — doublons mensuels (vue factures_mensualites_doublons)");
  try {
    const d = await prisma.$queryRawUnsafe(`select * from factures_mensualites_doublons limit 20`);
    console.log(d.length === 0 ? "  ✅ 0 doublon" : JSON.stringify(d, null, 2));
  } catch (e) {
    console.log(`  vue absente/erreur : ${String(e.message).split("\n")[0].slice(0, 120)}`);
  }

  ligne("INDEX factures_unicite_mensuelle");
  console.table(
    await prisma.$queryRawUnsafe(
      `select indexname, indexdef from pg_indexes
        where tablename='factures' and indexname like '%unicite%'`,
    ),
  );

  ligne("ENSEIGNANTS — volumétrie");
  console.table(
    await prisma.$queryRawUnsafe(
      `select (select count(*)::int from enseignants where "tenantId" = $1) as enseignants,
              (select count(*)::int from users where "tenantId" = $1 and role='TEACHER') as users_teacher,
              (select count(*)::int from users where "tenantId" = $1 and role='TEACHER' and "emailVerified" is null) as teacher_non_verifies,
              (select count(*)::int from enseignant_affectations where "tenantId" = $1) as affectations,
              (select count(*)::int from enseignant_matieres where "tenantId" = $1) as liens_matieres`,
      TENANT,
    ),
  );

  ligne("ENSEIGNANTS — sans affectation classe (par site)");
  console.table(
    await prisma.$queryRawUnsafe(
      `select coalesce(s.nom,'(sans site)') as site, count(*)::int as sans_affectation
         from enseignants en
         left join enseignant_sites es on es."enseignantId" = en.id
         left join sites s on s.id = es."siteId"
        where en."tenantId" = $1
          and not exists (select 1 from enseignant_affectations a where a."enseignantId" = en.id)
        group by 1 order by 2 desc`,
      TENANT,
    ),
  );

  ligne("ENSEIGNANTS — classes sans titulaire (par site)");
  console.table(
    await prisma.$queryRawUnsafe(
      `select coalesce(s.nom,'(sans site)') as site, count(*)::int as classes_sans_affectation
         from classes c left join sites s on s.id = c."siteId"
        where c."tenantId" = $1
          and not exists (select 1 from enseignant_affectations a where a."classeId" = c.id)
        group by 1 order by 2 desc`,
      TENANT,
    ),
  );

  ligne("DERNIÈRES ACTIONS D'AUDIT (tous types)");
  console.table(
    await prisma.$queryRawUnsafe(
      `select action, count(*)::int as n, to_char(max("createdAt"),'YYYY-MM-DD HH24:MI') as dernier
         from audit_logs where "tenantId" = $1
        group by action order by dernier desc limit 15`,
      TENANT,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
