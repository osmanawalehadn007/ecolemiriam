import { describe, expect, it } from "vitest";
import { definitionEffective, validerDomaines } from "./configuration";
import { CARNETS, baremeTotal } from "./referentiel";
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
  it("retombe sur le modèle par défaut sans personnalisation ou si elle est invalide", () => {
    expect(definitionEffective("4ème", null)).toBe(CARNETS["4ème"]);
    expect(definitionEffective("4ème", [{ code: "x" }])).toBe(CARNETS["4ème"]);
  });

  it("applique une personnalisation valide et recalcule la note sur le nouveau barème", () => {
    const definition = definitionEffective("3ème", [domaine("FRANCAIS", 30), domaine("MATHS", 20)]);
    expect(baremeTotal(definition)).toBe(50);
    // 25 points sur 50 → 5/10 ; un domaine retiré (ARABE) est ignoré
    expect(noteModulePoints(definition, { FRANCAIS: 15, MATHS: 10, ARABE: 20 })).toBe(5);
  });
});
