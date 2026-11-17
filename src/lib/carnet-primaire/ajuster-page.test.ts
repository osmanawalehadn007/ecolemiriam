import { describe, expect, it } from "vitest";
import { trouverEchelle } from "./ajuster-page";

describe("trouverEchelle", () => {
  it("garde l'échelle 1 quand le contenu tient", () => {
    expect(trouverEchelle(() => 500, 600)).toBe(1);
  });

  it("réduit jusqu'à ce que le contenu tienne (hauteur proportionnelle à l'échelle)", () => {
    const echelle = trouverEchelle((e) => 1000 * e, 600);
    expect(echelle).toBeLessThanOrEqual(0.6);
    expect(echelle).toBeGreaterThan(0.56);
    expect(1000 * echelle).toBeLessThanOrEqual(600);
  });

  it("ne descend jamais sous le minimum lisible", () => {
    expect(trouverEchelle(() => 10_000, 100)).toBe(0.35);
  });
});
