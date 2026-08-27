import { describe, it, expect } from "vitest";
import {
  isMoisScolariteValide,
  formatMoisScolarite,
  moisScolariteDefaut,
  optionsMoisScolarite,
} from "@/lib/admissions/mois-scolarite";

describe("mois-scolarite", () => {
  describe("isMoisScolariteValide", () => {
    it("accepte le format YYYY-MM valide", () => {
      expect(isMoisScolariteValide("2026-09")).toBe(true);
      expect(isMoisScolariteValide("2026-01")).toBe(true);
      expect(isMoisScolariteValide("2026-12")).toBe(true);
    });
    it("rejette les valeurs invalides", () => {
      expect(isMoisScolariteValide("2026-00")).toBe(false);
      expect(isMoisScolariteValide("2026-13")).toBe(false);
      expect(isMoisScolariteValide("2026-9")).toBe(false);
      expect(isMoisScolariteValide("septembre")).toBe(false);
      expect(isMoisScolariteValide("")).toBe(false);
    });
  });

  describe("formatMoisScolarite", () => {
    it("formate en mois français + année", () => {
      expect(formatMoisScolarite("2026-09")).toBe("Septembre 2026");
      expect(formatMoisScolarite("2027-01")).toBe("Janvier 2027");
    });
    it("renvoie la chaîne brute si invalide", () => {
      expect(formatMoisScolarite("bogus")).toBe("bogus");
    });
  });

  describe("moisScolariteDefaut", () => {
    it("propose septembre en août (rentrée)", () => {
      expect(moisScolariteDefaut(new Date(2026, 7, 15))).toBe("2026-09");
    });
    it("propose septembre en septembre", () => {
      expect(moisScolariteDefaut(new Date(2026, 8, 10))).toBe("2026-09");
    });
    it("propose le mois en cours après septembre", () => {
      expect(moisScolariteDefaut(new Date(2026, 9, 3))).toBe("2026-10");
      expect(moisScolariteDefaut(new Date(2027, 0, 20))).toBe("2027-01");
    });
    it("propose le mois en cours avant la rentrée (janvier-juillet)", () => {
      expect(moisScolariteDefaut(new Date(2026, 2, 5))).toBe("2026-03");
    });
  });

  describe("optionsMoisScolarite", () => {
    it("génère 12 mois consécutifs à partir de septembre", () => {
      const opts = optionsMoisScolarite(new Date(2026, 9, 1)); // octobre 2026
      expect(opts).toHaveLength(12);
      expect(opts[0]).toEqual({ value: "2026-09", label: "Septembre 2026" });
      expect(opts[4]).toEqual({ value: "2027-01", label: "Janvier 2027" });
      expect(opts[11]).toEqual({ value: "2027-08", label: "Août 2027" });
    });
    it("rattache janvier à l'année scolaire commencée en septembre précédent", () => {
      const opts = optionsMoisScolarite(new Date(2027, 0, 15)); // janvier 2027
      expect(opts[0]).toEqual({ value: "2026-09", label: "Septembre 2026" });
    });
    it("le défaut fait partie des options proposées", () => {
      const now = new Date(2026, 10, 2); // novembre 2026
      const defaut = moisScolariteDefaut(now);
      const values = optionsMoisScolarite(now).map((o) => o.value);
      expect(values).toContain(defaut);
    });
  });
});
