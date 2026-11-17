import prisma from "@/lib/prisma";
import { definitionEffective } from "./configuration";
import { initialiserCarnets } from "./initialiser";
import { NIVEAUX_CARNET, type CarnetDef, type NiveauCarnet } from "./referentiel";

/** Définition du carnet d'un niveau pour un tenant, lue en base (amorcée au premier accès). */
export async function chargerDefinition(tenantId: string, niveau: NiveauCarnet): Promise<CarnetDef> {
  return (await chargerDefinitions(tenantId))[niveau];
}

/** Définitions des cinq niveaux pour un tenant : domaines (carnet_configurations) et compétences (competences). */
export async function chargerDefinitions(tenantId: string): Promise<Record<NiveauCarnet, CarnetDef>> {
  await initialiserCarnets(tenantId);
  const [configurations, competences] = await Promise.all([
    prisma.carnetConfiguration.findMany({ where: { tenantId }, select: { niveau: true, domaines: true } }),
    prisma.competence.findMany({ where: { tenantId }, select: { niveau: true, domaine: true, ordre: true, libelle: true } }),
  ]);
  const parNiveau = new Map(configurations.map((c) => [c.niveau, c.domaines]));
  return Object.fromEntries(
    NIVEAUX_CARNET.map((niveau) => [
      niveau,
      definitionEffective(niveau, parNiveau.get(niveau), competences.filter((c) => c.niveau === niveau)),
    ])
  ) as Record<NiveauCarnet, CarnetDef>;
}
