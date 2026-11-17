import { describe, expect, it } from "vitest";
import { formaterDateNaissance, genererCarnetHtml, suffixeClasse } from "./html";
import { CARNETS } from "./modeles.fixture";

describe("genererCarnetHtml", () => {
  it("rend les colonnes A / EVA / NA des niveaux 1ère et 2ème", () => {
    const html = genererCarnetHtml({
      ecole: "École MIRIAM",
      annee: "2026-2027",
      niveau: "1ère",
      definition: CARNETS["1ère"],
      eleve: { nom: "Ali", prenom: "Osman", matricule: "CEM029" },
      saisie: { "1": { competences: { "ARABE.0": "A" }, note: 8 } },
    });
    expect(html).toContain("CARNET DE LA 1<sup>ère</sup> ANNEE");
    expect(html).toContain("Module 4");
    expect(html).toContain("COMPETENCE DE LANGUE EN ARABE");
    expect(html).toContain("7 à 10");
    expect(html).toContain("/carnet/couverture-1ere.jpg");
    // Une seule évaluation cochée : la case A du module 1.
    expect(html.match(/✓/g)).toHaveLength(1);
  });

  it("reprend les intitulés et la numérotation des modèles au format points", () => {
    const html = genererCarnetHtml({
      ecole: "École MIRIAM",
      annee: "2026-2027",
      niveau: "4ème",
      definition: CARNETS["4ème"],
      eleve: { nom: "Ali", prenom: "Osman", matricule: "X" },
      saisie: { "1": { domaines: { MATHS: 33 } } },
    });
    expect(html).toContain("I–COMPÉTENCES DE BASE : FRANÇAIS / 40");
    expect(html).toContain("IV–COMPÉTENCES DE BASE : MATHEMATIQUES / 40");
    expect(html).toContain("X–COMPÉTENCES DE BASE : TICE / 10");
    expect(html).toContain("IMATRICULE");
    expect(html).toContain("<b>CB1/Numération:</b>");
  });

  it("affiche le barème des domaines au format points", () => {
    const html = genererCarnetHtml({
      ecole: "École MIRIAM",
      annee: "2026-2027",
      niveau: "3ème",
      definition: CARNETS["3ème"],
      eleve: { nom: "Ali", prenom: "Osman", matricule: "X" },
      saisie: { "1": { domaines: { FRANCAIS: 30 } } },
    });
    expect(html).toContain("/ 40");
    expect(html).toContain("Total des barèmes : /200");
  });

  it("échappe les saisies libres", () => {
    const html = genererCarnetHtml({
      ecole: "<script>",
      annee: "2026-2027",
      niveau: "5ème",
      definition: CARNETS["5ème"],
      eleve: { nom: "<b>x</b>", prenom: "", matricule: "" },
      saisie: {},
      appreciations: "<img onerror=alert(1)>",
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img onerror");
    expect(html).toContain("&lt;img onerror");
  });
});

describe("mise en page sur 2 pages", () => {
  it("place la carte d'identité sur la page 1, sous la couverture, et ne crée qu'une feuille avant les compétences", () => {
    const html = genererCarnetHtml({
      ecole: "École MIRIAM",
      annee: "2026-2027",
      niveau: "3ème",
      definition: CARNETS["3ème"],
      eleve: { nom: "Ali", prenom: "Osman", matricule: "X" },
      saisie: {},
    });
    // Page 1 : dos + couverture (avec la carte) ; page 2 : compétences. Plus de feuille « carte » seule.
    expect(html.match(/class="feuille"/g)).toHaveLength(1);
    expect(html.match(/class="interieur"/g)).toHaveLength(1);
    const couverture = html.slice(html.indexOf('class="volet couverture'));
    expect(couverture.indexOf('class="carte')).toBeGreaterThan(couverture.indexOf('class="vignette'));
    expect(couverture).toContain("ENSEIGNEMENT FONDAMENTAL (ECOLE DE BASE)");
  });
});

describe("carte d'identité dynamique", () => {
  const base = {
    ecole: "Ecole privée MIRIAM",
    annee: "2026-2027",
    niveau: "1ère" as const,
    definition: CARNETS["1ère"],
    saisie: {},
  };

  it("imprime l'élève, la naissance, la classe, le site, l'enseignant et la directrice", () => {
    const html = genererCarnetHtml({
      ...base,
      site: "Site Balbala",
      eleve: {
        nom: "HARED",
        prenom: "Zeinab",
        matricule: "CEM036",
        dateNaissance: new Date("2018-03-09T00:00:00.000Z"),
        lieuNaissance: "Djibouti",
      },
      classe: "1ère B",
      enseignant: "Fatouma Ali",
      directrice: "Mouna Mohamed Abdi",
    });
    expect(html).toContain("Ecole privée MIRIAM : <span class=\"rempli\">Site Balbala</span>");
    expect(html).toContain("HARED Zeinab");
    expect(html).toContain("09/03/2018");
    expect(html).toContain("Djibouti");
    expect(html).toContain(">/B</span>");
    expect(html).toContain("Fatouma Ali");
    expect(html).toContain("Mouna Mohamed Abdi");
    expect(html).toContain("Année Scolaire2026 /2027");
  });

  it("garde les pointillés quand une information manque, sans nom de directrice par défaut", () => {
    const html = genererCarnetHtml({ ...base, eleve: { nom: "A", prenom: "B", matricule: "C" } });
    expect(html).toContain("Site …");
    expect(html).toContain("/……");
    expect(html).not.toContain("MOUNA");
  });

  it("échappe les champs de la carte et affiche le cachet de la direction", () => {
    const html = genererCarnetHtml({
      ...base,
      eleve: { nom: "A", prenom: "B", matricule: "C", lieuNaissance: "<i>x</i>" },
      enseignant: "<b>y</b>",
      cachetUrl: "https://exemple.test/cachet.png",
    });
    expect(html).not.toContain("<i>x</i>");
    expect(html).not.toContain("<b>y</b>");
    expect(html).toContain('<img class="cachet" src="https://exemple.test/cachet.png"');
  });
});

describe("suffixeClasse", () => {
  it.each([
    ["1ère", "1ère A", true, "A"],
    ["1ère", "1ere  année B", true, "B"],
    ["2ème", "2ème-C", true, "C"],
    ["3ème", "3ème", true, ""],
    ["1ère", "Les Étoiles", false, ""],
    ["1ère", "11ème A", false, ""],
  ] as const)("%s / %s", (niveau, classe, commence, suffixe) => {
    expect(suffixeClasse(niveau, classe)).toEqual({ commenceParNiveau: commence, suffixe });
  });
});

describe("formaterDateNaissance", () => {
  it("formate en jj/mm/aaaa sans reculer d'un jour", () => {
    expect(formaterDateNaissance("2018-03-09T00:00:00.000Z")).toBe("09/03/2018");
  });
  it("renvoie une chaîne vide si la date est absente ou invalide", () => {
    expect(formaterDateNaissance(null)).toBe("");
    expect(formaterDateNaissance("pas une date")).toBe("");
  });
});

describe("page de compétences", () => {
  it("est un bloc d'une page, réductible, sans règle de page nommée", () => {
    const html = genererCarnetHtml({
      ecole: "E",
      annee: "2026-2027",
      niveau: "3ème",
      definition: CARNETS["3ème"],
      eleve: { nom: "A", prenom: "B", matricule: "C" },
      saisie: {},
    });
    expect(html).toContain('class="interieur-contenu');
    expect(html).not.toContain("@page interieur");
    expect(html).not.toContain("<script");
  });
});
