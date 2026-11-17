import prisma from "@/lib/prisma";
import { definitionEffective } from "./configuration";
import type { CarnetDef, NiveauCarnet } from "./referentiel";

/** Définition du carnet d'un niveau pour un tenant : personnalisation de la direction ou modèle par défaut. */
export async function chargerDefinition(tenantId: string, niveau: NiveauCarnet): Promise<CarnetDef> {
  const configuration = await prisma.carnetConfiguration.findFirst({
    where: { tenantId, niveau },
    select: { domaines: true },
  });
  return definitionEffective(niveau, configuration?.domaines);
}
