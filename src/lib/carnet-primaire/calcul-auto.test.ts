import { describe, expect, it } from "vitest";
import { CARNETS } from "./modeles.fixture";
import { domaineDeMatiere } from "./correspondance";
import { calculerSaisieAuto, fusionnerSaisie, type NoteCarnet } from "./calcul-auto";
import { moyenneAnnuelle, noteModule } from "./notation";

const matiere = (nom: string, id = nom) => ({ id, nom });
const note = (nomMatiere: string, valeur: number, extra: Partial<NoteCarnet> = {}): NoteCarnet => ({
  matiere: matiere(nomMatiere),
  moduleCarnet: 1,
  ligneCarnet: null,
  valeur,
  noteMax: 20,
  coefficient: 1,
  ...extra,
});

describe("domaineDeMatiere", () => {
  const d1 = CARNETS["1ère"];
  const d3 = CARNETS["3ème"];

  it("rattache une matière à son domaine par le nom", () => {
    expect(domaineDeMatiere(d1, matiere("Lecture"))).toBe("FRANCAIS");
    expect(domaineDeMatiere(d1, matiere("Mathématiques"))).toBe("MATHS");
    expect(domaineDeMatiere(d1, matiere("Arabe"))).toBe("ARABE");
    expect(domaineDeMatiere(d3, matiere("Histoire"))).toBe("HISTOIRE");
    expect(domaineDeMatiere(d3, matiere("Éducation islamique"))).toBe("EMCI");
  });

  it("renvoie null pour une matière sans domaine", () => {
    expect(domaineDeMatiere(d3, matiere("Natation"))).toBeNull();
  });

  it("la désignation explicite de la direction prime sur le nom", () => {
    const def = { ...d3, domaines: d3.domaines.map((d) => (d.code === "TICE" ? { ...d, matieres: ["natation-id"] } : d)) };
    expect(domaineDeMatiere(def, { id: "natation-id", nom: "Natation" })).toBe("TICE");
    // un domaine réglé à la main ne reçoit plus de matière par le nom
    expect(domaineDeMatiere(def, matiere("Informatique"))).toBeNull();
  });
});

describe("calculerSaisieAuto — format points (3ème)", () => {
  const def = CARNETS["3ème"];

  it("ramène la moyenne du domaine sur son barème", () => {
    // Français /40 : 15/20 et 10/20, coefficient 1 → moyenne 0,625 → 25
    const auto = calculerSaisieAuto(def, [note("Français", 15), note("Français", 10)]);
    expect(auto["1"]?.domaines?.FRANCAIS).toBe(25);
  });

  it("pondère par coefficient et sépare les modules", () => {
    const auto = calculerSaisieAuto(def, [
      note("Maths", 20, { coefficient: 3 }),
      note("Maths", 0, { coefficient: 1 }),
      note("Maths", 10, { moduleCarnet: 2 }),
    ]);
    expect(auto["1"]?.domaines?.MATHS).toBe(30); // 0,75 × 40
    expect(auto["2"]?.domaines?.MATHS).toBe(20); // 0,5 × 40
  });

  it("alimente la note du module et la moyenne annuelle du carnet", () => {
    const auto = calculerSaisieAuto(def, [note("Français", 20), note("Maths", 20)]);
    // 40 + 40 points sur 200 → 4/10
    expect(noteModule(def, auto["1"])).toBe(4);
    expect(moyenneAnnuelle(def, auto)).toBe(4);
  });

  it("ignore les notes sans module, hors barème ou d'une matière inconnue", () => {
    const auto = calculerSaisieAuto(def, [
      note("Français", 10, { moduleCarnet: 9 }),
      note("Français", 10, { noteMax: 0 }),
      note("Natation", 20),
    ]);
    expect(auto).toEqual({});
  });

  it("plafonne une note supérieure au maximum", () => {
    const auto = calculerSaisieAuto(def, [note("Français", 25)]);
    expect(auto["1"]?.domaines?.FRANCAIS).toBe(40);
  });
});

describe("calculerSaisieAuto — format compétences (1ère)", () => {
  const def = CARNETS["1ère"];

  it("convertit la moyenne en A / EVA / NA pour toutes les lignes du domaine", () => {
    expect(calculerSaisieAuto(def, [note("Arabe", 15)])["1"]?.competences?.["ARABE.0"]).toBe("A"); // 75 %
    expect(calculerSaisieAuto(def, [note("Arabe", 10)])["1"]?.competences?.["ARABE.1"]).toBe("EVA"); // 50 %
    expect(calculerSaisieAuto(def, [note("Arabe", 5)])["1"]?.competences?.["ARABE.2"]).toBe("NA"); // 25 %
  });

  it("une note qui vise une ligne ne s'applique qu'à elle, plus les notes du domaine entier", () => {
    const auto = calculerSaisieAuto(def, [
      note("Arabe", 20, { ligneCarnet: 0 }),
      note("Arabe", 4, { ligneCarnet: 1 }),
    ]);
    expect(auto["1"]?.competences).toEqual({ "ARABE.0": "A", "ARABE.1": "NA" });
  });

  it("calcule la note du module sur 10 comme moyenne des domaines notés", () => {
    const auto = calculerSaisieAuto(def, [note("Arabe", 20), note("Lecture", 10)]);
    expect(auto["1"]?.note).toBe(7.5); // (1 + 0,5) / 2 × 10
  });
});

describe("fusionnerSaisie", () => {
  it("la saisie manuelle remplace le calcul, champ par champ", () => {
    const auto = { "1": { competences: { "ARABE.0": "A" as const, "ARABE.1": "A" as const }, note: 8 } };
    const manuel = { "1": { competences: { "ARABE.1": "NA" as const }, note: 5 } };
    const fusion = fusionnerSaisie(auto, manuel);
    expect(fusion["1"]?.competences).toEqual({ "ARABE.0": "A", "ARABE.1": "NA" });
    expect(fusion["1"]?.note).toBe(5);
  });

  it("garde le calcul quand rien n'est saisi à la main", () => {
    const fusion = fusionnerSaisie({ "2": { domaines: { MATHS: 30 } } }, {});
    expect(fusion["2"]?.domaines).toEqual({ MATHS: 30 });
  });
});
