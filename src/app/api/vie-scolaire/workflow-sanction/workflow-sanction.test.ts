import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  default: {
    incident: { findFirst: vi.fn(), count: vi.fn(), update: vi.fn() },
    sanction: { create: vi.fn() },
  },
}));

import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";

const mockAuth = auth as ReturnType<typeof vi.fn>;
const mockPrisma = prisma as unknown as {
  incident: { findFirst: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  sanction: { create: ReturnType<typeof vi.fn> };
};

const { POST } = await import("@/app/api/vie-scolaire/workflow-sanction/route");

function makeReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/vie-scolaire/workflow-sanction", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("API workflow-sanction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({
      user: { id: "u1", tenantId: "t1", role: "TENANT_ADMIN", siteId: null, siteIds: [] },
    });
  });

  it("rejette sans session", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await POST(makeReq({ incidentId: "i1" }));
    expect(res.status).toBe(401);
  });

  it("retourne 404 si incident introuvable", async () => {
    mockPrisma.incident.findFirst.mockResolvedValue(null);
    const res = await POST(makeReq({ incidentId: "nonexistent" }));
    expect(res.status).toBe(404);
  });

  it("suggère AVERTISSEMENT pour gravité 1", async () => {
    mockPrisma.incident.findFirst.mockResolvedValue({
      id: "i1",
      gravite: 1,
      description: "Bavardage",
      eleve: { id: "e1", nom: "Doe", prenom: "John" },
      sanctions: [],
    });
    mockPrisma.incident.count.mockResolvedValue(1);

    const res = await POST(makeReq({ incidentId: "i1", autoApply: false }));
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.suggestions).toHaveLength(1);
    expect(data.suggestions[0].type).toBe("AVERTISSEMENT");
    expect(data.applied).toBe(0); // autoApply = false
  });

  it("suggère BLAME pour gravité 2", async () => {
    mockPrisma.incident.findFirst.mockResolvedValue({
      id: "i2",
      gravite: 2,
      description: "Insolence",
      eleve: { id: "e1", nom: "Doe", prenom: "John" },
      sanctions: [],
    });
    mockPrisma.incident.count.mockResolvedValue(1);

    const res = await POST(makeReq({ incidentId: "i2" }));
    const data = await res.json();

    expect(data.suggestions).toHaveLength(1);
    expect(data.suggestions[0].type).toBe("BLAME");
  });

  it("suggère BLAME + CONVOCATION pour gravité 2 avec récidive", async () => {
    mockPrisma.incident.findFirst.mockResolvedValue({
      id: "i3",
      gravite: 2,
      description: "Insolence répétée",
      eleve: { id: "e1", nom: "Doe", prenom: "John" },
      sanctions: [],
    });
    mockPrisma.incident.count.mockResolvedValue(3); // 3 incidents

    const res = await POST(makeReq({ incidentId: "i3" }));
    const data = await res.json();

    expect(data.suggestions).toHaveLength(2);
    expect(data.suggestions[0].type).toBe("BLAME");
    expect(data.suggestions[1].type).toBe("CONVOCATION_PARENTS");
    expect(data.suggestions[1].reason).toContain("3 incidents");
  });

  it("suggère EXCLUSION + CONVOCATION pour gravité 3", async () => {
    mockPrisma.incident.findFirst.mockResolvedValue({
      id: "i4",
      gravite: 3,
      description: "Bagarre",
      eleve: { id: "e1", nom: "Doe", prenom: "John" },
      sanctions: [],
    });
    mockPrisma.incident.count.mockResolvedValue(1);

    const res = await POST(makeReq({ incidentId: "i4" }));
    const data = await res.json();

    expect(data.suggestions).toHaveLength(2);
    expect(data.suggestions[0].type).toBe("EXCLUSION_TEMP");
    expect(data.suggestions[0].dateFin).not.toBeNull(); // 3 jours
    expect(data.suggestions[1].type).toBe("CONVOCATION_PARENTS");
  });

  it("applique les sanctions quand autoApply=true", async () => {
    mockPrisma.incident.findFirst.mockResolvedValue({
      id: "i5",
      gravite: 1,
      description: "Retard",
      eleve: { id: "e1", nom: "Doe", prenom: "John" },
      sanctions: [],
    });
    mockPrisma.incident.count.mockResolvedValue(1);
    mockPrisma.sanction.create.mockResolvedValue({ id: "s1" });
    mockPrisma.incident.update.mockResolvedValue({});

    const res = await POST(makeReq({ incidentId: "i5", autoApply: true }));
    const data = await res.json();

    expect(data.autoApplied).toBe(true);
    expect(data.applied).toBe(1);
    expect(mockPrisma.sanction.create).toHaveBeenCalled();
  });

  it("ne duplique pas les sanctions existantes", async () => {
    mockPrisma.incident.findFirst.mockResolvedValue({
      id: "i6",
      gravite: 1,
      description: "Retard",
      eleve: { id: "e1", nom: "Doe", prenom: "John" },
      sanctions: [{ type: "AVERTISSEMENT" }], // déjà existant
    });
    mockPrisma.incident.count.mockResolvedValue(1);

    const res = await POST(makeReq({ incidentId: "i6", autoApply: true }));
    const data = await res.json();

    expect(data.applied).toBe(0); // pas de doublon
    expect(mockPrisma.sanction.create).not.toHaveBeenCalled();
  });
});
