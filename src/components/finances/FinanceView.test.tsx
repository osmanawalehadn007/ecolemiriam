import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FinanceView } from "@/components/finances/FinanceView";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock("./DepensesSection", () => ({ DepensesSection: () => null }));
vi.mock("./BudgetSection", () => ({ BudgetSection: () => null }));
vi.mock("./RemiseCaisseSection", () => ({ RemiseCaisseSection: () => null }));

const rendre = (recettesParMethode: unknown[], facturesPeriode: unknown[] = [], activeType = "recettes", resteAEncaisser = 20000, soldeCaisse = 80000, paiementsListe: unknown[] = [], activeMethode: string | null = null, activeJour: string | null = null) =>
  render(
    <FinanceView
      totalEncaisse={80000}
      totalFactures={100000}
      resteAEncaisser={resteAEncaisser}
      soldeCaisse={soldeCaisse}
      totalDepenses={0}
      cashPendingTotal={0}
      cashPending={[]}
      depenses={[]}
      budgets={[]}
      recettesParMethode={recettesParMethode}
      facturesPeriode={facturesPeriode}
      paiementsListe={paiementsListe as never}
      activeMethode={activeMethode}
      activeTri="date"
      remisesCaisse={[]}
      activeSite="all"
      activePeriode="month"
      activeMonth={null}
      activeJour={activeJour}
      activeType={activeType}
      availableMonths={[]}
      siteColors={{}}
      currentSiteName="Campus"
      currentUser={{ id: "u1", role: "TENANT_ADMIN" }}
      sites={[]}
    />,
  );

describe("FinanceView — montants perçus", () => {
  const paiement = (id: string, methode: string, montant: number) => ({
    id, montant, devise: "DJF", methode, reference: null, date: "2026-10-05T08:00:00Z",
    facture: { numero: `FAC-${id}`, site: null, eleve: { nom: "Diallo", prenom: "Awa" } },
    enregistrePar: null,
  });
  const recettes = [
    { methode: "espèces", devise: "DJF", montant: 50000, nombre: 3 },
    { methode: "waffi", devise: "DJF", montant: 30000, nombre: 2 },
  ];

  it("classe les paiements par type et par moyen précis, avec la liste", () => {
    rendre(recettes, [], "recettes", 20000, 80000, [paiement("1", "waffi", 30000), paiement("2", "espèces", 50000)]);
    expect(screen.getByText("methodType_CASH")).toBeTruthy();
    expect(screen.getByText("methodType_MOBILE_MONEY")).toBeTruthy();
    expect(screen.getByText(/^waffi · /)).toBeTruthy(); // puce du moyen précis
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByText("FAC-1")).toBeTruthy();
  });

  it("filtre par moyen précis ou par type au clic", () => {
    push.mockClear();
    rendre(recettes);
    fireEvent.click(screen.getByText(/^waffi · /));
    expect(push).toHaveBeenLastCalledWith("/finances?methode=waffi");
    fireEvent.click(screen.getByText("methodType_CASH"));
    expect(push).toHaveBeenLastCalledWith("/finances?methode=CASH");
  });

  it("choisir un jour précis remplace le mois et la période dans l'adresse", () => {
    push.mockClear();
    rendre(recettes);
    fireEvent.change(screen.getByLabelText("preciseDay"), { target: { value: "2026-10-05" } });
    expect(push).toHaveBeenLastCalledWith("/finances?jour=2026-10-05");
  });

  it("propose de réinitialiser le jour quand il est actif", () => {
    push.mockClear();
    rendre(recettes, [], "recettes", 0, 0, [], null, "2026-10-05");
    fireEvent.click(screen.getByText("resetDay"));
    expect(push).toHaveBeenLastCalledWith("/finances?");
  });

  it("indique l'absence de paiement", () => {
    rendre([]);
    expect(screen.getByText("noPayments")).toBeTruthy();
  });

  it("n'affiche plus la liste des factures émises : un bouton renvoie vers /facturation", () => {
    rendre([], [{ id: "f1", numero: "FAC-1", statut: "PAYEE", montant: 1000, devise: "DJF", paiements: [] }], "factures");
    expect(screen.queryByText("FAC-1")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("link", { name: /seeInvoicesDetail/ }).getAttribute("href")).toBe("/facturation");
  });

  it("signale que la carte Factures ne compte que les factures impayées ou réglées en espèces", () => {
    rendre([], [{ id: "f1", numero: "FAC-1", statut: "PAYEE", montant: 1000, devise: "DJF", paiements: [] }], "factures");
    expect(screen.getByText("cashOnlyHint")).toBeTruthy();
  });
});

describe("FinanceView — reste à encaisser et solde en caisse", () => {
  it("affiche les cinq cartes dans l'ordre", () => {
    rendre([], [], "all", 170250, 1735600);
    const libelles = ["totalInvoiced", "totalCollected", "totalRemaining", "totalExpenses", "cashBalance"].map((k) => screen.getByText(k));
    for (let i = 1; i < libelles.length; i++) {
      expect(libelles[i - 1].compareDocumentPosition(libelles[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(screen.queryByText("collectedExtra")).toBeNull();
  });
  it("remplace un reste négatif par « encaissé en plus », sans signe moins", () => {
    rendre([], [], "all", -12000, 22000);
    const carte = screen.getByText("collectedExtra").parentElement!;
    expect(screen.queryByText("totalRemaining")).toBeNull();
    expect(carte.textContent).toMatch(/12\s?000/);
    expect(carte.textContent).not.toMatch(/-/);
  });
  it("affiche un solde en caisse négatif avec son signe, en rouge", () => {
    rendre([], [], "all", 0, -2500);
    const montant = screen.getByText("cashBalance").nextElementSibling!;
    expect(montant.textContent).toMatch(/-/);
    expect(montant.className).toContain("text-red-600");
  });
});
