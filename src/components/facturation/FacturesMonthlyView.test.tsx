import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FacturesMonthlyView } from "@/components/facturation/FacturesMonthlyView";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

function facture(i: number, statut: "PAYEE" | "EN_ATTENTE") {
  return {
    id: `f${i}`,
    numero: `FAC-${i}`,
    libelle: "Scolarité",
    montant: 1000,
    devise: "DJF",
    statut,
    echeance: null,
    createdAt: new Date("2026-10-01"),
    mois: "2026-10",
    eleve: {
      id: `e${i}`, nom: "N", prenom: "P", matricule: `M${i}`, classeId: "c1",
      classe: { nom: "3ème Année B", niveau: "3ème", structure: { type: "PRIMAIRE" } },
    },
    candidature: null,
    paiements: [],
    relances: [],
    createdBy: null,
  };
}

const rendre = (n: number) => render(<FacturesMonthlyView factures={Array.from({ length: n }, (_, i) => facture(i, i < 2 ? "PAYEE" : "EN_ATTENTE")) as any} userRole="TENANT_ADMIN" />);

describe("FacturesMonthlyView — rangement au-delà de 30 factures", () => {
  it("affiche les catégories quand le mois dépasse 30 factures", () => {
    rendre(31);
    fireEvent.click(screen.getByText(/octobre 2026/i));
    expect(screen.getByText("categoryPrimaire")).toBeTruthy();
    expect(screen.queryByText("FAC-0")).toBeNull();
  });

  it("garde le tableau à plat jusqu'à 30 factures", () => {
    rendre(30);
    fireEvent.click(screen.getByText(/octobre 2026/i));
    expect(screen.getByText("FAC-0")).toBeTruthy();
    expect(screen.queryByText("categoryPrimaire")).toBeNull();
  });
});
