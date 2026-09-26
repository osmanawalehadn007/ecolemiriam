import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    facture: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
    tenant: { findFirst: vi.fn() },
    anneesScolaires: { findFirst: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}));

vi.mock("@/lib/notifications/email", () => ({
  sendEmail: vi.fn(),
  renderNotificationEmail: vi.fn(() => "<html></html>"),
}));

import prisma from "@/lib/prisma";
import { sendEmail, renderNotificationEmail } from "@/lib/notifications/email";
import { alerterImpayes, getImpayesStats } from "@/lib/factures/impayes";
import { libelleMensualite } from "@/lib/factures/mensualites";

const mockPrisma = prisma as unknown as {
  facture: { findMany: ReturnType<typeof vi.fn> };
  user: { findMany: ReturnType<typeof vi.fn> };
  tenant: { findFirst: ReturnType<typeof vi.fn> };
  anneesScolaires: { findFirst: ReturnType<typeof vi.fn> };
  auditLog: { create: ReturnType<typeof vi.fn> };
};
const mockSendEmail = sendEmail as unknown as ReturnType<typeof vi.fn>;

/** Facture impayée minimale (aucun paiement). */
function facture(montant: number, echeance: Date | null, eleveId = "e1") {
  return { id: `f-${eleveId}-${montant}`, eleveId, montant, devise: "DJF", echeance, paiements: [] };
}

const REFERENCE = new Date("2026-09-15T08:00:00.000Z"); // 15 septembre 2026

describe("getImpayesStats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("agrège le reste à recouvrer et les retards", async () => {
    mockPrisma.facture.findMany.mockResolvedValue([
      facture(7000, new Date("2026-09-30")), // à échéance, non payée
      { ...facture(12000, new Date("2026-01-31"), "e2"), paiements: [{ montant: 2000 }] }, // en retard
    ]);

    const stats = await getImpayesStats({ tenantId: "t1" });

    expect(stats.nbFactures).toBe(2);
    expect(stats.nbEleves).toBe(2);
    expect(stats.montantTotal).toBe(19000);
    expect(stats.montantEncaisse).toBe(2000);
    expect(stats.montantRestant).toBe(17000);
    expect(stats.devise).toBe("DJF");
  });

  it("renvoie un indicateur vide sans impayé", async () => {
    mockPrisma.facture.findMany.mockResolvedValue([]);
    const stats = await getImpayesStats({ tenantId: "t1" });
    expect(stats.nbFactures).toBe(0);
    expect(stats.montantRestant).toBe(0);
  });
});

describe("alerterImpayes", () => {
  const ENV_INITIAL = process.env.ALERTE_IMPAYES_DESTINATAIRES;

  beforeEach(() => {
    vi.clearAllMocks();
    // Année active inconnue → repli sur l'année scolaire déduite de la date.
    mockPrisma.anneesScolaires.findFirst.mockResolvedValue(null);
    mockPrisma.tenant.findFirst.mockResolvedValue({ name: "École Miriam" });
    mockPrisma.user.findMany.mockResolvedValue([
      { id: "u1", name: "Direction", email: "direction@ecolemiriam.com" },
      { id: "u2", name: "Gestion", email: "gestion@ecolemiriam.com" },
    ]);
    mockSendEmail.mockResolvedValue({ success: true, sent: 3 });
    process.env.ALERTE_IMPAYES_DESTINATAIRES = "ahdimounomar@gmail.com";
  });

  afterEach(() => {
    if (ENV_INITIAL === undefined) delete process.env.ALERTE_IMPAYES_DESTINATAIRES;
    else process.env.ALERTE_IMPAYES_DESTINATAIRES = ENV_INITIAL;
  });

  it("n'envoie RIEN quand le mois en cours est entièrement encaissé", async () => {
    // 1er appel = impayés du mois, 2e = tous les impayés.
    mockPrisma.facture.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const resultat = await alerterImpayes({ tenantId: "t1", reference: REFERENCE });

    expect(resultat.alerteEnvoyee).toBe(false);
    expect(resultat.emailEnvoye).toBe(false);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("n'alerte pas si seuls des mois PASSÉS restent impayés", async () => {
    mockPrisma.facture.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([facture(7000, new Date("2026-08-31"))]);

    const resultat = await alerterImpayes({ tenantId: "t1", reference: REFERENCE });

    expect(resultat.alerteEnvoyee).toBe(false);
    expect(resultat.statsMois.nbFactures).toBe(0);
    expect(resultat.statsGlobal.nbFactures).toBe(1);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("alerte le responsable quand le mois en cours reste impayé", async () => {
    const impayesMois = [facture(7000, new Date("2026-09-30"), "e1"), facture(10000, new Date("2026-09-30"), "e2")];
    mockPrisma.facture.findMany
      .mockResolvedValueOnce(impayesMois)
      .mockResolvedValueOnce(impayesMois);

    const resultat = await alerterImpayes({ tenantId: "t1", reference: REFERENCE });

    expect(resultat.libelleMois).toBe(libelleMensualite(9, "2026-2027"));
    expect(resultat.alerteEnvoyee).toBe(true);
    expect(resultat.emailEnvoye).toBe(true);
    expect(resultat.statsMois.montantRestant).toBe(17000);
    // Les 2 responsables + Mme Mouna Mohamed (variable d'environnement).
    expect(resultat.destinataires).toEqual([
      "direction@ecolemiriam.com",
      "gestion@ecolemiriam.com",
      "ahdimounomar@gmail.com",
    ]);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    // Le corps de l'e-mail est construit à partir des montants calculés.
    const [ecoleNom, sujet, contenu] = (renderNotificationEmail as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    // `Intl.NumberFormat` sépare les milliers par une espace fine insécable.
    const contenuLisible = String(contenu).replace(/[\u202f\u00a0]/g, " ");
    expect(ecoleNom).toBe("École Miriam");
    expect(sujet).toContain("Septembre");
    expect(contenuLisible).toContain("17 000");
    expect(contenuLisible).toContain(libelleMensualite(9, "2026-2027"));
  });

  it("n'envoie pas en mode simulation (dry-run)", async () => {
    const impayesMois = [facture(7000, new Date("2026-09-30"))];
    mockPrisma.facture.findMany
      .mockResolvedValueOnce(impayesMois)
      .mockResolvedValueOnce(impayesMois);

    const resultat = await alerterImpayes({ tenantId: "t1", reference: REFERENCE, sansEnvoi: true });

    expect(resultat.alerteEnvoyee).toBe(false);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});
