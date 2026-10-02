import { describe, it, expect } from "vitest";
import { cycleDeClasse, compterFactures, grouperFactures } from "./categories";

const f = (statut: string, classe: { nom: string; niveau?: string; structure?: { type: string } } | null, candidature?: string) => ({
  statut,
  eleve: classe ? { classe } : null,
  candidature: candidature ? { classeVoulue: candidature } : null,
});

describe("cycleDeClasse", () => {
  it("privilégie le type de la structure pédagogique", () => {
    expect(cycleDeClasse({ nom: "3ème Année B", niveau: "3ème", structure: { type: "COLLEGE" } })).toBe("COLLEGE");
  });
  it("déduit le cycle du niveau, puis du nom", () => {
    expect(cycleDeClasse({ nom: "X", niveau: "3ème" })).toBe("PRIMAIRE");
    expect(cycleDeClasse({ nom: "7ème A", niveau: "" })).toBe("COLLEGE");
    expect(cycleDeClasse({ nom: "Terminale SG", niveau: null })).toBe("LYCEE");
    expect(cycleDeClasse({ nom: "Petite section", niveau: "Maternelle" })).toBe("MATERNELLE");
    expect(cycleDeClasse({ nom: "Atelier", niveau: "?" })).toBeNull();
  });
});

describe("compterFactures", () => {
  it("compte payées et restant à payer, sans les annulées", () => {
    expect(compterFactures([{ statut: "PAYEE" }, { statut: "EN_ATTENTE" }, { statut: "EN_RETARD" }, { statut: "ANNULEE" }]))
      .toEqual({ payees: 1, impayees: 2 });
  });
});

describe("grouperFactures", () => {
  it("ne garde que les catégories présentes, dans l'ordre scolaire", () => {
    const groupes = grouperFactures([
      f("PAYEE", { nom: "Seconde A", niveau: "Seconde" }),
      f("EN_ATTENTE", { nom: "3ème Année B", niveau: "3ème" }),
      f("PAYEE", { nom: "3ème Année B", niveau: "3ème" }),
      f("EN_ATTENTE", { nom: "1ère Année A", niveau: "1ère" }),
      f("EN_ATTENTE", null, "6ème"),
    ]);
    expect(groupes.map((g) => g.categorie)).toEqual(["PRIMAIRE", "LYCEE", "ADMISSION"]);
    const primaire = groupes[0];
    expect(primaire.classes.map((c) => c.classe)).toEqual(["1ère Année A", "3ème Année B"]);
    expect(primaire.classes[1].compteur).toEqual({ payees: 1, impayees: 1 });
    expect(primaire.compteur).toEqual({ payees: 1, impayees: 2 });
  });
});
