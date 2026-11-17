import { describe, expect, it } from "vitest";
import { definitionEffective, validerDomaines } from "./configuration";
import { CARNETS } from "./modeles.fixture";
import { baremeTotal } from "./referentiel";
import { noteModulePoints } from "./notation";

const domaine = (code: string, bareme?: number) => ({
  code,
  libelle: `Domaine ${code}`,
  lignes: ["Une compétence"],
  ...(bareme === undefined ? {} : { bareme }),
});

describe("validerDomaines", () => {
  it("accepte la configuration par défaut de chaque niveau", () => {
    for (const niveau of ["1ère", "2ème", "3ème", "4ème", "5ème"] as const) {
      expect(validerDomaines(niveau, CARNETS[niveau].domaines).ok).toBe(true);
    }
  });

  it("exige un barème au format points", () => {
    const r = validerDomaines("3ème", [domaine("MATHS")]);
    expect(r.ok).toBe(false);
  });

  it("retire le barème au format compétences", () => {
    const r = validerDomaines("1ère", [domaine("ARABE", 20)]);
    expect(r.ok && r.domaines[0]).toEqual({ code: "ARABE", libelle: "Domaine ARABE", lignes: ["Une compétence"] });
  });

  it("refuse les codes en double, les lignes vides et les barèmes négatifs", () => {
    expect(validerDomaines("3ème", [domaine("A", 10), domaine("A", 10)]).ok).toBe(false);
    expect(validerDomaines("3ème", [{ ...domaine("A", 10), lignes: [" "] }]).ok).toBe(false);
    expect(validerDomaines("3ème", [domaine("A", -5)]).ok).toBe(false);
    expect(validerDomaines("3ème", []).ok).toBe(false);
  });
});

describe("definitionEffective", () => {
  it("donne un carnet sans domaine quand la base n'a rien ou une configuration invalide", () => {
    expect(definitionEffective("4ème", null).domaines).toEqual([]);
    expect(definitionEffective("4ème", [{ code: "x" }]).domaines).toEqual([]);
    expect(definitionEffective("4ème", null).format).toBe("points");
  });

  it("lit les lignes dans la table competences, dans l'ordre, sinon dans le JSON stocké", () => {
    const stocke = [
      { code: "ARABE", libelle: "Arabe", lignes: ["ancienne"] },
      { code: "MATHS", libelle: "Maths", lignes: ["m"] },
    ];
    const def = definitionEffective("1ère", stocke, [
      { domaine: "ARABE", ordre: 1, libelle: "B" },
      { domaine: "ARABE", ordre: 0, libelle: "A" },
    ]);
    expect(def.domaines.find((d) => d.code === "ARABE")?.lignes).toEqual(["A", "B"]);
    expect(def.domaines.find((d) => d.code === "MATHS")?.lignes).toEqual(["m"]);
  });
});
