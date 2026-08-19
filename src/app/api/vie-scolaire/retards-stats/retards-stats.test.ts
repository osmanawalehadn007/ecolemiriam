import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  default: {
    absence: { findMany: vi.fn(), count: vi.fn() },
    incident: { findFirst: vi.fn(), create: vi.fn() },
    sanction: { create: vi.fn() },
  },
}));

import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";

const mockAuth = auth as ReturnType<typeof vi.fn>;
const mockPrisma = prisma as unknown as {
  absence: { findMany: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn> };
  incident: { findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  sanction: { create: ReturnType<typeof vi.fn> };
};

const { GET } = await import("@/app/api/vie-scolaire/retards-stats/route");

function makeReq(url: string): NextRequest {
  return new NextRequest(url);
}

const mockRetards = [
  {
    id: "a1",
    eleveId: "e1",
    isRetard: true,
    date: new Date(),
    motif: "INJUSTIFIE",
    eleve: { id: "e1", nom: "Doe", prenom: "John", matricule: "M001", classe: { nom: "6ème A" } },
  },
  {
    id: "a2",
    eleveId: "e1",
    isRetard: true,
    date: new Date(),
    motif: "INJUSTIFIE",
    eleve: { id: "e1", nom: "Doe", prenom: "John", matricule: "M001", classe: { nom: "6ème A" } },
  },
  {
    id: "a3",
    eleveId: "e1",
    isRetard: true,
    date: new Date(),
    motif: "INJUSTIFIE",
    eleve: { id: "e1", nom: "Doe", prenom: "John", matricule: "M001", classe: { nom: "6ème A" } },
  },
  {
    id: "a4",
    eleveId: "e2",
    isRetard: true,
    date: new Date(),
    motif: "JUSTIFIE",
    eleve: { id: "e2", nom: "Smith", prenom: "Jane", matricule: "M002", classe: { nom: "5ème B" } },
  },
];

describe("API retards-stats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({
      user: { id: "u1", tenantId: "t1", role: "TENANT_ADMIN", siteId: null, siteIds: [] },
    });
  });

  it("rejette sans session", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await GET(makeReq("http://localhost/api/vie-scolaire/retards-stats"));
    expect(res.status).toBe(401);
  });

  it("compte les retards par élève", async () => {
    mockPrisma.absence.findMany.mockResolvedValue(mockRetards);

    const res = await GET(makeReq("http://localhost/api/vie-scolaire/retards-stats?seuil=3"));
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.totalRetards).toBe(4);
    expect(data.elevesConcernes).toBe(2);

    // John Doe a 3 retards → dépasse le seuil
    expect(data.elevesEnSeuil).toHaveLength(1);
    expect(data.elevesEnSeuil[0].nom).toBe("Doe");
    expect(data.elevesEnSeuil[0].count).toBe(3);
  });

  it("ne crée pas d'incident sans autoCreate", async () => {
    mockPrisma.absence.findMany.mockResolvedValue(mockRetards);

    const res = await GET(makeReq("http://localhost/api/vie-scolaire/retards-stats?seuil=3"));
    const data = await res.json();

    expect(data.incidentsCreated).toBe(0);
    expect(mockPrisma.incident.create).not.toHaveBeenCalled();
  });

  it("crée des incidents automatiquement avec autoCreate=true", async () => {
    mockPrisma.absence.findMany.mockResolvedValue(mockRetards);
    mockPrisma.incident.findFirst.mockResolvedValue(null); // pas d'incident existant
    mockPrisma.incident.create.mockResolvedValue({ id: "inc1" });
    mockPrisma.sanction.create.mockResolvedValue({ id: "san1" });

    const res = await GET(makeReq("http://localhost/api/vie-scolaire/retards-stats?seuil=3&autoCreate=true"));
    const data = await res.json();

    expect(data.incidentsCreated).toBe(1);
    expect(mockPrisma.incident.create).toHaveBeenCalled();
    expect(mockPrisma.sanction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "TRAVAUX_INTERET_GENERAL",
        }),
      })
    );
  });

  it("ne crée pas de doublon d'incident", async () => {
    mockPrisma.absence.findMany.mockResolvedValue(mockRetards);
    mockPrisma.incident.findFirst.mockResolvedValue({ id: "existing" }); // déjà existant

    const res = await GET(makeReq("http://localhost/api/vie-scolaire/retards-stats?seuil=3&autoCreate=true"));
    const data = await res.json();

    expect(data.incidentsCreated).toBe(0);
    expect(mockPrisma.incident.create).not.toHaveBeenCalled();
  });

  it("suggère EXCLUSION_COURS pour le double du seuil", async () => {
    const manyRetards = Array.from({ length: 6 }, (_, i) => ({
      id: `a${i}`,
      eleveId: "e1",
      isRetard: true,
      date: new Date(),
      motif: "INJUSTIFIE",
      eleve: { id: "e1", nom: "Doe", prenom: "John", matricule: "M001", classe: { nom: "6ème A" } },
    }));
    mockPrisma.absence.findMany.mockResolvedValue(manyRetards);

    const res = await GET(makeReq("http://localhost/api/vie-scolaire/retards-stats?seuil=3"));
    const data = await res.json();

    expect(data.elevesEnSeuil[0].count).toBe(6);
    expect(data.elevesEnSeuil[0].sanctionSuggeree).toBe("EXCLUSION_COURS");
  });
});
