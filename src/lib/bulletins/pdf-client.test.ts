import { describe, it, expect } from "vitest";
import { nomFichierBulletin, dimensionsSurPage } from "@/lib/bulletins/pdf-client";

describe("nomFichierBulletin", () => {
  it("assemble les parties et retire accents et caractères interdits", () => {
    expect(nomFichierBulletin(["Bulletin", "TEST6V-1", "Trimestre 1 : 2026/2027"])).toBe("Bulletin_TEST6V-1_Trimestre_1_2026_2027.pdf");
    expect(nomFichierBulletin(["Élève", null, "Hamdi"])).toBe("Eleve_Hamdi.pdf");
  });
  it("retombe sur un nom par défaut", () => {
    expect(nomFichierBulletin([null, " "])).toBe("Bulletin.pdf");
  });
});

describe("dimensionsSurPage", () => {
  it("tient dans la page A4 en conservant le ratio", () => {
    const d = dimensionsSurPage(756, 1100);
    expect(d.largeur).toBeLessThanOrEqual(595.28 - 28);
    expect(d.hauteur).toBeLessThanOrEqual(841.89 - 28);
    expect(Math.abs(d.largeur / d.hauteur - 756 / 1100)).toBeLessThan(1e-9);
    expect(d.x).toBeGreaterThanOrEqual(0);
    expect(d.y).toBeGreaterThanOrEqual(0);
  });
  it("limite par la largeur quand le bulletin est court", () => {
    const d = dimensionsSurPage(756, 500);
    expect(d.largeur).toBeCloseTo(595.28 - 28, 5);
  });
});
