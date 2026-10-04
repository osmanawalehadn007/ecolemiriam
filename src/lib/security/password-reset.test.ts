import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests unitaires pour la réinitialisation de mot de passe par lien.
 *
 * Valide qu'après une réinitialisation réussie le compte est réellement
 * utilisable : email marqué vérifié et obligation de changement levée.
 */

vi.mock("@/lib/prisma-base", () => ({
  default: {
    verificationToken: {
      deleteMany: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/notifications/email", () => ({
  sendEmail: vi.fn(),
}));

// Importer après les mocks
import { resetPasswordWithToken } from "./password-reset";
import prismaBase from "@/lib/prisma-base";

const mockedPrisma = vi.mocked(prismaBase);

const TOKEN = "a".repeat(64);
const MOT_DE_PASSE = "Nouveau-Passe-2026";

function tokenValide() {
  mockedPrisma.verificationToken.findUnique.mockResolvedValue({
    identifier: "reset-password:test@example.com",
    token: TOKEN,
    expires: new Date(Date.now() + 60_000),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resetPasswordWithToken", () => {
  it("marque l'email vérifié et lève l'obligation de changement", async () => {
    tokenValide();
    mockedPrisma.user.findFirst.mockResolvedValue({
      id: "u1",
      isActive: true,
      emailVerified: null,
    } as never);

    const result = await resetPasswordWithToken(TOKEN, MOT_DE_PASSE);

    expect(result).toEqual({ success: true, email: "test@example.com" });
    const data = mockedPrisma.user.update.mock.calls[0][0].data;
    expect(data.mustChangePassword).toBe(false);
    expect(data.emailVerified).toBeInstanceOf(Date);
    expect(data.password).not.toBe(MOT_DE_PASSE);
    expect(mockedPrisma.verificationToken.deleteMany).toHaveBeenCalledTimes(1);
  });

  it("ne réécrit pas une date de vérification existante", async () => {
    tokenValide();
    mockedPrisma.user.findFirst.mockResolvedValue({
      id: "u1",
      isActive: true,
      emailVerified: new Date("2026-01-01"),
    } as never);

    await resetPasswordWithToken(TOKEN, MOT_DE_PASSE);

    const data = mockedPrisma.user.update.mock.calls[0][0].data;
    expect("emailVerified" in data).toBe(false);
  });

  it("refuse un token expiré sans toucher au compte", async () => {
    mockedPrisma.verificationToken.findUnique.mockResolvedValue({
      identifier: "reset-password:test@example.com",
      token: TOKEN,
      expires: new Date(Date.now() - 60_000),
    });

    const result = await resetPasswordWithToken(TOKEN, MOT_DE_PASSE);

    expect(result.success).toBe(false);
    expect(mockedPrisma.user.update).not.toHaveBeenCalled();
  });
});
