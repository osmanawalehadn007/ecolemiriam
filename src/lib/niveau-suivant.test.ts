import { describe, it, expect } from "vitest";
import { niveauSuivant } from "@/lib/niveau-suivant";

describe("niveauSuivant", () => {
  it("progresse dans l'échelle officielle", () => {
    expect(niveauSuivant("1ère")).toBe("2ème");
    expect(niveauSuivant("5ème")).toBe("6ème");
    expect(niveauSuivant("9ème")).toBe("Seconde");
    expect(niveauSuivant("Seconde")).toBe("Première");
    expect(niveauSuivant("Première")).toBe("Terminale");
  });

  it("tolère les écritures non canoniques (classes historiques)", () => {
    // Ces classes portaient « 2 » / « 3 » : la promotion automatique ne les
    // trouvait pas et l'élève restait signalé « sans changement ».
    expect(niveauSuivant("2")).toBe("3ème");
    expect(niveauSuivant("3")).toBe("4ème");
    expect(niveauSuivant("2ème année")).toBe("3ème");
    expect(niveauSuivant("2nde")).toBe("Première");
    expect(niveauSuivant("Tle")).toBeNull();
    expect(niveauSuivant(" 1ère ")).toBe("2ème");
  });

  it("diplôme en fin de cycle", () => {
    expect(niveauSuivant("Terminale")).toBeNull();
  });

  it("demande une décision manuelle hors échelle", () => {
    expect(niveauSuivant("Maternelle")).toBeUndefined();
    expect(niveauSuivant("Zorglub")).toBeUndefined();
    expect(niveauSuivant("")).toBeUndefined();
  });
});
