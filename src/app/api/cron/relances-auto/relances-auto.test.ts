import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  default: {
    // Le cron traite chaque établissement dans son contexte RLS.
    tenant: { findMany: vi.fn().mockResolvedValue([{ id: "t1", name: "Ecole Test" }]) },
    facture: { findMany: vi.fn(), update: vi.fn() },
    relance: { create: vi.fn() },
  },
  runWithTenant: (_tenantId: string, _siteId: string | null, fn: () => Promise<unknown>) => fn(),
}));
vi.mock("@/lib/sms/africasTalking", () => ({
  sendSMS: vi.fn().mockResolvedValue({ success: true, sent: 1 }),
}));
vi.mock("@/lib/notifications/email", () => ({
  sendEmail: vi.fn().mockResolvedValue({ success: true, sent: 1 }),
  renderNotificationEmail: vi.fn().mockReturnValue("<html>test</html>"),
}));

import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { sendSMS } from "@/lib/sms/africasTalking";

const mockPrisma = prisma as unknown as {
  facture: { findMany: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  relance: { create: ReturnType<typeof vi.fn> };
};

// Importer le handler après les mocks
const { GET, POST } = await import("@/app/api/cron/relances-auto/route");

function makeReq(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("http://localhost/api/cron/relances-auto", { headers });
}

describe("Cron relances-auto", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "test-secret";
    // SMS envoyé seulement si Africa's Talking est configuré.
    process.env.AT_API_KEY = "test-key";
    process.env.AT_USERNAME = "test-user";
  });

  it("n'envoie pas de SMS quand Africa's Talking n'est pas configuré", async () => {
    delete process.env.AT_API_KEY;
    mockPrisma.facture.findMany.mockResolvedValueOnce([{
      id: "f3", tenantId: "t1", statut: "EN_ATTENTE",
      echeance: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      montant: 1000, numero: "FAC-003",
      eleve: { id: "e3", nom: "Doe", prenom: "J", parents: [{ parent: { id: "p", nom: "D", prenom: "P", phone: "+253", email: null } }] },
      tenant: { id: "t1", name: "Ecole Test" }, relances: [],
    }]).mockResolvedValue([]);
    await GET(makeReq({ authorization: "Bearer test-secret" }));
    expect(sendSMS).not.toHaveBeenCalled();
    expect(mockPrisma.relance.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ canal: "courrier" }) })
    );
  });

  it("rejette sans CRON_SECRET", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(makeReq({ authorization: "Bearer test-secret" }));
    expect(res.status).toBe(401);
  });

  it("rejette avec un mauvais secret", async () => {
    const res = await GET(makeReq({ authorization: "Bearer wrong" }));
    expect(res.status).toBe(401);
  });

  it("accepte avec le bon secret", async () => {
    mockPrisma.facture.findMany.mockResolvedValue([]);
    const res = await GET(makeReq({ authorization: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.processed).toBe(0);
  });

  it("détecte les factures en retard et envoie des relances", async () => {
    const factureMock = {
      id: "f1",
      tenantId: "t1",
      statut: "EN_ATTENTE",
      echeance: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // J+5
      montant: 50000,
      numero: "FAC-001",
      eleve: {
        id: "e1",
        nom: "Doe",
        prenom: "John",
        parents: [
          {
            parent: {
              id: "p1",
              nom: "Doe",
              prenom: "Parent",
              phone: "+1234567890",
              email: "parent@test.com",
            },
          },
        ],
      },
      tenant: { id: "t1", name: "Ecole Test" },
      relances: [], // aucune relance précédente
    };
    mockPrisma.facture.findMany.mockResolvedValue([factureMock]);
    mockPrisma.relance.create.mockResolvedValue({ id: "r1" });
    mockPrisma.facture.update.mockResolvedValue({});

    const res = await GET(makeReq({ authorization: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    const data = await res.json();

    // Niveau 1 (J+3) doit être détecté
    expect(data.processed).toBeGreaterThan(0);
    expect(data.sent).toBeGreaterThan(0);

    // Vérifier que sendSMS a été appelé
    expect(sendSMS).toHaveBeenCalled();

    // Vérifier que la relance a été enregistrée
    expect(mockPrisma.relance.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          factureId: "f1",
          niveau: 1,
        }),
      })
    );

    // Vérifier que la facture a été marquée EN_RETARD
    expect(mockPrisma.facture.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "f1" },
        data: { statut: "EN_RETARD" },
      })
    );
  });

  it("ne re-relance pas une facture déjà relancée au même niveau", async () => {
    const factureMock = {
      id: "f2",
      tenantId: "t1",
      statut: "EN_RETARD",
      echeance: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      montant: 30000,
      numero: "FAC-002",
      eleve: {
        id: "e2",
        nom: "Smith",
        prenom: "Jane",
        parents: [],
      },
      tenant: { id: "t1", name: "Ecole Test" },
      relances: [{ id: "r1", niveau: 1 }], // déjà relancée niveau 1
    };
    // Retourne la facture pour le palier 1 (J+3), vide pour les autres
    let callCount = 0;
    mockPrisma.facture.findMany.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve([factureMock]);
      return Promise.resolve([]);
    });

    const res = await GET(makeReq({ authorization: "Bearer test-secret" }));
    const data = await res.json();
    // Pas de nouvelle relance niveau 1
    expect(data.processed).toBe(0);
  });

  it("gère le POST comme le GET", async () => {
    mockPrisma.facture.findMany.mockResolvedValue([]);
    const res = await POST(makeReq({ authorization: "Bearer test-secret" }));
    expect(res.status).toBe(200);
  });
});
