import { describe, it, expect } from "vitest";
import { indexerTarifs } from "@/lib/facturation/tarifs";

describe("indexerTarifs", () => {
  const tarifs = [
    { id: "g1", niveau: "1ère", siteId: null, mensualite: 7000 },
    { id: "pk1", niveau: "1ère", siteId: "PK12", mensualite: 6000 },
    { id: "g9", niveau: "9ème", siteId: null, mensualite: 12000 },
  ];
  const trouver = indexerTarifs(tarifs);

  it("privilégie le tarif du site, quel que soit l'ordre des tarifs", () => {
    expect(trouver("1ère", "PK12")?.id).toBe("pk1");
    expect(indexerTarifs([...tarifs].reverse())("1ère", "PK12")?.id).toBe("pk1");
  });

  it("retombe sur le tarif global pour un autre site ou sans site", () => {
    expect(trouver("1ère", "CAMPUS")?.id).toBe("g1");
    expect(trouver("1ère", null)?.id).toBe("g1");
    expect(trouver("9ème", "PK12")?.id).toBe("g9");
  });

  it("trouve le tarif d'une classe restée au format numérique", () => {
    expect(trouver("1", "CAMPUS")?.id).toBe("g1");
    expect(trouver("1", "PK12")?.id).toBe("pk1");
  });

  it("trouve le tarif quel que soit le format du niveau de la classe", () => {
    expect(trouver("1ère année", "CAMPUS")?.id).toBe("g1");
    expect(trouver("9ème Année B", "PK12")?.id).toBe("g9");
    expect(trouver("9eme", null)?.id).toBe("g9");
  });

  it("renvoie undefined sans tarif ni niveau", () => {
    expect(trouver("Terminale", null)).toBeUndefined();
    expect(trouver(null, "PK12")).toBeUndefined();
  });
});
