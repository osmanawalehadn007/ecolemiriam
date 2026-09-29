import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Dépendances mockées : aucune base, aucune requête réseau ──────────
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

vi.mock("@/lib/rbac", () => ({ checkPermission: vi.fn(() => null) }));

vi.mock("@/lib/prisma", () => ({
  default: {
    tarifNiveau: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    eleve: { findMany: vi.fn() },
    facture: { findMany: vi.fn() },
  },
  // L'action pose le contexte RLS puis appelle le cœur : on exécute le
  // callback, ce qui permet d'inspecter les paramètres reçus par le cœur.
  runWithTenant: vi.fn(
    async (_tenantId: string, _siteId: string | null, fn: () => Promise<unknown>) => fn(),
  ),
}));

vi.mock("@/lib/factures/mensualites", () => ({
  MOIS_NOMS: [
    "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
    "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
  ],
  genererMensualitesPourTenant: vi.fn(),
}));

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined), auditFire: vi.fn() }));
vi.mock("@/lib/notifications/whatsapp", () => ({ sendPaymentWhatsApp: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/rbac";
import { genererMensualitesPourTenant } from "@/lib/factures/mensualites";
import { genererMensualites } from "@/lib/actions/facturation-avancee";

const mockAuth = auth as ReturnType<typeof vi.fn>;
const mockPermission = checkPermission as ReturnType<typeof vi.fn>;
const mockCoeur = genererMensualitesPourTenant as ReturnType<typeof vi.fn>;

const RESULTAT = { generated: 559, skipped: 275, sansTarif: 0, montantTotal: 4_734_000 };

function session(role: string, siteIds: string[], siteId: string | null = null) {
  return { user: { id: "u1", tenantId: "t1", role, siteIds, siteId, tenantHasSites: true } };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPermission.mockReturnValue(null);
  mockCoeur.mockResolvedValue(RESULTAT);
});

describe("genererMensualites — bouton de l'écran Facturation", () => {
  it("refuse un compte sans droit d'écriture finance", async () => {
    mockPermission.mockReturnValue({ status: 403 });
    mockAuth.mockResolvedValue(session("TEACHER", ["site-a"]));

    await expect(genererMensualites({ mois: 9, annee: "2026-2027" })).rejects.toThrow("Accès refusé");
    expect(mockCoeur).not.toHaveBeenCalled();
  });

  it("borne la génération aux sites du demandeur (comptable mono-site)", async () => {
    // Avant : l'action chargeait tous les élèves du tenant — un comptable
    // rattaché à un site facturait les trois.
    mockAuth.mockResolvedValue(session("ACCOUNTANT", ["site-a"], "site-a"));

    await genererMensualites({ mois: 9, annee: "2026-2027" });

    expect(mockCoeur).toHaveBeenCalledTimes(1);
    const params = mockCoeur.mock.calls[0][0];
    expect(params.eleveWhere).toEqual({ AND: [{ siteId: { in: ["site-a"] } }] });
  });

  it("ne borne pas un administrateur tenant-wide", async () => {
    mockAuth.mockResolvedValue(session("TENANT_ADMIN", []));

    await genererMensualites({ mois: 9, annee: "2026-2027" });

    expect(mockCoeur.mock.calls[0][0].eleveWhere).toEqual({});
  });

  it("délègue au cœur canonique avec le mois, l'année et l'auteur", async () => {
    mockAuth.mockResolvedValue(session("ACCOUNTANT", ["site-a"], "site-a"));

    await genererMensualites({ mois: 10, annee: "2026-2027", inclureCantine: true, inclureTransport: false });

    expect(mockCoeur.mock.calls[0][0]).toMatchObject({
      tenantId: "t1",
      mois: 10,
      annee: "2026-2027",
      inclureCantine: true,
      inclureTransport: false,
      acteurId: "u1",
    });
  });

  it("remonte les compteurs du cœur, y compris les élèves sans tarif", async () => {
    mockAuth.mockResolvedValue(session("ACCOUNTANT", ["site-a"], "site-a"));

    const resultat = await genererMensualites({ mois: 9, annee: "2026-2027" });

    expect(resultat).toEqual({ success: true, ...RESULTAT });
  });

  it("refuse un appelant sans session", async () => {
    mockAuth.mockResolvedValue(null);
    await expect(genererMensualites({ mois: 9, annee: "2026-2027" })).rejects.toThrow("Non autorisé");
  });
});
