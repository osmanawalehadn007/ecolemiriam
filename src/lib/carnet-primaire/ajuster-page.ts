/**
 * Fait tenir la page de compétences du carnet sur une seule feuille A4 paysage.
 *
 * Le contenu (`.interieur-contenu`) est réduit par `transform: scale` ; sa
 * largeur est agrandie d'autant (`100 % / échelle`) pour garder toute la largeur
 * de la feuille, ce qui fait aussi moins renvoyer le texte à la ligne. Comme la
 * hauteur dépend de la largeur, on cherche l'échelle par essais successifs.
 */

/**
 * Plus grande échelle (≤ 1, par pas de 0,02) pour laquelle la hauteur visuelle du
 * contenu tient dans `limite`. S'arrête à `min` : en dessous le texte serait illisible.
 */
export function trouverEchelle(
  hauteurVisuelle: (echelle: number) => number,
  limite: number,
  min = 0.35,
  pas = 0.02
): number {
  let echelle = 1;
  while (hauteurVisuelle(echelle) > limite && echelle > min) {
    echelle = Math.max(min, Math.round((echelle - pas) * 100) / 100);
  }
  return echelle;
}

/** Applique l'ajustement au document d'impression ; renvoie l'échelle retenue. */
export function ajusterCarnetUnePage(doc: Document): number {
  const page = doc.querySelector<HTMLElement>(".interieur");
  const contenu = page?.querySelector<HTMLElement>(".interieur-contenu");
  const vue = doc.defaultView;
  if (!page || !contenu || !vue) return 1;

  const style = vue.getComputedStyle(page);
  const limite = page.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);

  const appliquer = (echelle: number) => {
    contenu.style.width = echelle < 1 ? `${100 / echelle}%` : "";
    contenu.style.transform = echelle < 1 ? `scale(${echelle})` : "";
  };

  const echelle = trouverEchelle((e) => {
    appliquer(e);
    return contenu.offsetHeight * e;
  }, limite);
  appliquer(echelle);
  return echelle;
}
