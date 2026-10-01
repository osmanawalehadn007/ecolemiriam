import { describe, it, expect, vi, beforeEach } from "vitest";

// ============================================================
// createDepense — qui peut être désigné comme AUTORISATEUR ?
// ============================================================
// Règle métier : seuls le responsable d'établissement (TENANT_ADMIN) et le chef
// d'établissement (PRINCIPAL) peuvent figurer comme auteur d'une autorisation
// de dépense. Le menu déroulant ne propose qu'eux (DepensesSection), mais le
// contrôle est refait ici : un appel direct à la server action ne doit pas
// pouvoir enregistrer une autorisation attribuée à un autre rôle.

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/audit", () => ({ auditFire: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  default: {
    user: { findFirst: vi.fn() },
    depense: { create: vi.fn() },
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { createDepense } from "@/lib/actions/finances";
import {
  MESSAGE_AUTORISATEUR_REFUSE,
  MESSAGE_PAYEUR_REFUSE,
} from "@/lib/depense-habilitations";

const mockAuth = auth as unknown as { mockResolvedValue: (v: unknown) => void };
const mockPrisma = prisma as unknown as {
  user: { findFirst: ReturnType<typeof vi.fn> };
  depense: { create: ReturnType<typeof vi.fn> };
};

const DEPENSE = { categorie: "Fournitures scolaires", montant: 25000, devise: "DJF" };

function session(role = "TENANT_ADMIN") {
  return {
    user: {
      id: "u-1",
      tenantId: "t-1",
      role,
      siteId: null,
      siteIds: [] as string[],
      tenantHasSites: false,
    },
  };
}

describe("createDepense — autorisateur habilité", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue(session());
    mockPrisma.depense.create.mockResolvedValue({ id: "dep-1" });
  });

  it("accepte un responsable d'établissement (TENANT_ADMIN)", async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ name: "Mamadou Diallo", role: "TENANT_ADMIN" });

    await createDepense({ ...DEPENSE, autoriseParId: "u-directeur" });

    expect(mockPrisma.depense.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ autoriseParId: "u-directeur" }),
      })
    );
  });

  it("accepte un chef d'établissement (PRINCIPAL)", async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ name: "Aïcha Ali", role: "PRINCIPAL" });

    await createDepense({ ...DEPENSE, autoriseParId: "u-principal" });

    expect(mockPrisma.depense.create).toHaveBeenCalledTimes(1);
  });

  it.each([
    "SECRETARY",
    "TEACHER",
    "CLASS_TEACHER",
    "COUNSELOR",
    "NURSE",
    "ACCOUNTANT",
    "PARENT",
    "STUDENT",
    "SUPER_ADMIN",
  ])("refuse un autorisateur de rôle %s et n'enregistre rien", async (role) => {
    mockPrisma.user.findFirst.mockResolvedValue({ name: "Quelqu'un", role });

    await expect(createDepense({ ...DEPENSE, autoriseParId: "u-x" })).rejects.toThrow(
      MESSAGE_AUTORISATEUR_REFUSE
    );
    expect(mockPrisma.depense.create).not.toHaveBeenCalled();
  });

  it("cherche l'autorisateur dans l'établissement de la session", async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ name: "M", role: "TENANT_ADMIN" });

    await createDepense({ ...DEPENSE, autoriseParId: "u-directeur" });

    expect(mockPrisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "u-directeur", tenantId: "t-1" }),
      })
    );
  });

  it("refuse un autorisateur d'un autre établissement (introuvable)", async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null);

    await expect(
      createDepense({ ...DEPENSE, autoriseParId: "u-autre-etablissement" })
    ).rejects.toThrow("Autorisateur introuvable dans cet établissement");
    expect(mockPrisma.depense.create).not.toHaveBeenCalled();
  });

  it("accepte une dépense sans autorisateur (champ facultatif)", async () => {
    await createDepense(DEPENSE);

    expect(mockPrisma.user.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.depense.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ autoriseParId: null }),
      })
    );
  });

  it("refuse un compte sans le droit finance:write", async () => {
    mockAuth.mockResolvedValue(session("TEACHER"));

    await expect(createDepense(DEPENSE)).rejects.toThrow("Accès refusé");
    expect(mockPrisma.depense.create).not.toHaveBeenCalled();
  });
});

describe("createDepense — payeur habilité", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue(session());
    mockPrisma.depense.create.mockResolvedValue({ id: "dep-1" });
  });

  it("accepte un payeur comptable / caissier (ACCOUNTANT)", async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ name: "Fatou Ndiaye", role: "ACCOUNTANT" });

    await createDepense({ ...DEPENSE, payeParId: "u-comptable" });

    expect(mockPrisma.depense.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ payeParId: "u-comptable" }),
      })
    );
  });

  it.each([
    "SECRETARY",
    "TEACHER",
    "CLASS_TEACHER",
    "COUNSELOR",
    "NURSE",
    "PARENT",
    "STUDENT",
    "SUPER_ADMIN",
    "TENANT_ADMIN",
    "PRINCIPAL",
  ])("refuse un payeur de rôle %s et n'enregistre rien", async (role) => {
    mockPrisma.user.findFirst.mockResolvedValue({ name: "Quelqu'un", role });

    await expect(createDepense({ ...DEPENSE, payeParId: "u-x" })).rejects.toThrow(
      MESSAGE_PAYEUR_REFUSE
    );
    expect(mockPrisma.depense.create).not.toHaveBeenCalled();
  });

  it("refuse un payeur d'un autre établissement (introuvable)", async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null);

    await expect(
      createDepense({ ...DEPENSE, payeParId: "u-autre-etablissement" })
    ).rejects.toThrow("Payeur introuvable dans cet établissement");
    expect(mockPrisma.depense.create).not.toHaveBeenCalled();
  });

  it("accepte une dépense sans payeur (champ facultatif)", async () => {
    await createDepense(DEPENSE);

    expect(mockPrisma.user.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.depense.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ payeParId: null }),
      })
    );
  });

  it("vérifie autorisateur ET payeur quand les deux sont renseignés", async () => {
    mockPrisma.user
      .findFirst.mockResolvedValueOnce({ name: "Mamadou Diallo", role: "TENANT_ADMIN" })
      .mockResolvedValueOnce({ name: "Fatou Ndiaye", role: "ACCOUNTANT" });

    await createDepense({
      ...DEPENSE,
      autoriseParId: "u-directeur",
      payeParId: "u-comptable",
    });

    expect(mockPrisma.user.findFirst).toHaveBeenCalledTimes(2);
    expect(mockPrisma.depense.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          autoriseParId: "u-directeur",
          payeParId: "u-comptable",
        }),
      })
    );
  });

  it("refuse la combinaison payeur autorisé / autorisateur interdit", async () => {
    mockPrisma.user
      .findFirst.mockResolvedValueOnce({ name: "Quelqu'un", role: "SECRETARY" })
      .mockResolvedValueOnce({ name: "Fatou Ndiaye", role: "ACCOUNTANT" });

    await expect(
      createDepense({
        ...DEPENSE,
        autoriseParId: "u-secretaire",
        payeParId: "u-comptable",
      })
    ).rejects.toThrow(MESSAGE_AUTORISATEUR_REFUSE);
    expect(mockPrisma.depense.create).not.toHaveBeenCalled();
  });
});
