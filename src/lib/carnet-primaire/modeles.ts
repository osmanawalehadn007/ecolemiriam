import modeles from "./modeles-carnets.json";
import type { Domaine, NiveauCarnet } from "./referentiel";

/**
 * Modèles de carnet de l'école (transcrits des documents Word « CARNET DE LA … ANNEE »).
 * Simples données d'amorçage : à l'exécution, le carnet se lit en base.
 */
export function modeleNiveau(niveau: NiveauCarnet): Domaine[] {
  return (modeles as Record<string, Domaine[]>)[niveau] ?? [];
}

/** Lignes du modèle pour un domaine, ou null si le modèle ne le connaît pas. */
export function modeleDomaine(niveau: NiveauCarnet, code: string): string[] | null {
  return modeleNiveau(niveau).find((d) => d.code === code)?.lignes ?? null;
}
