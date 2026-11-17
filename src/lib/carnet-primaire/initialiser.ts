import prisma from "@/lib/prisma";
import { modeleNiveau } from "./modeles";
import { domainesStockes } from "./configuration";
import { NIVEAUX_CARNET, type NiveauCarnet } from "./referentiel";

/**
 * Amorce les niveaux d'un tenant qui n'ont encore ni configuration ni compétence :
 * domaines dans `carnet_configurations`, lignes dans `competences`. Idempotent.
 */
export async function initialiserCarnets(tenantId: string): Promise<void> {
  const [configurations, competences] = await Promise.all([
    prisma.carnetConfiguration.findMany({ where: { tenantId }, select: { niveau: true } }),
    prisma.competence.findMany({ where: { tenantId }, select: { niveau: true }, distinct: ["niveau"] }),
  ]);
  const presents = new Set([...configurations.map((c) => c.niveau), ...competences.map((c) => c.niveau)]);
  for (const niveau of NIVEAUX_CARNET) {
    if (presents.has(niveau)) continue;
    await ecrireModele(tenantId, niveau);
  }
}

/** (Ré)écrit le modèle d'un niveau : remplace configuration et compétences du tenant pour ce niveau. */
export async function ecrireModele(tenantId: string, niveau: NiveauCarnet): Promise<void> {
  const domaines = modeleNiveau(niveau);
  const json = JSON.parse(JSON.stringify(domainesStockes(domaines)));
  await prisma.$transaction([
    prisma.carnetConfiguration.upsert({
      where: { tenantId_niveau: { tenantId, niveau } },
      create: { tenantId, niveau, domaines: json },
      update: { domaines: json },
    }),
    prisma.competence.deleteMany({ where: { tenantId, niveau } }),
    prisma.competence.createMany({
      data: domaines.flatMap((d) => d.lignes.map((libelle, ordre) => ({ tenantId, niveau, domaine: d.code, ordre, libelle }))),
      skipDuplicates: true,
    }),
  ]);
}
