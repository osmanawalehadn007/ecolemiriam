import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Dépendances mockées (aucune base réelle, aucune écriture) ──────────
vi.mock("@/lib/prisma", () => ({
  default: {
    matiere: { findMany: vi.fn(async () => []) },
    site: { findMany: vi.fn(async () => [{ id: "site-a", nom: "Site A" }]) },
    classe: { findMany: vi.fn(async () => []) },
    auditLog: { findFirst: vi.fn(async () => null) },
    user: { findUnique: vi.fn(async () => null) },
  },
}));

vi.mock("@/lib/prisma-base", () => ({
  default: { user: { findMany: vi.fn(async () => []) } },
}));

vi.mock("@/lib/annee-scolaire", () => ({
  getAnneeCouranteLibelle: vi.fn(async () => "2026-2027"),
}));

// Le parsing Excel n'est pas le sujet ici : on isole le PÉRIMÈTRE.
vi.mock("@/lib/import-enseignants", () => ({
  parseEnseignantsWorkbook: vi.fn(async () => ({ rows: [], erreurs: [], hash: "hash-1" })),
  analyzeImport: vi.fn(() => ({
    hash: "hash-1",
    lignes: [],
    resume: { total: 0, aCreer: 0, aIgnorer: 0, erreurs: 0, matieresInconnues: 0, sitesInconnus: 0 },
    matieresInconnues: [],
    sitesInconnus: [],
  })),
}));

import prisma from "@/lib/prisma";
import { preparerPlan } from "@/lib/import-enseignants-server";

const mockPrisma = prisma as unknown as {
  site: { findMany: ReturnType<typeof vi.fn> };
  matiere: { findMany: ReturnType<typeof vi.fn> };
  classe: { findMany: ReturnType<typeof vi.fn> };
};

type Acteur = Parameters<typeof preparerPlan>[0];

/** Demandeur type, surchargeable par test. */
function acteur(over: Partial<Acteur> = {}): Acteur {
  return {
    id: "user-1",
    tenantId: "tenant-1",
    role: "ACCOUNTANT",
    siteId: null,
    siteIds: ["site-a"],
    tenantHasSites: true,
    ...over,
  } as Acteur;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("preparerPlan — périmètre de sites", () => {
  it("borne la liste des sites au périmètre d'un compte rattaché à un seul site", async () => {
    // Un comptable (parametres:write) ne doit pas pouvoir importer un
    // enseignant sur un autre site que le sien.
    await preparerPlan(acteur(), new ArrayBuffer(0));

    const args = mockPrisma.site.findMany.mock.calls.at(-1)?.[0];
    expect(args.where).toEqual({ tenantId: "tenant-1", id: { in: ["site-a"] } });
  });

  it("borne au site sélectionné quand la direction en a choisi un", async () => {
    await preparerPlan(acteur({ role: "TENANT_ADMIN", siteId: "site-b", siteIds: [] }), new ArrayBuffer(0));

    const args = mockPrisma.site.findMany.mock.calls.at(-1)?.[0];
    expect(args.where).toEqual({ tenantId: "tenant-1", id: { in: ["site-b"] } });
  });

  it("laisse un administrateur tenant-wide voir tous les sites", async () => {
    await preparerPlan(
      acteur({ role: "TENANT_ADMIN", siteId: null, siteIds: [] }),
      new ArrayBuffer(0),
    );

    const args = mockPrisma.site.findMany.mock.calls.at(-1)?.[0];
    expect(args.where).toEqual({ tenantId: "tenant-1" });
  });

  it("refuse (fail-closed) un compte sans rattachement de site", async () => {
    await expect(
      preparerPlan(acteur({ siteIds: [], tenantHasSites: true }), new ArrayBuffer(0)),
    ).rejects.toThrow(/rattaché à aucun site/);

    // Aucune liste de sites ne doit avoir été constituée.
    expect(mockPrisma.site.findMany).not.toHaveBeenCalled();
  });

  it("refuse un périmètre personnel (parent / élève)", async () => {
    await expect(
      preparerPlan(acteur({ role: "PARENT", siteIds: ["site-a"] }), new ArrayBuffer(0)),
    ).rejects.toThrow(/rattaché à aucun site/);
  });
});
