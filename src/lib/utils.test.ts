import { describe, it, expect } from "vitest";

describe("formatDateHeure / formatHeure (heure de Djibouti)", () => {
  it("affiche l'instant à UTC+3, quel que soit le fuseau du serveur", async () => {
    const { formatDateHeure, formatHeure } = await import("./utils");
    expect(formatHeure("2026-10-05T11:32:07Z")).toBe("14:32:07");
    expect(formatDateHeure("2026-10-05T22:30:00Z")).toBe("06/10/2026 01:30:00");
  });
});
