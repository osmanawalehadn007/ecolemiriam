import { describe, it, expect } from "vitest";
import {
  getSchoolGroup,
  groupBySchoolLevel,
  SCHOOL_GROUP_ICONS,
  SCHOOL_GROUP_ORDER,
} from "@/lib/school-groups";

describe("getSchoolGroup", () => {
  it("place la maternelle dans son propre groupe, pas dans « Autre »", () => {
    // Cas réel (ANNEXE PK12) : classes « Garderie » / « GARDERIE » de niveau
    // « Maternelle » — elles atterrissaient dans l'onglet « Autre ».
    expect(getSchoolGroup("Maternelle", "Garderie")).toBe("Maternelle");
    expect(getSchoolGroup("Maternelle", "GARDERIE")).toBe("Maternelle");
    expect(getSchoolGroup("Maternelle", "Garderie 2")).toBe("Maternelle");
  });

  it("reconnaît la maternelle depuis le nom seul (garderies, sections)", () => {
    expect(getSchoolGroup("", "Garderies")).toBe("Maternelle");
    expect(getSchoolGroup("", "PS")).toBe("Maternelle");
    expect(getSchoolGroup("", "Moyenne Section")).toBe("Maternelle");
    expect(getSchoolGroup("", "Grande section A")).toBe("Maternelle");
  });

  it("range chaque niveau du système djiboutien au bon groupe", () => {
    expect(getSchoolGroup("1ère", "1ère Année E")).toBe("Primaire");
    expect(getSchoolGroup("5ème", "5ème A")).toBe("Primaire");
    expect(getSchoolGroup("6ème", "6ème B")).toBe("Collège");
    expect(getSchoolGroup("9ème", "9ème C")).toBe("Collège");
    expect(getSchoolGroup("Seconde", "Seconde A")).toBe("Lycée");
    expect(getSchoolGroup("Terminale", "Terminale D")).toBe("Lycée");
  });

  it("distingue « 1ère » (primaire) de « Première » (lycée)", () => {
    // Règle du système djiboutien : deux chaînes distinctes, deux niveaux.
    expect(getSchoolGroup("1ère", "1ère")).toBe("Primaire");
    expect(getSchoolGroup("Première", "Première")).toBe("Lycée");
  });

  it("laisse « Autre » aux classes inconnues", () => {
    expect(getSchoolGroup("", "Club robotique")).toBe("Autre");
    expect(getSchoolGroup("", "Sans niveau")).toBe("Autre");
  });
});

describe("SCHOOL_GROUP_ORDER", () => {
  it("couvre tous les groupes, maternelle en tête, avec une icône chacun", () => {
    expect(SCHOOL_GROUP_ORDER).toEqual(["Maternelle", "Primaire", "Collège", "Lycée", "Autre"]);
    expect(Object.keys(SCHOOL_GROUP_ICONS).sort()).toEqual([...SCHOOL_GROUP_ORDER].sort());
  });
});

describe("groupBySchoolLevel", () => {
  it("groupe les élèves de maternelle sous « Maternelle », pas « Autre »", () => {
    const eleves = [
      { classe: { nom: "Garderie", niveau: "Maternelle" } },
      { classe: { nom: "1ère Année E", niveau: "1ère" } },
      { classe: null },
    ];
    const groupes = groupBySchoolLevel(eleves);
    expect(groupes.map((g) => g.group)).toEqual(["Maternelle", "Primaire", "Autre"]);
    expect(groupes[0].classes[0].classe).toBe("Garderie");
  });
});
