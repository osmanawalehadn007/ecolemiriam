import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests unitaires pour la vérification d'email.
 *
 * Valide :
 * - La génération de tokens (longueur, format hex)
 * - La validation des tokens (invalide, expiré, valide)
 * - L'envoi d'email de vérification (succès, échec, simulation)
 * - La vérification du statut emailVerified
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
import { sendVerificationEmail, verifyEmailToken, isEmailVerified } from "./email-verification";
import prismaBase from "@/lib/prisma-base";
import { sendEmail } from "@/lib/notifications/email";

const mockedSendEmail = vi.mocked(sendEmail);
const mockedPrisma = vi.mocked(prismaBase);

beforeEach(() => {
  vi.clearAllMocks();
  mockedSendEmail.mockResolvedValue({ success: true, sent: 1 });
});

describe("sendVerificationEmail", () => {
  it("génère un token, le persiste et envoie l'email", async () => {
    const result = await sendVerificationEmail("test@example.com", "Test User", "Mon École");

    expect(result.success).toBe(true);
    expect(result.token).toBeDefined();
    expect(result.token).toHaveLength(64); // 32 bytes * 2 (hex)
    expect(mockedPrisma.verificationToken.deleteMany).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.verificationToken.create).toHaveBeenCalledTimes(1);
    expect(mockedSendEmail).toHaveBeenCalledTimes(1);

    // Vérifier que sendEmail reçoit html ET text
    const callArgs = mockedSendEmail.mock.calls[0];
    expect(callArgs[0]).toEqual(["test@example.com"]); // to
    expect(callArgs[1]).toContain("Vérifiez"); // subject
    expect(callArgs[2]).toContain("<html"); // html
    expect(callArgs[3]).toContain("Mon École"); // text
    expect(callArgs[3]).not.toContain("<"); // text ne doit pas contenir de HTML
  });

  it("avec force=true, supprime tous les tokens existants", async () => {
    await sendVerificationEmail("test@example.com", "Test User", undefined, true);

    const deleteCall = mockedPrisma.verificationToken.deleteMany.mock.calls[0];
    expect(deleteCall[0]).toEqual({ where: { identifier: "test@example.com" } });
  });

  it("avec force=false, ne supprime que les tokens expirés", async () => {
    await sendVerificationEmail("test@example.com", "Test User", undefined, false);

    const deleteCall = mockedPrisma.verificationToken.deleteMany.mock.calls[0];
    expect(deleteCall[0].where.identifier).toBe("test@example.com");
    expect(deleteCall[0].where.expires).toBeDefined();
  });

  it("retourne une erreur si sendEmail échoue", async () => {
    mockedSendEmail.mockResolvedValue({ success: false, sent: 0, error: "SMTP error" });

    const result = await sendVerificationEmail("test@example.com", "Test User");

    expect(result.success).toBe(false);
    expect(result.error).toBe("SMTP error");
  });
});

describe("verifyEmailToken", () => {
  it("rejette un token trop court", async () => {
    const result = await verifyEmailToken("short");
    expect(result.success).toBe(false);
    expect(result.error).toBe("Token invalide");
  });

  it("rejette un token introuvable", async () => {
    mockedPrisma.verificationToken.findUnique.mockResolvedValue(null);

    const fakeToken = "a".repeat(64);
    const result = await verifyEmailToken(fakeToken);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Token introuvable ou déjà utilisé");
  });

  it("rejette un token expiré et le supprime", async () => {
    mockedPrisma.verificationToken.findUnique.mockResolvedValue({
      identifier: "test@example.com",
      token: "a".repeat(64),
      expires: new Date(Date.now() - 1000), // expiré
    });

    const fakeToken = "a".repeat(64);
    const result = await verifyEmailToken(fakeToken);

    expect(result.success).toBe(false);
    expect(result.error).toContain("expiré");
    expect(mockedPrisma.verificationToken.delete).toHaveBeenCalledTimes(1);
  });

  it("valide un token correct et marque l'email comme vérifié", async () => {
    const futureDate = new Date(Date.now() + 3600000);
    mockedPrisma.verificationToken.findUnique.mockResolvedValue({
      identifier: "test@example.com",
      token: "a".repeat(64),
      expires: futureDate,
    });
    mockedPrisma.user.findFirst.mockResolvedValue({ id: "user-1", isActive: true });

    const fakeToken = "a".repeat(64);
    const result = await verifyEmailToken(fakeToken);

    expect(result.success).toBe(true);
    expect(result.email).toBe("test@example.com");
    expect(mockedPrisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { emailVerified: expect.any(Date) },
    });
    expect(mockedPrisma.verificationToken.deleteMany).toHaveBeenCalledWith({
      where: { identifier: "test@example.com" },
    });
  });

  it("rejette si le compte est désactivé", async () => {
    mockedPrisma.verificationToken.findUnique.mockResolvedValue({
      identifier: "test@example.com",
      token: "a".repeat(64),
      expires: new Date(Date.now() + 3600000),
    });
    mockedPrisma.user.findFirst.mockResolvedValue({ id: "user-1", isActive: false });

    const fakeToken = "a".repeat(64);
    const result = await verifyEmailToken(fakeToken);

    expect(result.success).toBe(false);
    expect(result.error).toContain("désactivé");
    expect(mockedPrisma.user.update).not.toHaveBeenCalled();
  });

  it("rejette si aucun utilisateur n'est associé", async () => {
    mockedPrisma.verificationToken.findUnique.mockResolvedValue({
      identifier: "ghost@example.com",
      token: "a".repeat(64),
      expires: new Date(Date.now() + 3600000),
    });
    mockedPrisma.user.findFirst.mockResolvedValue(null);

    const fakeToken = "a".repeat(64);
    const result = await verifyEmailToken(fakeToken);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Aucun compte");
  });
});

describe("isEmailVerified", () => {
  it("retourne true si emailVerified est non null", async () => {
    mockedPrisma.user.findFirst.mockResolvedValue({ emailVerified: new Date() });
    const result = await isEmailVerified("test@example.com");
    expect(result).toBe(true);
  });

  it("retourne false si emailVerified est null", async () => {
    mockedPrisma.user.findFirst.mockResolvedValue({ emailVerified: null });
    const result = await isEmailVerified("test@example.com");
    expect(result).toBe(false);
  });

  it("retourne false si l'utilisateur n'existe pas", async () => {
    mockedPrisma.user.findFirst.mockResolvedValue(null);
    const result = await isEmailVerified("ghost@example.com");
    expect(result).toBe(false);
  });
});
