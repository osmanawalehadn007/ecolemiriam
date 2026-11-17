import { definitionEffective } from "./configuration";
import { modeleNiveau } from "./modeles";
import { NIVEAUX_CARNET, type CarnetDef, type NiveauCarnet } from "./referentiel";

// initialiser.ts importe prisma : les tests lisent le JSON directement.
export const CARNETS = Object.fromEntries(
  NIVEAUX_CARNET.map((n) => [n, definitionEffective(n, modeleNiveau(n))])
) as Record<NiveauCarnet, CarnetDef>;
