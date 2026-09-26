import { describe, it, expect } from "vitest";
import { cleNiveau, choisirTarif, montantPourTypeFrais, montantMensuel, type TarifLike } from "@/lib/tarifs";

/**
 * Le libellé de niveau est saisi librement côté classes ET côté tarifs. Ces
 * tests figent les écritures réellement présentes en base pour qu'une
 * divergence de saisie ne puisse plus faire échouer silencieusement la
 * facturation (cas du site 01 : classes en `niveau = "1"` face au tarif
 * `"1ère"`).
 */
describe("cleNiveau", () => {
  it("ramène toutes les écritures de la 1ère année à la même clé", () => {
    const cles = ["1", "1er", "1ere", "1ère", "1ère année", "1ère A", "Classe de 1ère"].map(cleNiveau);
    expect(new Set(cles).size).toBe(1);
    expect(cles[0]).toBe("an1");
  });

  it("ramène les niveaux numérotés du collège à `anN`", () => {
    expect(cleNiveau("2")).toBe("an2");
    expect(cleNiveau("2ème")).toBe("an2");
    expect(cleNiveau("3e")).toBe("an3");
    expect(cleNiveau("6ème")).toBe("an6");
    expect(cleNiveau("9ème")).toBe("an9");
    expect(cleNiveau("7eme année")).toBe("an7");
  });

  it("distingue « Première » (lycée) de « 1ère » (1ère année)", () => {
    expect(cleNiveau("Première")).toBe("premiere");
    expect(cleNiveau("1ère")).toBe("an1");
    expect(cleNiveau("Première")).not.toBe(cleNiveau("1ère"));
  });

  it("reconnaît le lycée et la maternelle", () => {
    expect(cleNiveau("Seconde")).toBe("seconde");
    expect(cleNiveau("2nde")).toBe("seconde");
    expect(cleNiveau("Terminale")).toBe("terminale");
    expect(cleNiveau("Tle")).toBe("terminale");
    expect(cleNiveau("Maternelle")).toBe("maternelle");
  });

  it("renvoie null pour un niveau vide ou inexploitable", () => {
    expect(cleNiveau(null)).toBeNull();
    expect(cleNiveau("")).toBeNull();
    expect(cleNiveau("   ")).toBeNull();
    expect(cleNiveau("Inconnu")).toBeNull();
  });
});

const tarif = (over: Partial<TarifLike> = {}): TarifLike => ({
  niveau: "1ère",
  siteId: null,
  mensualite: 7000,
  fraisInscription: 2000,
  fraisRenouvellement: 2000,
  fraisCantine: null,
  fraisTransport: null,
  devise: "DJF",
  nbMois: 10,
  actif: true,
  ...over,
});

describe("choisirTarif", () => {
  const global1ere = tarif();
  const site02_1ere = tarif({ siteId: "site02", mensualite: 6000 });
  const site02_1ereInactif = tarif({ siteId: "site02", mensualite: 1000, actif: false });

  it("applique le tarif du site à un élève de ce site (exemple SITE-02 = 6000)", () => {
    const choix = choisirTarif([global1ere, site02_1ere], "site02", "1ère");
    expect(choix?.tarif.mensualite).toBe(6000);
    expect(choix?.source).toBe("SITE");
  });

  it("hérite du tarif global quand le site n'a pas de tarif propre", () => {
    const choix = choisirTarif([global1ere, site02_1ere], "site01", "1ère");
    expect(choix?.tarif.mensualite).toBe(7000);
    expect(choix?.source).toBe("GLOBAL");
  });

  it("fait correspondre `niveau = \"1\"` (site 01) au tarif global « 1ère »", () => {
    const choix = choisirTarif([global1ere, site02_1ere], "site01", "1");
    expect(choix?.tarif.mensualite).toBe(7000);
  });

  it("n'utilise jamais le tarif d'un autre site", () => {
    const choix = choisirTarif([site02_1ere], "site01", "1ère");
    expect(choix).toBeNull();
  });

  it("ignore un tarif de site désactivé et retombe sur le global", () => {
    const choix = choisirTarif([global1ere, site02_1ereInactif], "site02", "1ère");
    expect(choix?.tarif.mensualite).toBe(7000);
    expect(choix?.source).toBe("GLOBAL");
  });

  it("renvoie null quand aucun niveau ne correspond (site 01 « 2ème » sans tarif)", () => {
    expect(choisirTarif([global1ere], "site01", "2")).toBeNull();
  });
});

describe("montantPourTypeFrais", () => {
  it("sélectionne la mensualité, l'inscription ou le renouvellement", () => {
    const t = tarif({ mensualite: 12000, fraisInscription: 2500, fraisRenouvellement: 2500 });
    expect(montantPourTypeFrais(t, "MENSUALITE")).toBe(12000);
    expect(montantPourTypeFrais(t, "INSCRIPTION")).toBe(2500);
    expect(montantPourTypeFrais(t, "RENOUVELLEMENT")).toBe(2500);
  });
});

describe("montantMensuel", () => {
  it("ajoute la cantine et le transport quand ils sont demandés", () => {
    const t = tarif({ mensualite: 7000, fraisCantine: 1500, fraisTransport: 2000 });
    expect(montantMensuel(t)).toBe(7000);
    expect(montantMensuel(t, { cantine: true })).toBe(8500);
    expect(montantMensuel(t, { cantine: true, transport: true })).toBe(10500);
  });
});
