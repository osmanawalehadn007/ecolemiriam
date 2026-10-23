import { describe, it, expect } from "vitest";

describe("formatDateHeure / formatHeure (heure de Djibouti)", () => {
  it("affiche l'instant à UTC+3, quel que soit le fuseau du serveur", async () => {
    const { formatDateHeure, formatHeure } = await import("./utils");
    expect(formatHeure("2026-10-05T11:32:07Z")).toBe("14:32:07");
    expect(formatDateHeure("2026-10-05T22:30:00Z")).toBe("06/10/2026 01:30:00");
  });
});

describe("demiJournee (bascule à 13 h, heure de Djibouti)", () => {
  it("classe matin avant 13 h et après-midi à partir de 13 h", async () => {
    const { demiJournee } = await import("./utils");
    expect(demiJournee("2026-10-05T09:59:59Z")).toBe("matin"); // 12:59:59 à Djibouti
    expect(demiJournee("2026-10-05T10:00:00Z")).toBe("apres_midi"); // 13:00:00
    expect(demiJournee("2026-10-05T02:00:00Z")).toBe("matin"); // 05:00
    expect(demiJournee("2026-10-05T21:30:00Z")).toBe("matin"); // 00:30 le lendemain
  });
});
