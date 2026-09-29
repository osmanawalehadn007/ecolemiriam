import { describe, it, expect } from "vitest";
import {
  NIVEAUX_CANONIQUES,
  NIVEAUX_PAR_CYCLE,
  comparerNiveaux,
  estNiveauCanonique,
  normaliserNiveau,
  niveauOuErreur,
  niveauToLabel,
} from "@/lib/niveau";

describe("référentiel des niveaux", () => {
  it("est une liste fermée sans doublon", () => {
    expect(new Set(NIVEAUX_CANONIQUES).size).toBe(NIVEAUX_CANONIQUES.length);
  });

  it("distingue « 1ère » (primaire) de « Première » (lycée)", () => {
    // Deux niveaux, deux tarifs (7 000 contre 15 000 DJF) : ne jamais les
    // confondre, c'est l'erreur que `cleNiveau` documente déjà côté tarifs.
    expect(NIVEAUX_CANONIQUES).toContain("1ère");
    expect(NIVEAUX_CANONIQUES).toContain("Première");
    expect(normaliserNiveau("1ère")).toBe("1ère");
    expect(normaliserNiveau("Première")).toBe("Première");
  });

  it("les cycles couvrent exactement le référentiel, dans l'ordre", () => {
    expect(NIVEAUX_PAR_CYCLE.flatMap((c) => c.niveaux)).toEqual([...NIVEAUX_CANONIQUES]);
  });

  it("estNiveauCanonique n'accepte que les valeurs exactes", () => {
    expect(estNiveauCanonique("2ème")).toBe(true);
    expect(estNiveauCanonique("2")).toBe(false);
    expect(estNiveauCanonique(" 2ème ")).toBe(false);
    expect(estNiveauCanonique(null)).toBe(false);
  });

  it("trie les niveaux dans l'ordre scolaire", () => {
    const melange = ["Terminale", "Maternelle", "6ème", "1ère"];
    expect([...melange].sort(comparerNiveaux)).toEqual(["Maternelle", "1ère", "6ème", "Terminale"]);
  });
});

describe("normaliserNiveau — les saisies qui rendaient une classe infacturable", () => {
  it.each([
    ["2", "2ème"],
    ["3", "3ème"],
    ["3eme", "3ème"],
    ["2ème", "2ème"],
    ["2ème année", "2ème"],
    ["2ème ANNÉE", "2ème"],
    ["2ème Année B", "2ème"],
    ["3ème Année C", "3ème"],
    ["2e", "2ème"],
    ["niveau 2", "2ème"],
    ["classe de 6ème", "6ème"],
    ["6eme", "6ème"],
    ["1ère", "1ère"],
    ["1ere", "1ère"],
    ["1er", "1ère"],
    ["1ère année", "1ère"],
    ["1ère A", "1ère"],
    ["1ère année B", "1ère"],
    ["PS/MS", "Maternelle"],
    ["MS/GS", "Maternelle"],
    ["petite section", "Maternelle"],
    ["Maternelle", "Maternelle"],
    ["Seconde", "Seconde"],
    ["2nde", "Seconde"],
    ["Première", "Première"],
    ["premiere", "Première"],
    ["Terminale", "Terminale"],
    ["Tle", "Terminale"],
    ["CP", "1ère"],
    ["CM2", "5ème"],
    ["10", "Seconde"],
    ["12", "Terminale"],
  ])("« %s » → %s", (saisie, attendu) => {
    expect(normaliserNiveau(saisie)).toBe(attendu);
  });

  it.each([
    [""],
    ["   "],
    ["Zorglub"],
    ["13"],
    ["99"],
    ["99ème Z"],
    ["1ere lycee"],
    [null],
    [undefined],
  ])("refuse « %s » — jamais de niveau deviné", (saisie) => {
    expect(normaliserNiveau(saisie as string | null | undefined)).toBeNull();
  });

  it("est idempotente : normaliser un niveau officiel ne le change pas", () => {
    for (const niveau of NIVEAUX_CANONIQUES) {
      expect(normaliserNiveau(niveau)).toBe(niveau);
    }
  });
});

describe("niveauOuErreur", () => {
  it("renvoie le niveau officiel", () => {
    expect(niveauOuErreur("2")).toBe("2ème");
    expect(niveauOuErreur(" 2ème année ")).toBe("2ème");
  });

  it("refuse en citant la liste autorisée", () => {
    expect(() => niveauOuErreur("Zorglub")).toThrow(/Valeurs autorisées/);
    expect(() => niveauOuErreur("")).toThrow(/Valeurs autorisées/);
  });
});

describe("niveauToLabel (affichage, comportement inchangé)", () => {
  it("ajoute « année » aux niveaux primaire/collège", () => {
    expect(niveauToLabel("2ème")).toBe("2ème année");
    expect(niveauToLabel("6")).toBe("6ème année");
  });

  it("laisse les niveaux du lycée tels quels", () => {
    expect(niveauToLabel("Terminale")).toBe("Terminale");
    expect(niveauToLabel("Première")).toBe("Première");
  });

  it("gère les valeurs vides", () => {
    expect(niveauToLabel(null)).toBe("");
    expect(niveauToLabel(undefined)).toBe("");
  });
});
