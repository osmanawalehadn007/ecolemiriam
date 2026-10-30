import { describe, it, expect } from "vitest";
import { construireRapports, resteDu, bornesAnneeScolaire, type FactureImpayee } from "./impayes";
import { genererPdfImpayes } from "./impayes-pdf";

const prim = { id: "st-prim", nom: "Primaire", type: "PRIMAIRE" };
const coll = { id: "st-coll", nom: "Collège", type: "COLLEGE" };

function facture(over: Partial<FactureImpayee> & { eleveId: string; nom?: string; classe?: FactureImpayee["eleve"]["classe"]; siteId?: string | null }): FactureImpayee {
  return {
    montant: 10000,
    mois: "2026-10",
    siteId: over.siteId ?? "s1",
    paiements: [],
    ...over,
    eleve: {
      id: over.eleveId,
      nom: over.nom ?? "Diallo",
      prenom: "Awa",
      matricule: `M-${over.eleveId}`,
      siteId: over.siteId === undefined ? "s1" : over.siteId,
      classe: over.classe === undefined ? { id: "c1", nom: "CM2 A", niveau: "CM2", structure: prim } : over.classe,
    },
  };
}

const site1 = (r: ReturnType<typeof construireRapports>) => r.find((x) => x.siteId === "s1")!;
const sites = [{ id: "s1", nom: "Campus Central" }, { id: "s2", nom: "Annexe PK12" }];

describe("resteDu", () => {
  it("déduit les paiements nets et ne descend jamais sous zéro", () => {
    expect(resteDu(10000, [4000])).toBe(6000);
    expect(resteDu(10000, [10000, 500])).toBe(0);
    expect(resteDu(10000, [10000, -10000])).toBe(10000); // contre-passation
  });
});

describe("bornesAnneeScolaire", () => {
  it("bascule en septembre", () => {
    expect(bornesAnneeScolaire(2026, 10)).toEqual({ debut: "2026-09", fin: "2027-08" });
    expect(bornesAnneeScolaire(2027, 3)).toEqual({ debut: "2026-09", fin: "2027-08" });
  });
});

describe("construireRapports", () => {
  it("sépare mois courant et cumul annuel, par élève", () => {
    const r = construireRapports(
      [
        facture({ eleveId: "e1", mois: "2026-09" }),
        facture({ eleveId: "e1", mois: "2026-10", paiements: [2500] }),
      ],
      sites,
      "2026-10",
    );
    const e = site1(r).structures[0].classes[0].eleves[0];
    expect(e.resteMois).toBe(7500);
    expect(e.resteAnnee).toBe(17500);
    expect(e.classe).toBe("CM2 A");
  });

  it("garde l'élève qui doit seulement un mois passé, avec 0 pour le mois courant", () => {
    const r = construireRapports([facture({ eleveId: "e1", mois: "2026-09" })], sites, "2026-10");
    const e = site1(r).structures[0].classes[0].eleves[0];
    expect(e.resteMois).toBe(0);
    expect(e.resteAnnee).toBe(10000);
  });

  it("ignore une facture entièrement réglée", () => {
    const r = construireRapports([facture({ eleveId: "e1", paiements: [10000] })], sites, "2026-10");
    expect(site1(r).nbEleves).toBe(0);
  });

  it("produit un rapport par site, même vide, triés par nom", () => {
    const r = construireRapports([facture({ eleveId: "e1", siteId: "s2" })], sites, "2026-10");
    expect(r.map((x) => [x.siteNom, x.nbEleves])).toEqual([["Annexe PK12", 1], ["Campus Central", 0]]);
  });

  it("ordonne les structures (Primaire avant Collège) puis classes et élèves", () => {
    const r = construireRapports(
      [
        facture({ eleveId: "e1", nom: "Zeid", classe: { id: "c3", nom: "6ème1", niveau: "6ème", structure: coll } }),
        facture({ eleveId: "e2", nom: "Omar", classe: { id: "c2", nom: "CM2 B", niveau: "CM2", structure: prim } }),
        facture({ eleveId: "e3", nom: "Ali" }),
        facture({ eleveId: "e4", nom: "Abdi" }),
      ],
      sites,
      "2026-10",
    );
    const s1 = site1(r);
    expect(s1.structures.map((s) => s.nom)).toEqual(["Primaire", "Collège"]);
    expect(s1.structures[0].classes.map((c) => c.nom)).toEqual(["CM2 A", "CM2 B"]);
    expect(s1.structures[0].classes[0].eleves.map((e) => e.nom)).toEqual(["Abdi", "Ali"]);
    expect(s1.structures[0].classes[0].eleves[0].classe).toBe("CM2 A");
    expect(s1.structures[0].classes[1].eleves[0].classe).toBe("CM2 B");
    expect(s1.totalAnnee).toBe(40000);
  });

  it("range les élèves sans classe ou sans site à part", () => {
    const r = construireRapports(
      [facture({ eleveId: "e1", classe: null }), facture({ eleveId: "e2", siteId: null })],
      sites,
      "2026-10",
    );
    expect(r.find((x) => x.siteId === "s1")!.structures[0].nom).toBe("Sans structure");
    expect(r[r.length - 1].siteNom).toBe("Sans site");
    // L'élève sans classe a classe === null, l'élève sans site mais avec classe garde sa classe
    const r2 = construireRapports([facture({ eleveId: "e5", classe: null })], sites, "2026-10");
    expect(r2.find((x) => x.siteId === "s1")!.structures[0].classes[0].eleves[0].classe).toBeNull();
  });
});

describe("genererPdfImpayes", () => {
  it("produit un PDF valide, même avec des caractères hors Latin-1 et beaucoup de lignes", async () => {
    const factures = Array.from({ length: 120 }, (_, i) => facture({ eleveId: `e${i}`, nom: i === 0 ? "محمد" : `Nom${i}` }));
    const [rapport] = construireRapports(factures, sites, "2026-10");
    const pdf = await genererPdfImpayes({ ecole: "École Miriam", rapport, annee: 2026, mois: 10, genereLe: new Date() });
    expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe("%PDF-");
    const vide = await genererPdfImpayes({ ecole: "École Miriam", rapport: construireRapports([], sites, "2026-10")[0], annee: 2026, mois: 10, genereLe: new Date() });
    expect(vide.length).toBeGreaterThan(500);
  });
});
