import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { FinanceView } from "@/components/finances/FinanceView";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock("./DepensesSection", () => ({ DepensesSection: () => null }));
vi.mock("./BudgetSection", () => ({ BudgetSection: () => null }));
vi.mock("./RemiseCaisseSection", () => ({ RemiseCaisseSection: () => null }));

const rendre = (recettesParMethode: unknown[], facturesPeriode: unknown[] = [], activeType = "recettes", resteAEncaisser = 20000, soldeCaisse = 80000) =>
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
      remisesCaisse={[]}
      activeSite="all"
      activePeriode="month"
      activeMonth={null}
      activeType={activeType}
      availableMonths={[]}
      siteColors={{}}
      currentSiteName="Campus"
      currentUser={{ id: "u1", role: "TENANT_ADMIN" }}
      sites={[]}
    />,
  );

describe("FinanceView — montants perçus", () => {
  it("affiche des indicateurs par moyen de paiement, sans liste de paiements", () => {
    rendre([
      { methode: "espèces", devise: "DJF", montant: 50000, nombre: 3 },
      { methode: "waffi", devise: "DJF", montant: 30000, nombre: 2 },
    ]);
    expect(screen.getByText("methodType_CASH")).toBeTruthy();
    expect(screen.getByText("methodType_MOBILE_MONEY")).toBeTruthy();
    expect(screen.queryByText("invoice")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
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
