import { describe, expect, it } from "vitest";
import { genererCarnetHtml } from "./html";

describe("genererCarnetHtml", () => {
  it("rend les colonnes A / EVA / NA des niveaux 1ère et 2ème", () => {
    const html = genererCarnetHtml({
      ecole: "École MIRIAM",
      annee: "2026-2027",
      niveau: "1ère",
      eleve: { nom: "Ali", prenom: "Osman", matricule: "CEM029" },
      saisie: { "1": { competences: { "ARABE.0": "A" }, note: 8 } },
    });
    expect(html).toContain("CARNET DE LA 1ère ANNÉE");
    expect(html).toContain("Module 4");
    expect(html).toContain("Acquis 7 à 10");
  });

  it("affiche le barème des domaines au format points", () => {
    const html = genererCarnetHtml({
      ecole: "École MIRIAM",
      annee: "2026-2027",
      niveau: "3ème",
      eleve: { nom: "Ali", prenom: "Osman", matricule: "X" },
      saisie: { "1": { domaines: { FRANCAIS: 30 } } },
    });
    expect(html).toContain("/40");
    expect(html).toContain("Total des barèmes : /200");
  });

  it("échappe les saisies libres", () => {
    const html = genererCarnetHtml({
      ecole: "<script>",
      annee: "2026-2027",
      niveau: "5ème",
      eleve: { nom: "<b>x</b>", prenom: "", matricule: "" },
      saisie: {},
      appreciations: "<img onerror=alert(1)>",
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img onerror");
    expect(html).toContain("&lt;img onerror");
  });
});
