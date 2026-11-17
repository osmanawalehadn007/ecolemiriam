import { describe, expect, it } from "vitest";
import { CARNETS, baremeTotal, estNiveauCarnet, normaliserAnnee } from "./referentiel";
import {
  cleCompetence,
  degreMaitrise,
  erreursDomaines,
  moyenneAnnuelle,
  noteModule,
  noteModulePoints,
} from "./notation";

describe("degreMaitrise", () => {
  it.each([
    [0, "Non acquis"],
    [3, "Non acquis"],
    [3.5, "Non acquis"],
    [4, "En voie d'acquisition"],
    [6.5, "En voie d'acquisition"],
    [7, "Acquis"],
    [10, "Acquis"],
  ])("note %s → %s", (note, attendu) => {
    expect(degreMaitrise(note)).toBe(attendu);
  });
});

describe("référentiel", () => {
  it("3ème à 5ème : le total des barèmes vaut 200", () => {
    expect(baremeTotal(CARNETS["3ème"])).toBe(200);
    expect(baremeTotal(CARNETS["4ème"])).toBe(200);
    expect(baremeTotal(CARNETS["5ème"])).toBe(200);
  });

  it("1ère et 2ème sont au format compétences, sans barème", () => {
    expect(CARNETS["1ère"].format).toBe("competences");
    expect(CARNETS["2ème"].format).toBe("competences");
    expect(CARNETS["1ère"].domaines.every((d) => d.bareme === undefined)).toBe(true);
  });

  it("reconnaît les niveaux du carnet", () => {
    expect(estNiveauCarnet("3ème")).toBe(true);
    expect(estNiveauCarnet("6ème")).toBe(false);
  });

  it("une clé de compétence est stable", () => {
    expect(cleCompetence(CARNETS["1ère"].domaines[0], 2)).toBe("ARABE.2");
  });
});

describe("noteModulePoints", () => {
  it("ramène le total des points sur 10 selon le barème de 200", () => {
    // 100 points sur 200 → 5/10
    expect(noteModulePoints(CARNETS["3ème"], { FRANCAIS: 20, MATHS: 20, ARABE: 10, ANGLAIS: 10, HISTOIRE: 5, GEOGRAPHIE: 5, SCIENCES: 10, EMCI: 10, EMT: 5, TICE: 5 })).toBe(5);
  });

  it("renvoie null sans aucune saisie", () => {
    expect(noteModulePoints(CARNETS["4ème"], {})).toBeNull();
  });
});

describe("erreursDomaines", () => {
  it("signale un domaine qui dépasse son barème", () => {
    const erreurs = erreursDomaines(CARNETS["5ème"], { HISTOIRE: 11, MATHS: 40 });
    expect(erreurs).toHaveLength(1);
    expect(erreurs[0]).toContain("Compétences de base : histoire");
  });

  it("accepte une saisie dans les bornes", () => {
    expect(erreursDomaines(CARNETS["5ème"], { HISTOIRE: 0, MATHS: 40 })).toEqual([]);
  });
});

describe("moyenneAnnuelle", () => {
  it("moyenne des modules renseignés, les vides sont ignorés", () => {
    const saisie = { "1": { note: 8 }, "2": { note: 6 }, "3": { note: null } };
    expect(moyenneAnnuelle(CARNETS["1ère"], saisie)).toBe(7);
  });

  it("null quand aucun module n'est noté", () => {
    expect(moyenneAnnuelle(CARNETS["1ère"], {})).toBeNull();
  });

  it("au format points, la note de module vient des domaines", () => {
    const saisie = { domaines: { FRANCAIS: 40, MATHS: 40, ARABE: 20, ANGLAIS: 20, HISTOIRE: 10, GEOGRAPHIE: 10, SCIENCES: 20, EMCI: 20, EMT: 10, TICE: 10 } };
    expect(noteModule(CARNETS["3ème"], saisie)).toBe(10);
  });
});

describe("normaliserAnnee", () => {
  it.each([
    ["2026-2027", "2026-2027"],
    ["2026/2027", "2026-2027"],
    ["Année 2026 - 2027", "2026-2027"],
  ])("%s → %s", (entree, attendu) => {
    expect(normaliserAnnee(entree)).toBe(attendu);
  });

  it("null si le libellé n'est pas exploitable", () => {
    expect(normaliserAnnee("2026")).toBeNull();
    expect(normaliserAnnee(undefined)).toBeNull();
  });
});
