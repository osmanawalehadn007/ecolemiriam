import { describe, it, expect } from "vitest";
import { appreciationBareme, decisionPassage, rangsCompetition, libelleRang } from "@/lib/bulletins/bareme";

describe("appreciationBareme", () => {
  it.each([
    [6.99, "En difficultés"],
    [7, "Insuffisant"],
    [9.99, "Insuffisant"],
    [10, "Moyen"],
    [10.01, "Passable"],
    [11.99, "Passable"],
    [12, "Assez Bien"],
    [14, "Bien"],
    [16, "Très Bien"],
    [18, "Excellent"],
    [20, "Excellent"],
  ])("%s → %s", (m, attendu) => {
    expect(appreciationBareme(m)).toBe(attendu);
  });

  it("renvoie vide sans moyenne", () => {
    expect(appreciationBareme(null)).toBe("");
  });
});

describe("decisionPassage", () => {
  it("10 est inclus", () => {
    expect(decisionPassage(10)).toBe("Admis");
    expect(decisionPassage(9.99)).toBe("Ajourné");
    expect(decisionPassage(null)).toBeNull();
  });
});

describe("rangs", () => {
  it("les ex æquo partagent le rang", () => {
    expect(rangsCompetition([15, 12, 12, 9, null])).toEqual([1, 2, 2, 4, null]);
  });
  it("libellé", () => {
    expect(libelleRang(1)).toBe("1er");
    expect(libelleRang(20)).toBe("20ème");
    expect(libelleRang(null)).toBe("");
  });
});
