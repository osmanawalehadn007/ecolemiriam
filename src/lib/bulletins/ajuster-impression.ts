/**
 * Fait tenir le bulletin sur une seule page A4 à l'impression, quel que soit le
 * nombre de matières : on réduit proportionnellement (zoom) quand il déborde.
 * Zone utile : A4 (297 mm) moins les marges de la page (5 mm × 2) et une réserve.
 */
const HAUTEUR_UTILE_MM = 285;

export function ajusterPourImpression(element: HTMLElement): number {
  element.style.zoom = "";
  const utilePx = (HAUTEUR_UTILE_MM * 96) / 25.4;
  const hauteur = element.offsetHeight;
  const facteur = hauteur > utilePx ? Math.floor((utilePx / hauteur) * 1000) / 1000 : 1;
  if (facteur < 1) element.style.zoom = String(facteur);
  return facteur;
}

export function retablirApresImpression(element: HTMLElement): void {
  element.style.zoom = "";
}
