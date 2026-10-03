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

const rendre = (recettesParMethode: unknown[], facturesPeriode: unknown[] = [], activeType = "recettes", resultatNet = -20000) =>
  render(
    <FinanceView
      totalEncaisse={80000}
      totalFactures={100000}
      resultatNet={resultatNet}
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

describe("FinanceView — carte de résultat", () => {
  it("choisit le libellé selon le signe et place le résultat en dernier", () => {
    rendre([], [], "all", 4500);
    expect(screen.getByText("resultSurplus")).toBeTruthy();
    expect(screen.queryByText("resultShortfall")).toBeNull();
    const libelles = ["totalInvoiced", "totalCollected", "totalExpenses", "resultSurplus"].map((k) => screen.getByText(k));
    for (let i = 1; i < libelles.length; i++) {
      expect(libelles[i - 1].compareDocumentPosition(libelles[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });
  it("affiche un manque à encaisser, sans signe moins, quand le résultat est négatif", () => {
    rendre([], [], "all", -15000);
    expect(screen.getByText("resultShortfall")).toBeTruthy();
    expect(screen.queryByText(/-\s?15/)).toBeNull();
  });
  it("affiche l'équilibre à zéro", () => {
    rendre([], [], "all", 0);
    expect(screen.getByText("resultBalanced")).toBeTruthy();
  });
});
