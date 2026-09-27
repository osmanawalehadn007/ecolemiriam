import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: { $queryRaw: vi.fn() },
}));

import prisma from "@/lib/prisma";
import { formatNumeroFacture, reserverNumeroFacture, reserverNumerosFacture } from "@/lib/facture-numero";

const mockQueryRaw = (prisma as unknown as { $queryRaw: ReturnType<typeof vi.fn> }).$queryRaw;

describe("facture-numero", () => {
  beforeEach(() => vi.clearAllMocks());

  it("formate sur 5 chiffres", () => {
    expect(formatNumeroFacture("2026", 7)).toBe("FAC-2026-00007");
    expect(formatNumeroFacture(2026, 123456)).toBe("FAC-2026-123456");
  });

  it("réserve un bloc contigu à partir du premier numéro renvoyé par la base", async () => {
    mockQueryRaw.mockResolvedValue([{ premier: 251 }]);
    const numeros = await reserverNumerosFacture("t1", "2026", 3);
    expect(numeros).toEqual(["FAC-2026-00251", "FAC-2026-00252", "FAC-2026-00253"]);
    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
    const [strings, ...values] = mockQueryRaw.mock.calls[0];
    expect(strings.join("?")).toContain("next_facture_numeros");
    expect(values).toEqual(["t1", "2026", 3]);
  });

  it("n'appelle pas la base quand rien n'est à numéroter", async () => {
    expect(await reserverNumerosFacture("t1", "2026", 0)).toEqual([]);
    expect(mockQueryRaw).not.toHaveBeenCalled();
  });

  it("utilise le client de transaction fourni", async () => {
    const tx = { $queryRaw: vi.fn().mockResolvedValue([{ premier: 1 }]) };
    expect(await reserverNumeroFacture("t1", 2027, tx as never)).toBe("FAC-2027-00001");
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(mockQueryRaw).not.toHaveBeenCalled();
  });

  it("échoue plutôt que d'émettre un numéro invalide", async () => {
    mockQueryRaw.mockResolvedValue([]);
    await expect(reserverNumeroFacture("t1", "2026")).rejects.toThrow("Numérotation des factures indisponible");
  });
});
