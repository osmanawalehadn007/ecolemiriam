import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  default: {
    incident: { findMany: vi.fn() },
    eleve: { findFirst: vi.fn() },
  },
}));

import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";

const mockAuth = auth as ReturnType<typeof vi.fn>;
const mockPrisma = prisma as unknown as {
  incident: { findMany: ReturnType<typeof vi.fn> };
  eleve: { findFirst: ReturnType<typeof vi.fn> };
};

const { GET } = await import("@/app/api/vie-scolaire/historique-disciplinaire/route");

function makeReq(url: string): NextRequest {
  return new NextRequest(url);
}

const mockIncidents = [
  {
    id: "i1",
    type: "AUTRE",
    statut: "RESOLU",
    gravite: 1,
    description: "Bavardage en classe",
    date: new Date("2025-01-15"),
    rapportePar: { name: "Prof Dupont" },
    sanctions: [
      {
        type: "AVERTISSEMENT",
        description: "Avertissement verbal",
        dateDebut: new Date("2025-01-15"),
      },
    ],
  },
  {
    id: "i2",
    type: "AUTRE",
    statut: "EN_TRAITEMENT",
    gravite: 3,
    description: "Bagarre dans la cour",
    date: new Date("2025-02-10"),
    rapportePar: { name: "Surveillant" },
    sanctions: [
      {
        type: "EXCLUSION_TEMP",
        description: "Exclusion 3 jours",
        dateDebut: new Date("2025-02-10"),
      },
      {
        type: "CONVOCATION_PARENTS",
        description: "Convocation urgente",
        dateDebut: new Date("2025-02-11"),
      },
    ],
  },
];

const mockEleve = {
  id: "e1",
  nom: "Doe",
  prenom: "John",
  matricule: "M001",
  classe: { nom: "6ème A" },
};

describe("API historique-disciplinaire", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({
      user: { id: "u1", tenantId: "t1", role: "TENANT_ADMIN", siteId: null, siteIds: [] },
    });
  });

  it("rejette sans session", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await GET(makeReq("http://localhost/api/vie-scolaire/historique-disciplinaire?eleveId=e1"));
    expect(res.status).toBe(401);
  });

  it("retourne 400 sans eleveId", async () => {
    const res = await GET(makeReq("http://localhost/api/vie-scolaire/historique-disciplinaire"));
    expect(res.status).toBe(400);
  });

  it("retourne 404 si élève introuvable", async () => {
    mockPrisma.eleve.findFirst.mockResolvedValue(null);
    mockPrisma.incident.findMany.mockResolvedValue([]);
    const res = await GET(makeReq("http://localhost/api/vie-scolaire/historique-disciplinaire?eleveId=nonexistent"));
    expect(res.status).toBe(404);
  });

  it("retourne l'historique complet avec stats", async () => {
    mockPrisma.eleve.findFirst.mockResolvedValue(mockEleve);
    mockPrisma.incident.findMany.mockResolvedValue(mockIncidents);

    const res = await GET(makeReq("http://localhost/api/vie-scolaire/historique-disciplinaire?eleveId=e1"));
    expect(res.status).toBe(200);
    const data = await res.json();

    // Élève
    expect(data.eleve.nom).toBe("John Doe");
    expect(data.eleve.matricule).toBe("M001");
    expect(data.eleve.classe).toBe("6ème A");

    // Totaux
    expect(data.totalIncidents).toBe(2);
    expect(data.totalSanctions).toBe(3); // 1 + 2

    // Par gravité
    expect(data.parGravite.leger).toBe(1);
    expect(data.parGravite.moyen).toBe(0);
    expect(data.parGravite.grave).toBe(1);

    // Par type de sanction
    expect(data.parTypeSanction.AVERTISSEMENT).toBe(1);
    expect(data.parTypeSanction.EXCLUSION_TEMP).toBe(1);
    expect(data.parTypeSanction.CONVOCATION_PARENTS).toBe(1);

    // Par statut
    expect(data.parStatut.RESOLU).toBe(1);
    expect(data.parStatut.EN_TRAITEMENT).toBe(1);

    // Timeline (incidents + sanctions triés par date desc)
    expect(data.timeline.length).toBe(5); // 2 incidents + 3 sanctions
    expect(data.timeline[0].type).toBeDefined();

    // Évolution (6 mois)
    expect(data.evolution).toHaveLength(6);
  });

  it("gère un élève sans incident", async () => {
    mockPrisma.eleve.findFirst.mockResolvedValue(mockEleve);
    mockPrisma.incident.findMany.mockResolvedValue([]);

    const res = await GET(makeReq("http://localhost/api/vie-scolaire/historique-disciplinaire?eleveId=e1"));
    const data = await res.json();

    expect(data.totalIncidents).toBe(0);
    expect(data.totalSanctions).toBe(0);
    expect(data.timeline).toHaveLength(0);
    expect(data.parGravite.leger).toBe(0);
  });

  it("trie la timeline par date décroissante", async () => {
    mockPrisma.eleve.findFirst.mockResolvedValue(mockEleve);
    mockPrisma.incident.findMany.mockResolvedValue(mockIncidents);

    const res = await GET(makeReq("http://localhost/api/vie-scolaire/historique-disciplinaire?eleveId=e1"));
    const data = await res.json();

    const dates = data.timeline.map((t: { date: string }) => new Date(t.date).getTime());
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i]).toBeLessThanOrEqual(dates[i - 1]);
    }
  });
});
