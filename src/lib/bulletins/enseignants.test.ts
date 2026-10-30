import { describe, it, expect } from "vitest";
import { nomsEnseignantsParMatiere, nomEnseignantMatiere } from "@/lib/bulletins/enseignants";

describe("enseignants du bulletin", () => {
  const noms = nomsEnseignantsParMatiere([
    { matiereId: "fr", nom: "AMINA HASSAN" },
    { matiereId: "fr", nom: "OMAR ALI" },
    { matiereId: "fr", nom: "AMINA HASSAN" },
    { matiereId: "ma", nom: "  " },
    { matiereId: null, nom: "TITULAIRE DE CLASSE" },
  ]);

  it("réunit les enseignants d'une même matière sans doublon", () => {
    expect(nomEnseignantMatiere(noms, "fr")).toBe("AMINA HASSAN / OMAR ALI");
  });

  it("retombe sur l'enseignant de toutes les matières", () => {
    expect(nomEnseignantMatiere(noms, "ma")).toBe("TITULAIRE DE CLASSE");
    expect(nomEnseignantMatiere(noms, "xx")).toBe("TITULAIRE DE CLASSE");
  });

  it("renvoie null sans affectation", () => {
    expect(nomEnseignantMatiere(nomsEnseignantsParMatiere([]), "fr")).toBeNull();
  });
});
