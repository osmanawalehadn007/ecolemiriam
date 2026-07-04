import { describe, expect, it, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

const { authMock, prismaMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    eleveParent: { findFirst: vi.fn(), findMany: vi.fn() },
    note: { findMany: vi.fn(), count: vi.fn() },
  },
}));

vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@/lib/prisma", () => ({ default: prismaMock }));

function makeRequest(query: string): NextRequest {
  return { url: `http://localhost/api/notes${query}` } as unknown as NextRequest;
}

const PARENT_USER_ID = "parent-user-1";
const TENANT_ID = "tenant-1";

function parentSession() {
  return { user: { id: PARENT_USER_ID, role: "PARENT", tenantId: TENANT_ID } };
}

function teacherSession() {
  return { user: { id: "teacher-user-1", role: "TEACHER", tenantId: TENANT_ID } };
}

describe("Isolation parent/enfant sur GET /api/notes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.note.findMany.mockResolvedValue([]);
    prismaMock.note.count.mockResolvedValue(0);
  });

  it("refuse (403) un parent qui consulte les notes d'un enfant qui n'est pas le sien", async () => {
    authMock.mockResolvedValue(parentSession());
    prismaMock.eleveParent.findFirst.mockResolvedValue(null);

    const { GET } = await import("@/app/api/notes/route");
    const res = await GET(makeRequest("?eleveId=eleve-autre-famille"));

    expect(res.status).toBe(403);
    expect(prismaMock.eleveParent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          eleveId: "eleve-autre-famille",
          parent: expect.objectContaining({ userId: PARENT_USER_ID }),
        }),
      })
    );
    expect(prismaMock.note.findMany).not.toHaveBeenCalled();
  });

  it("autorise un parent à consulter les notes de son propre enfant", async () => {
    authMock.mockResolvedValue(parentSession());
    prismaMock.eleveParent.findFirst.mockResolvedValue({ eleveId: "eleve-mon-fils" });

    const { GET } = await import("@/app/api/notes/route");
    const res = await GET(makeRequest("?eleveId=eleve-mon-fils"));

    expect(res.status).toBe(200);
    expect(prismaMock.note.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ eleveId: { equals: "eleve-mon-fils" }, tenantId: TENANT_ID }),
      })
    );
  });

  it("sans eleveId, restreint un parent aux notes de ses propres enfants uniquement", async () => {
    authMock.mockResolvedValue(parentSession());
    prismaMock.eleveParent.findMany.mockResolvedValue([{ eleveId: "enfant-a" }, { eleveId: "enfant-b" }]);

    const { GET } = await import("@/app/api/notes/route");
    const res = await GET(makeRequest(""));

    expect(res.status).toBe(200);
    expect(prismaMock.eleveParent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { parent: { userId: PARENT_USER_ID } } })
    );
    expect(prismaMock.note.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ eleveId: { in: ["enfant-a", "enfant-b"] } }),
      })
    );
  });

  it("n'applique pas la vérification EleveParent pour un enseignant (rôle non-parent)", async () => {
    authMock.mockResolvedValue(teacherSession());

    const { GET } = await import("@/app/api/notes/route");
    const res = await GET(makeRequest("?eleveId=eleve-classe"));

    expect(res.status).toBe(200);
    expect(prismaMock.eleveParent.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.eleveParent.findMany).not.toHaveBeenCalled();
  });
});
