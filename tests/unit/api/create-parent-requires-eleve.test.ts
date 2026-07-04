import { describe, expect, it, vi, beforeEach } from "vitest";

const { authMock, prismaMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    eleve: { findMany: vi.fn() },
    parent: { create: vi.fn() },
    eleveParent: { create: vi.fn() },
  },
}));

vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const TENANT_ID = "tenant-1";

function adminSession() {
  return { user: { id: "admin-1", role: "TENANT_ADMIN", tenantId: TENANT_ID } };
}

const baseForm = {
  nom: "Diop",
  prenom: "Awa",
  phone: "221771234567",
  phone2: "",
  email: "",
  telegramChatId: "",
  profession: "",
  adresse: "",
};

describe("createParent — lien élève obligatoire à la création", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refuse la création d'un parent sans aucun élève lié", async () => {
    authMock.mockResolvedValue(adminSession());

    const { createParent } = await import("@/lib/actions/parametres");

    await expect(createParent({ ...baseForm, eleveIds: [] })).rejects.toThrow(/lier au moins un élève/);
    expect(prismaMock.parent.create).not.toHaveBeenCalled();
  });

  it("refuse si un élève sélectionné n'appartient pas au même établissement", async () => {
    authMock.mockResolvedValue(adminSession());
    prismaMock.eleve.findMany.mockResolvedValue([{ id: "eleve-1" }]); // un seul retrouvé sur 2 demandés

    const { createParent } = await import("@/lib/actions/parametres");

    await expect(
      createParent({ ...baseForm, eleveIds: ["eleve-1", "eleve-autre-tenant"] })
    ).rejects.toThrow(/introuvables dans cet établissement/);
    expect(prismaMock.parent.create).not.toHaveBeenCalled();
  });

  it("crée le parent et le lien EleveParent quand au moins un élève valide est fourni", async () => {
    authMock.mockResolvedValue(adminSession());
    prismaMock.eleve.findMany.mockResolvedValue([{ id: "eleve-1" }]);
    prismaMock.parent.create.mockResolvedValue({ id: "parent-1" });

    const { createParent } = await import("@/lib/actions/parametres");
    await createParent({ ...baseForm, eleveIds: ["eleve-1"] });

    expect(prismaMock.parent.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.eleveParent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eleveId: "eleve-1", parentId: "parent-1", isGardien: true }),
      })
    );
  });
});
