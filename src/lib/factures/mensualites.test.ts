import { describe, it, expect } from "vitest";
import { echeanceMensualite, libelleMensualite, libellesMensualite, MOIS_NOMS } from "@/lib/factures/mensualites";

/**
 * Le libellé du mois est la clé d'idempotence de la facturation : il doit être
 * stable et reconnaître l'ancienne convention (« Scolarité Septembre 2026 »)
 * autant que la nouvelle (« Scolarité Septembre 2026-2027 »). Sans cela, un
 * second passage du cron créait une deuxième facture pour le même mois.
 */
describe("libellesMensualite", () => {
  it("produit le libellé complet puis l'ancien format en repli", () => {
    // Les deux premières entrées sont les libellés de base (index 0 = celui
    // écrit par le cœur) ; les suivantes sont les variantes enrichies des
    // frais de rentrée, reconnues pour le dédoublonnage.
    expect(libellesMensualite(9, "2026-2027").slice(0, 2)).toEqual([
      "Scolarité Septembre 2026-2027",
      "Scolarité Septembre 2026",
    ]);
  });

  it("reconnaît les variantes « + Frais … » (écrites par l'écran ou l'ancien moteur)", () => {
    const libelles = libellesMensualite(9, "2026-2027");

    expect(libelles).toContain("Scolarité Septembre 2026 + Frais de réinscription");
    expect(libelles).toContain("Scolarité Septembre 2026-2027 + Frais d'inscription");
    expect(libelles).toContain(
      "Scolarité Septembre 2026-2027 + Frais d'inscription + Frais de réinscription"
    );
    expect(new Set(libelles).size).toBe(libelles.length);
  });

  it("ne duplique pas le libellé si l'année n'a qu'un millésime", () => {
    expect(libellesMensualite(9, "2026").slice(0, 1)).toEqual(["Scolarité Septembre 2026"]);
  });

  it("couvre les 12 mois de l'année", () => {
    expect(MOIS_NOMS).toHaveLength(12);
    expect(libelleMensualite(1, "2026-2027")).toBe("Scolarité Janvier 2026-2027");
    expect(libelleMensualite(12, "2026-2027")).toBe("Scolarité Décembre 2026-2027");
  });

  it("tolère un mois hors bornes sans casser le libellé", () => {
    expect(libelleMensualite(13, "2026-2027")).toBe("Scolarité Mois 13 2026-2027");
  });
});

describe("echeanceMensualite", () => {
  it("tombe le 10 du mois facturé", () => {
    expect(echeanceMensualite(9, "2026")).toEqual(new Date(2026, 8, 10));
    expect(echeanceMensualite(1, "2027")).toEqual(new Date(2027, 0, 10));
  });
  it("place septembre-décembre dans la 1re année scolaire, janvier-août dans la 2e", () => {
    expect(echeanceMensualite(9, "2026-2027")).toEqual(new Date(2026, 8, 10));
    expect(echeanceMensualite(12, "2026-2027")).toEqual(new Date(2026, 11, 10));
    expect(echeanceMensualite(1, "2026-2027")).toEqual(new Date(2027, 0, 10));
    expect(echeanceMensualite(6, "2026-2027")).toEqual(new Date(2027, 5, 10));
  });
});
