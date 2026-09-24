import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  default: {
    paiement: { findMany: vi.fn(), aggregate: vi.fn() },
    depense: { findMany: vi.fn(), aggregate: vi.fn() },
  },
}));

import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";

const mockAuth = auth as ReturnType<typeof vi.fn>;
const mockPrisma = prisma as unknown as {
  paiement: { findMany: ReturnType<typeof vi.fn>; aggregate: ReturnType<typeof vi.fn> };
  depense: { findMany: ReturnType<typeof vi.fn>; aggregate: ReturnType<typeof vi.fn> };
};

const { GET } = await import("@/app/api/finances/comptabilite/route");

function makeReq(url: string): NextRequest {
  return new NextRequest(url);
}

const mockPaiements = [
  {
    id: "p1",
    montant: 50000,
    devise: "DJF",
    methode: "espèces",
    reference: "REF001",
    date: new Date(),
    facture: { id: "f1", numero: "FAC-001", eleve: { nom: "Doe", prenom: "John" } },
    enregistrePar: { name: "Admin" },
  },
  {
    id: "p2",
    montant: 30000,
    devise: "DJF",
    methode: "virement",
    reference: "REF002",
    date: new Date(),
    facture: { id: "f2", numero: "FAC-002", eleve: { nom: "Smith", prenom: "Jane" } },
    enregistrePar: { name: "Admin" },
  },
];

const mockDepenses = [
  {
    id: "d1",
    categorie: "Fournitures",
    description: "Achat de matériel",
    fournisseur: "Fournisseur X",
    montant: 15000,
    devise: "DJF",
    date: new Date(),
    payePar: { name: "Admin" },
  },
];

describe("API comptabilité", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({
      user: { id: "u1", tenantId: "t1", role: "TENANT_ADMIN", siteId: null, siteIds: [] },
    });
    mockPrisma.paiement.aggregate.mockResolvedValue({ _sum: { montant: 80000 } });
    mockPrisma.depense.aggregate.mockResolvedValue({ _sum: { montant: 15000 } });
  });

  it("rejette sans session", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await GET(makeReq("http://localhost/api/finances/comptabilite"));
    expect(res.status).toBe(401);
  });

  it("retourne les totaux corrects", async () => {
    mockPrisma.paiement.findMany.mockResolvedValue(mockPaiements);
    mockPrisma.depense.findMany.mockResolvedValue(mockDepenses);

    const res = await GET(makeReq("http://localhost/api/finances/comptabilite?periode=month"));
    expect(res.status).toBe(200);
    const data = await res.json();

    // Total recettes = 50000 + 30000 = 80000
    expect(data.totalRecettes).toBe(80000);

    // Total dépenses = 15000
    expect(data.totalDepenses).toBe(15000);

    // Résultat = 80000 - 15000 = 65000
    expect(data.resultat).toBe(65000);

    // Recettes par méthode
    expect(data.recettesParMethode["espèces"]).toBe(50000);
    expect(data.recettesParMethode["virement"]).toBe(30000);

    // Dépenses par catégorie
    expect(data.depensesParCategorie["Fournitures"]).toBe(15000);

    // Journal
    expect(data.journal).toHaveLength(3); // 2 recettes + 1 dépense
    expect(data.journal[0].type).toBe("RECETTE"); // trié par date desc

    // Évolution (6 mois)
    expect(data.evolution).toHaveLength(6);
  });

  it("gère le periode=all", async () => {
    mockPrisma.paiement.findMany.mockResolvedValue(mockPaiements);
    mockPrisma.depense.findMany.mockResolvedValue([]);

    const res = await GET(makeReq("http://localhost/api/finances/comptabilite?periode=all"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.totalDepenses).toBe(0);
    expect(data.resultat).toBe(80000);
  });

  it("combine recettes et dépenses dans le journal", async () => {
    mockPrisma.paiement.findMany.mockResolvedValue(mockPaiements);
    mockPrisma.depense.findMany.mockResolvedValue(mockDepenses);

    const res = await GET(makeReq("http://localhost/api/finances/comptabilite"));
    const data = await res.json();

    const recettes = data.journal.filter((j: { type: string }) => j.type === "RECETTE");
    const depenses = data.journal.filter((j: { type: string }) => j.type === "DEPENSE");

    expect(recettes).toHaveLength(2);
    expect(depenses).toHaveLength(1);
    expect(depenses[0].categorie).toBe("Fournitures");
  });
});
