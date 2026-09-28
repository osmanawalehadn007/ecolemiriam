import { describe, it, expect } from "vitest";
import { libelleMensualite, libellesMensualite, MOIS_NOMS } from "@/lib/factures/mensualites";

/**
 * Le libellé du mois est la clé d'idempotence de la facturation : il doit être
 * stable et reconnaître l'ancienne convention (« Scolarité Septembre 2026 »)
 * autant que la nouvelle (« Scolarité Septembre 2026-2027 »). Sans cela, un
 * second passage du cron créait une deuxième facture pour le même mois.
 */
describe("libellesMensualite", () => {
  it("produit le libellé complet puis l'ancien format en repli", () => {
    expect(libellesMensualite(9, "2026-2027")).toEqual([
      "Scolarité Septembre 2026-2027",
      "Scolarité Septembre 2026",
    ]);
  });

  it("ne duplique pas le libellé si l'année n'a qu'un millésime", () => {
    expect(libellesMensualite(9, "2026")).toEqual(["Scolarité Septembre 2026"]);
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
