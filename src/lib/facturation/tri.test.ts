import { describe, it, expect } from "vitest";
import { trierFactures } from "./tri";

const f = (numero: string, statut: string, prenom: string, nom: string, admission = false) => ({
  numero,
  statut,
  eleve: admission ? null : { nom, prenom },
  candidature: admission ? { nom, prenom } : null,
});

describe("trierFactures", () => {
  it("place les impayées avant les payées, chaque bloc par ordre alphabétique", () => {
    const tri = trierFactures([
      f("F-1", "PAYEE", "Zahra", "Ali"),
      f("F-2", "EN_ATTENTE", "Omar", "Said"),
      f("F-3", "PAYEE", "Amina", "Hassan"),
      f("F-4", "EN_RETARD", "ayan", "Farah"),
      f("F-5", "ANNULEE", "Aden", "Ali"),
    ]);
    expect(tri.map((x) => x.numero)).toEqual(["F-4", "F-2", "F-3", "F-1", "F-5"]);
  });

  it("ignore casse et accents, et départage par numéro", () => {
    const tri = trierFactures([
      f("F-10", "EN_ATTENTE", "Élodie", "Moussa"),
      f("F-2", "EN_ATTENTE", "elodie", "moussa"),
      f("F-3", "EN_ATTENTE", "Daoud", "Ali", true),
    ]);
    expect(tri.map((x) => x.numero)).toEqual(["F-3", "F-2", "F-10"]);
  });

  it("ne modifie pas le tableau reçu", () => {
    const entree = [f("F-1", "PAYEE", "B", "B"), f("F-2", "EN_ATTENTE", "A", "A")];
    trierFactures(entree);
    expect(entree[0].numero).toBe("F-1");
  });
});
