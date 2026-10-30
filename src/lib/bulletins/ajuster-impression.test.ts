import { describe, it, expect } from "vitest";
import { ajusterPourImpression, retablirApresImpression } from "@/lib/bulletins/ajuster-impression";

const element = (hauteur: number) => {
  const el = document.createElement("div");
  Object.defineProperty(el, "offsetHeight", { value: hauteur });
  return el;
};
// zone utile : 285 mm = 1077,17 px

describe("ajusterPourImpression", () => {
  it("ne touche pas un bulletin qui tient déjà", () => {
    const el = element(900);
    expect(ajusterPourImpression(el)).toBe(1);
    expect(el.style.zoom).toBe("");
  });

  it("réduit proportionnellement un bulletin trop haut", () => {
    const el = element(1400);
    const f = ajusterPourImpression(el);
    expect(f).toBeLessThan(1);
    expect(1400 * f).toBeLessThanOrEqual(1077.2);
    expect(Number(el.style.zoom)).toBe(f);
  });

  it("repart d'une mesure propre à chaque impression et rétablit l'écran", () => {
    const el = element(1400);
    ajusterPourImpression(el);
    ajusterPourImpression(el);
    expect(Number(el.style.zoom)).toBeLessThan(1);
    retablirApresImpression(el);
    expect(el.style.zoom).toBe("");
  });
});
