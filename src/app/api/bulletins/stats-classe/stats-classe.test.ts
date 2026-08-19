import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  default: {
    bulletin: { findMany: vi.fn() },
    periode: { findMany: vi.fn() },
  },
}));

import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";

const mockAuth = auth as ReturnType<typeof vi.fn>;
const mockPrisma = prisma as unknown as {
  bulletin: { findMany: ReturnType<typeof vi.fn> };
  periode: { findMany: ReturnType<typeof vi.fn> };
};

const { GET } = await import("@/app/api/bulletins/stats-classe/route");

function makeReq(url: string): NextRequest {
  return new NextRequest(url);
}

const mockBulletins = [
  {
    id: "b1",
    moyenneGenerale: 16.5,
    rang: 1,
    decision: "FELICITATIONS",
    appreciation: "Très bon trimestre",
    eleve: { id: "e1", nom: "Doe", prenom: "John", matricule: "M001" },
    matieres: [
      { matiere: { id: "m1", nom: "Maths", code: "MATH" }, moyenneEleve: 18 },
      { matiere: { id: "m2", nom: "Français", code: "FR" }, moyenneEleve: 15 },
    ],
  },
  {
    id: "b2",
    moyenneGenerale: 9.5,
    rang: 2,
    decision: "AVERTISSEMENT",
    appreciation: "Doit fournir plus d'efforts",
    eleve: { id: "e2", nom: "Smith", prenom: "Jane", matricule: "M002" },
    matieres: [
      { matiere: { id: "m1", nom: "Maths", code: "MATH" }, moyenneEleve: 7 },
      { matiere: { id: "m2", nom: "Français", code: "FR" }, moyenneEleve: 12 },
    ],
  },
  {
    id: "b3",
    moyenneGenerale: 12,
    rang: 3,
    decision: "PASSAGE",
    appreciation: "Bon trimestre",
    eleve: { id: "e3", nom: "Brown", prenom: "Bob", matricule: "M003" },
    matieres: [
      { matiere: { id: "m1", nom: "Maths", code: "MATH" }, moyenneEleve: 11 },
      { matiere: { id: "m2", nom: "Français", code: "FR" }, moyenneEleve: 13 },
    ],
  },
];

describe("API stats-classe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({
      user: { id: "u1", tenantId: "t1", role: "TENANT_ADMIN", siteId: null, siteIds: [] },
    });
    mockPrisma.periode.findMany.mockResolvedValue([
      { id: "p1", nom: "Trimestre 1", numero: 1 },
    ]);
  });

  it("rejette sans session", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await GET(makeReq("http://localhost/api/bulletins/stats-classe?classeId=c1&periodeId=p1"));
    expect(res.status).toBe(401);
  });

  it("retourne 400 sans classeId/periodeId", async () => {
    const res = await GET(makeReq("http://localhost/api/bulletins/stats-classe"));
    expect(res.status).toBe(400);
  });

  it("retourne 404 si aucun bulletin", async () => {
    mockPrisma.bulletin.findMany.mockResolvedValue([]);
    const res = await GET(makeReq("http://localhost/api/bulletins/stats-classe?classeId=c1&periodeId=p1"));
    expect(res.status).toBe(404);
  });

  it("calcule correctement les statistiques de classe", async () => {
    mockPrisma.bulletin.findMany.mockResolvedValue(mockBulletins);
    const res = await GET(makeReq("http://localhost/api/bulletins/stats-classe?classeId=c1&periodeId=p1"));
    expect(res.status).toBe(200);
    const data = await res.json();

    // Effectif
    expect(data.effectif).toBe(3);

    // Moyenne classe = (16.5 + 9.5 + 12) / 3 = 12.67
    expect(data.moyenneClasse).toBeCloseTo(12.67, 1);

    // Taux réussite = 2/3 (>=10) = 66.67%
    expect(data.tauxReussite).toBeCloseTo(66.67, 0);

    // Meilleure = 16.5
    expect(data.meilleureNote).toBe(16.5);

    // Plus basse = 9.5
    expect(data.plusBasseNote).toBe(9.5);

    // Décisions
    expect(data.decisions.FELICITATIONS).toBe(1);
    expect(data.decisions.PASSAGE).toBe(1);
    expect(data.decisions.AVERTISSEMENT).toBe(1);

    // Classement
    expect(data.classement).toHaveLength(3);
    expect(data.classement[0].nom).toBe("John Doe");
    expect(data.classement[0].rang).toBe(1);

    // Top 5
    expect(data.top5).toHaveLength(3);
    expect(data.top5[0].nom).toBe("John Doe");

    // Bottom 5
    expect(data.bottom5).toHaveLength(3);
    expect(data.bottom5[0].nom).toBe("Jane Smith");

    // Stats par matière
    expect(data.matieresStats).toHaveLength(2);
    const maths = data.matieresStats.find((m: { code: string }) => m.code === "MATH");
    expect(maths).toBeDefined();
    // Maths: 18, 7, 11 → moyenne = 12, taux = 2/3
    expect(maths.moyenne).toBeCloseTo(12, 0);
  });

  it("calcule la médiane correctement", async () => {
    // Moyennes: 9.5, 12, 16.5 → médiane = 12
    mockPrisma.bulletin.findMany.mockResolvedValue(mockBulletins);
    const res = await GET(makeReq("http://localhost/api/bulletins/stats-classe?classeId=c1&periodeId=p1"));
    const data = await res.json();
    expect(data.mediane).toBe(12);
  });
});
