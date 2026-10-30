import { describe, it, expect } from "vitest";
import { decouperEnTrimestres } from "@/lib/annee-periodes";

describe("decouperEnTrimestres", () => {
  const debut = new Date("2025-09-01T00:00:00Z");
  const fin = new Date("2026-06-30T00:00:00Z");
  const p = decouperEnTrimestres(debut, fin);

  it("crée trois trimestres numérotés", () => {
    expect(p.map((x) => x.nom)).toEqual(["Trimestre 1", "Trimestre 2", "Trimestre 3"]);
    expect(p.map((x) => x.numero)).toEqual([1, 2, 3]);
  });

  it("couvre l'année sans trou ni chevauchement", () => {
    expect(p[0].dateDebut).toEqual(debut);
    expect(p[2].dateFin).toEqual(fin);
    for (let i = 0; i < 3; i++) expect(p[i].dateFin.getTime()).toBeGreaterThan(p[i].dateDebut.getTime());
    expect(p[1].dateDebut.getTime()).toBeGreaterThan(p[0].dateFin.getTime());
    expect(p[2].dateDebut.getTime()).toBeGreaterThan(p[1].dateFin.getTime());
  });
});
