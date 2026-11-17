import { describe, expect, it } from "vitest";
import { MODELES_MATIERES, matieresACreer, normaliserNom, trouverModele } from "./matieres-defaut";

describe("modèles de matières par défaut", () => {
  it("reprennent le nombre de matières des classeurs Excel", () => {
    expect(trouverModele("college-8eme")?.matieres).toHaveLength(7);
    expect(trouverModele("lycee-seconde")?.matieres).toHaveLength(9);
    expect(trouverModele("lycee-premiere-gfm")?.matieres).toHaveLength(11);
  });

  it("donnent le coefficient 1 à toutes les matières (moyenne simple)", () => {
    for (const modele of MODELES_MATIERES) {
      expect(modele.matieres.every((m) => m.coefficient === 1)).toBe(true);
    }
  });

  it("n'ont ni nom ni code en double dans un modèle", () => {
    for (const modele of MODELES_MATIERES) {
      expect(new Set(modele.matieres.map((m) => m.nom)).size).toBe(modele.matieres.length);
      expect(new Set(modele.matieres.map((m) => m.code)).size).toBe(modele.matieres.length);
    }
  });
});

describe("normaliserNom", () => {
  it("ignore accents, casse, tirets et espaces", () => {
    expect(normaliserNom("  Économie-Droit ")).toBe(normaliserNom("ECONOMIE DROIT"));
    expect(normaliserNom("Hist-Géo.")).toBe(normaliserNom("hist géo"));
  });
});

describe("matieresACreer", () => {
  const seconde = trouverModele("lycee-seconde")!;

  it("renvoie tout le modèle quand rien n'existe", () => {
    expect(matieresACreer(seconde, [])).toHaveLength(9);
  });

  it("ignore une matière déjà présente pour le même niveau ou sans niveau", () => {
    const restantes = matieresACreer(seconde, [
      { nom: "français", niveau: "10" },
      { nom: "Maths", niveau: null },
    ]);
    expect(restantes.map((m) => m.nom)).not.toContain("Français");
    expect(restantes.map((m) => m.nom)).not.toContain("Maths");
    expect(restantes).toHaveLength(7);
  });

  it("recrée la matière quand l'existante est d'un autre niveau", () => {
    const restantes = matieresACreer(seconde, [{ nom: "Français", niveau: "8" }]);
    expect(restantes.map((m) => m.nom)).toContain("Français");
  });
});
