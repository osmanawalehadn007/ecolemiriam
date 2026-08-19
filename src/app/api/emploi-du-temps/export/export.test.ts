import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  default: {
    emploiTemps: { findMany: vi.fn() },
    tenant: { findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/annee-scolaire", () => ({
  getAnneeCouranteLibelle: vi.fn().mockResolvedValue("2025-2026"),
}));

import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";

const mockAuth = auth as ReturnType<typeof vi.fn>;
const mockPrisma = prisma as unknown as {
  emploiTemps: { findMany: ReturnType<typeof vi.fn> };
  tenant: { findUnique: ReturnType<typeof vi.fn> };
};

const { GET } = await import("@/app/api/emploi-du-temps/export/route");

function makeReq(url: string): NextRequest {
  return new NextRequest(url);
}

const mockEmplois = [
  {
    id: "e1",
    jour: "LUNDI",
    heureDebut: "08:00",
    heureFin: "09:00",
    salle: "Salle 101",
    matiere: { nom: "Mathématiques", code: "MATH", couleur: "#6366f1" },
    classe: { nom: "6ème A" },
    enseignant: { user: { name: "Prof Dupont" } },
  },
  {
    id: "e2",
    jour: "MARDI",
    heureDebut: "10:00",
    heureFin: "11:00",
    salle: "Salle 102",
    matiere: { nom: "Français", code: "FR", couleur: "#ec4899" },
    classe: { nom: "6ème A" },
    enseignant: { user: { name: "Prof Martin" } },
  },
];

describe("API emploi-du-temps/export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({
      user: { id: "u1", tenantId: "t1", role: "TENANT_ADMIN", siteId: null, siteIds: [] },
    });
    mockPrisma.tenant.findUnique.mockResolvedValue({ name: "Ecole Test" });
  });

  it("rejette sans session", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await GET(makeReq("http://localhost/api/emploi-du-temps/export?classeId=c1"));
    expect(res.status).toBe(401);
  });

  it("retourne 400 sans classeId ni enseignantId", async () => {
    const res = await GET(makeReq("http://localhost/api/emploi-du-temps/export"));
    expect(res.status).toBe(400);
  });

  it("retourne 404 si aucun créneau", async () => {
    mockPrisma.emploiTemps.findMany.mockResolvedValue([]);
    const res = await GET(makeReq("http://localhost/api/emploi-du-temps/export?classeId=c1"));
    expect(res.status).toBe(404);
  });

  it("génère un fichier Excel valide", async () => {
    mockPrisma.emploiTemps.findMany.mockResolvedValue(mockEmplois);
    const res = await GET(makeReq("http://localhost/api/emploi-du-temps/export?classeId=c1"));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("spreadsheetml");
    expect(res.headers.get("Content-Disposition")).toContain("attachment");

    // Vérifier que le corps n'est pas vide
    const buffer = await res.arrayBuffer();
    expect(buffer.byteLength).toBeGreaterThan(0);
  });

  it("exporte par enseignantId", async () => {
    mockPrisma.emploiTemps.findMany.mockResolvedValue(mockEmplois);
    const res = await GET(makeReq("http://localhost/api/emploi-du-temps/export?enseignantId=en1"));
    expect(res.status).toBe(200);
  });
});
