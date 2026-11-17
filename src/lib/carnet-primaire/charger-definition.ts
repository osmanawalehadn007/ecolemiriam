import prisma from "@/lib/prisma";
import { definitionEffective } from "./configuration";
import { NIVEAUX_CARNET, type CarnetDef, type NiveauCarnet } from "./referentiel";

/** Définition du carnet d'un niveau pour un tenant : personnalisation de la direction ou modèle par défaut. */
export async function chargerDefinition(tenantId: string, niveau: NiveauCarnet): Promise<CarnetDef> {
  const configuration = await prisma.carnetConfiguration.findFirst({
    where: { tenantId, niveau },
    select: { domaines: true },
  });
  return definitionEffective(niveau, configuration?.domaines);
}

/** Définitions effectives des cinq niveaux pour un tenant, en une seule requête. */
export async function chargerDefinitions(tenantId: string): Promise<Record<NiveauCarnet, CarnetDef>> {
  const configurations = await prisma.carnetConfiguration.findMany({
    where: { tenantId },
    select: { niveau: true, domaines: true },
  });
  const parNiveau = new Map(configurations.map((c) => [c.niveau, c.domaines]));
  return Object.fromEntries(
    NIVEAUX_CARNET.map((niveau) => [niveau, definitionEffective(niveau, parNiveau.get(niveau))])
  ) as Record<NiveauCarnet, CarnetDef>;
}
