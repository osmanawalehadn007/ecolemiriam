/**
 * Mapping des niveaux scolaires vers le niveau suivant.
 * Utilisé par la procédure de réinscription pour la promotion automatique.
 *
 * Depuis la migration du 2026-08-27, les niveaux sont stockés en texte.
 * L'ordre est : 1ère → 2ème → … → 9ème → Seconde → Première → Terminale.
 *
 * L'échelle est dérivée du RÉFÉRENTIEL OFFICIEL (`NIVEAUX_CANONIQUES`) et la
 * saisie est normalisée avant lecture : « 2 », « 2eme », « 2ème année » ou
 * « 2nde » donnent le même résultat que la valeur canonique. Sans cela, une
 * classe dont le niveau s'écrivait autrement ne trouvait pas son niveau
 * suivant et la promotion automatique échouait silencieusement.
 *
 * Si un niveau n'est pas dans cette échelle, la promotion est manuelle
 * (l'élève reste dans sa classe actuelle et est signalé).
 */
import { NIVEAUX_CANONIQUES, normaliserNiveau, type NiveauCanonique } from "./niveau";

/**
 * Échelle de progression (Maternelle exclue : elle ne se promeut pas seule).
 * Typée explicitement : l'inférence de `filter` retirerait « Maternelle » du
 * type et `indexOf` refuserait alors un niveau canonique.
 */
const ECHELLE: NiveauCanonique[] = NIVEAUX_CANONIQUES.filter((n) => n !== "Maternelle");

/**
 * Retourne le niveau suivant pour un niveau donné.
 * - null → l'élève est diplomé (dernière année)
 * - undefined → niveau non reconnu, promotion manuelle requise
 */
export function niveauSuivant(niveau: string): string | null | undefined {
  const canonique = normaliserNiveau(niveau);
  if (!canonique) return undefined;

  const rang = ECHELLE.indexOf(canonique);
  if (rang === -1) return undefined;
  if (rang === ECHELLE.length - 1) return null;

  return ECHELLE[rang + 1];
}
