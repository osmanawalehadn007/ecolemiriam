import { describe, expect, it, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

const { verifyMobileTokenMock, prismaMock } = vi.hoisted(() => ({
  verifyMobileTokenMock: vi.fn(),
  prismaMock: {
    eleve: { findFirst: vi.fn() },
    eleveParent: { findFirst: vi.fn(), findMany: vi.fn() },
    note: { findMany: vi.fn() },
    absence: { findMany: vi.fn() },
    incident: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/mobile-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mobile-auth")>();
  return { ...actual, verifyMobileToken: verifyMobileTokenMock };
});
vi.mock("@/lib/prisma", () => ({ default: prismaMock }));

function makeRequest(): NextRequest {
  return {} as unknown as NextRequest;
}

const PARENT_USER_ID = "parent-user-1";
const TENANT_ID = "tenant-1";

function parentUser() {
  return { id: PARENT_USER_ID, email: "parent@ecolpro.test", role: "PARENT", tenantId: TENANT_ID };
}

function teacherUser() {
  return { id: "teacher-user-1", email: "prof@ecolpro.test", role: "TEACHER", tenantId: TENANT_ID };
}

describe("Isolation parent/enfant sur GET /api/mobile/eleves/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.eleveParent.findMany.mockResolvedValue([]);
    prismaMock.note.findMany.mockResolvedValue([]);
    prismaMock.absence.findMany.mockResolvedValue([]);
    prismaMock.incident.findMany.mockResolvedValue([]);
  });

  it("refuse (403) un parent qui consulte un enfant qui n'est pas le sien", async () => {
    verifyMobileTokenMock.mockResolvedValue(parentUser());
    prismaMock.eleve.findFirst.mockResolvedValue({ id: "eleve-autre-famille" });
    prismaMock.eleveParent.findFirst.mockResolvedValue(null);

    const { GET } = await import("@/app/api/mobile/eleves/[id]/route");
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: "eleve-autre-famille" }) });

    expect(res.status).toBe(403);
    expect(prismaMock.eleveParent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          eleveId: "eleve-autre-famille",
          parent: expect.objectContaining({ userId: PARENT_USER_ID }),
        }),
      })
    );
  });

  it("autorise un parent à consulter son propre enfant", async () => {
    verifyMobileTokenMock.mockResolvedValue(parentUser());
    prismaMock.eleve.findFirst.mockResolvedValue({ id: "eleve-mon-fils" });
    prismaMock.eleveParent.findFirst.mockResolvedValue({ eleveId: "eleve-mon-fils" });

    const { GET } = await import("@/app/api/mobile/eleves/[id]/route");
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: "eleve-mon-fils" }) });

    expect(res.status).toBe(200);
  });

  it("n'applique pas la vérification EleveParent pour un enseignant (rôle non-parent)", async () => {
    verifyMobileTokenMock.mockResolvedValue(teacherUser());
    prismaMock.eleve.findFirst.mockResolvedValue({ id: "eleve-classe" });

    const { GET } = await import("@/app/api/mobile/eleves/[id]/route");
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: "eleve-classe" }) });

    expect(res.status).toBe(200);
    expect(prismaMock.eleveParent.findFirst).not.toHaveBeenCalled();
  });
});
