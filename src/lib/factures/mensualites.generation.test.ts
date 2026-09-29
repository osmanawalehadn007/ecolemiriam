import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    eleve: { findMany: vi.fn() },
    tarifNiveau: { findMany: vi.fn() },
    facture: { findMany: vi.fn(), count: vi.fn(), create: vi.fn() },
    // La numérotation passe par la fonction SQL atomique `next_facture_numeros`
    // (src/lib/facture-numero.ts) : on simule la réservation d'un bloc.
    $queryRaw: vi.fn(),
  },
}));

import prisma from "@/lib/prisma";
import {
  genererMensualitesPourTenant,
  moisKey,
  estViolationUnicite,
} from "@/lib/factures/mensualites";

const mockPrisma = prisma as unknown as {
  eleve: { findMany: ReturnType<typeof vi.fn> };
  tarifNiveau: { findMany: ReturnType<typeof vi.fn> };
  facture: {
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  $queryRaw: ReturnType<typeof vi.fn>;
};

/** Erreur Prisma de violation d'unicité (index partiel mensuel). */
function erreurP2002() {
  return Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
}

const ELEVE = {
  id: "e1",
  siteId: "site1",
  classe: { niveau: "1", nom: "1ère Année A", annee: "2026-2027" },
};

const TARIF = {
  niveau: "1ère",
  siteId: null,
  annee: "2026-2027",
  mensualite: 7000,
  fraisInscription: 2000,
  fraisRenouvellement: 2000,
  fraisCantine: null,
  fraisTransport: null,
  devise: "DJF",
  nbMois: 10,
  actif: true,
};

const PARAMS = {
  tenantId: "t1",
  mois: 10,
  annee: "2026-2027",
  acteurId: null,
};

describe("genererMensualitesPourTenant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.eleve.findMany.mockResolvedValue([ELEVE]);
    mockPrisma.tarifNiveau.findMany.mockResolvedValue([TARIF]);
    mockPrisma.facture.findMany.mockResolvedValue([]);
    mockPrisma.facture.count.mockResolvedValue(0);
    mockPrisma.$queryRaw.mockResolvedValue([{ premier: 1 }]);
    mockPrisma.facture.create.mockResolvedValue({ id: "f1" });
  });

  it("crée la mensualité avec le type et le mois structurés", async () => {
    const resultat = await genererMensualitesPourTenant(PARAMS);

    expect(resultat.generated).toBe(1);
    expect(resultat.montantTotal).toBe(7000);
    const data = mockPrisma.facture.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      tenantId: "t1",
      eleveId: "e1",
      siteId: "site1",
      libelle: "Scolarité Octobre 2026-2027",
      montant: 7000,
      devise: "DJF",
      statut: "EN_ATTENTE",
      type: "MENSUALITE",
      mois: "2026-10",
      createdById: null,
    });
  });

  it("en mode aperçu, compte ce qui serait créé sans rien écrire", async () => {
    const resultat = await genererMensualitesPourTenant({ ...PARAMS, dryRun: true });

    // Les compteurs sont ceux de la génération réelle…
    expect(resultat.generated).toBe(1);
    expect(resultat.montantTotal).toBe(7000);
    // …mais AUCUNE écriture : ni facture, ni réservation de numéro.
    expect(mockPrisma.facture.create).not.toHaveBeenCalled();
    expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("ne recrée pas un mois déjà facturé (parent ayant payé d'avance)", async () => {
    // Le mois existe déjà, quelle que soit sa convention de libellé.
    mockPrisma.facture.findMany.mockResolvedValue([{ eleveId: "e1" }]);

    const resultat = await genererMensualitesPourTenant(PARAMS);

    expect(resultat.generated).toBe(0);
    expect(resultat.skipped).toBe(1);
    expect(mockPrisma.facture.create).not.toHaveBeenCalled();
    // Le contrôle porte sur le mois structuré (mensualité ET inscription), et
    // sur les libellés — y compris les variantes « + Frais … ».
    const where = mockPrisma.facture.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([
      { type: "MENSUALITE", mois: "2026-10" },
      { type: "INSCRIPTION", mois: "2026-10" },
      {
        libelle: {
          in: [
            "Scolarité Octobre 2026-2027",
            "Scolarité Octobre 2026",
            "Scolarité Octobre 2026-2027 + Frais d'inscription",
            "Scolarité Octobre 2026-2027 + Frais de réinscription",
            "Scolarité Octobre 2026-2027 + Frais d'inscription + Frais de réinscription",
            "Scolarité Octobre 2026 + Frais d'inscription",
            "Scolarité Octobre 2026 + Frais de réinscription",
            "Scolarité Octobre 2026 + Frais d'inscription + Frais de réinscription",
          ],
        },
      },
    ]);
    expect(where.statut).toEqual({ not: "ANNULEE" });
  });

  it("ne facture pas la mensualité d'un élève déjà facturé à l'inscription du mois", async () => {
    // Le flux d'admission écrit « Frais d'inscription + Scolarité Septembre »
    // dans UNE facture (type=INSCRIPTION, mois=2026-09). La requête de
    // dédoublonnage doit donc interroger les deux types.
    mockPrisma.eleve.findMany.mockResolvedValue([
      { ...ELEVE, classe: { niveau: "1ère", nom: "1ère Année A", annee: "2026-2027" } },
    ]);
    mockPrisma.facture.findMany.mockResolvedValue([{ eleveId: "e1" }]);

    const resultat = await genererMensualitesPourTenant({ ...PARAMS, mois: 9 });

    expect(resultat.generated).toBe(0);
    expect(resultat.skipped).toBe(1);
    expect(mockPrisma.facture.create).not.toHaveBeenCalled();

    const where = mockPrisma.facture.findMany.mock.calls[0][0].where;
    expect(where.OR).toContainEqual({ type: "INSCRIPTION", mois: "2026-09" });
  });

  it("n'ajoute AUCUN frais de rentrée si l'appelant ne les demande pas", async () => {
    mockPrisma.eleve.findMany.mockResolvedValue([
      { ...ELEVE, classe: { niveau: "1ère", nom: "1ère Année A", annee: "2026-2027" } },
    ]);

    const resultat = await genererMensualitesPourTenant({ ...PARAMS, mois: 9 });

    expect(resultat.montantTotal).toBe(7000);
    expect(mockPrisma.facture.create.mock.calls[0][0].data.libelle).toBe(
      "Scolarité Septembre 2026-2027"
    );
  });

  it("ajoute les frais de rentrée demandés, en septembre seulement", async () => {
    mockPrisma.eleve.findMany.mockResolvedValue([
      { ...ELEVE, classe: { niveau: "1ère", nom: "1ère Année A", annee: "2026-2027" } },
    ]);

    const resultat = await genererMensualitesPourTenant({
      ...PARAMS,
      mois: 9,
      inclureFraisInscription: true,
      inclureFraisRenouvellement: true,
    });

    // 7 000 de mensualité + 2 000 d'inscription + 2 000 de réinscription.
    expect(resultat.montantTotal).toBe(11000);
    expect(mockPrisma.facture.create.mock.calls[0][0].data).toMatchObject({
      montant: 11000,
      libelle:
        "Scolarité Septembre 2026-2027 + Frais d'inscription + Frais de réinscription",
      type: "MENSUALITE",
      mois: "2026-09",
    });
  });

  it("ignore les frais de rentrée pour un autre mois que septembre", async () => {
    mockPrisma.eleve.findMany.mockResolvedValue([
      { ...ELEVE, classe: { niveau: "1ère", nom: "1ère Année A", annee: "2026-2027" } },
    ]);

    const resultat = await genererMensualitesPourTenant({
      ...PARAMS,
      mois: 11,
      inclureFraisInscription: true,
      inclureFraisRenouvellement: true,
    });

    expect(resultat.montantTotal).toBe(7000);
    expect(mockPrisma.facture.create.mock.calls[0][0].data.libelle).toBe(
      "Scolarité Novembre 2026-2027"
    );
  });

  it("encaisse une violation d'unicité comme un doublon, sans échouer", async () => {
    // Cas de deux exécutions concurrentes : la base refuse la seconde.
    mockPrisma.facture.create.mockRejectedValue(erreurP2002());

    const resultat = await genererMensualitesPourTenant(PARAMS);

    expect(resultat.generated).toBe(0);
    expect(resultat.skipped).toBe(1);
  });

  it("propage les erreurs qui ne sont pas des doublons", async () => {
    mockPrisma.facture.create.mockRejectedValue(new Error("Base indisponible"));

    await expect(genererMensualitesPourTenant(PARAMS)).rejects.toThrow("Base indisponible");
  });

  it("ignore un élève sans tarif pour son niveau", async () => {
    mockPrisma.eleve.findMany.mockResolvedValue([
      { ...ELEVE, classe: { niveau: "5", nom: "5ème Année A", annee: "2026-2027" } },
    ]);

    const resultat = await genererMensualitesPourTenant(PARAMS);

    expect(resultat.generated).toBe(0);
    expect(resultat.sansTarif).toBe(1);
    expect(mockPrisma.facture.create).not.toHaveBeenCalled();
  });

  it("refuse un mois hors bornes", async () => {
    await expect(genererMensualitesPourTenant({ ...PARAMS, mois: 13 })).rejects.toThrow(
      "Mois invalide"
    );
  });
});

describe("moisKey / estViolationUnicite", () => {
  it("construit la clé de mois au format AAAA-MM", () => {
    expect(moisKey(10, "2026-2027")).toBe("2026-10");
    expect(moisKey(1, "2026-2027")).toBe("2026-01");
    expect(moisKey(9, "2026")).toBe("2026-09");
  });

  it("reconnaît une violation d'unicité Prisma", () => {
    expect(estViolationUnicite(erreurP2002())).toBe(true);
    expect(estViolationUnicite(new Error("autre"))).toBe(false);
    expect(estViolationUnicite(null)).toBe(false);
  });
});
