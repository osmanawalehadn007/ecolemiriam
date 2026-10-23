import { describe, it, expect } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { JourneeSection } from "./JourneeSection";

const fmt = (n: number) => `${n} DJF`;
// Heure de Djibouti = UTC+3 : 08:00 UTC = 11:00 (matin) ; 10:30 UTC = 13:30 (après-midi)
const paiement = (id: string, utc: string, montant: number) => ({
  id, montant, devise: "DJF", methode: "espèces", reference: null, date: `2026-10-05T${utc}Z`,
  facture: { numero: `FAC-${id}`, eleve: { nom: "Diallo", prenom: "Awa" } },
  enregistrePar: { name: "Caissier" },
});
const depense = (id: string, utc: string, montant: number) => ({
  id, categorie: "Fournitures", description: null, montant, devise: "DJF", date: `2026-10-05T${utc}Z`, createdBy: { name: "Directeur" },
});

describe("JourneeSection", () => {
  it("sépare matin (< 13 h) et après-midi (≥ 13 h) et calcule les trois soldes", () => {
    render(
      <JourneeSection
        currency="DJF"
        formatMontant={fmt}
        paiements={[paiement("1", "08:00:00", 10000), paiement("2", "09:59:59", 5000), paiement("3", "10:00:00", 20000)]}
        depenses={[depense("d1", "07:00:00", 3000), depense("d2", "12:00:00", 4000)]}
      />,
    );
    // Repliées par défaut : seuls les totaux sont visibles.
    expect(screen.queryByText("FAC-1")).toBeNull();
    document.querySelectorAll("[data-moment] button").forEach((b) => fireEvent.click(b));
    const matin = document.querySelector('[data-moment="matin"]') as HTMLElement;
    const aprem = document.querySelector('[data-moment="apres_midi"]') as HTMLElement;
    expect(within(matin).getByText("FAC-1")).toBeTruthy();
    expect(within(matin).getByText("FAC-2")).toBeTruthy(); // 12:59:59 = encore le matin
    expect(within(matin).queryByText("FAC-3")).toBeNull();
    expect(within(aprem).getByText("FAC-3")).toBeTruthy(); // 13:00:00 = après-midi

    // matin : 15000 − 3000 = 12000 ; après-midi : 20000 − 4000 = 16000 ; jour : 28000
    expect(document.querySelector('[data-solde="matin"]')!.textContent).toContain("12000 DJF");
    expect(document.querySelector('[data-solde="apres_midi"]')!.textContent).toContain("16000 DJF");
    expect(document.querySelector('[data-solde="jour"]')!.textContent).toContain("28000 DJF");
  });

  it("affiche d'abord les totaux de chaque demi-journée, le détail seulement au clic", () => {
    render(<JourneeSection currency="DJF" formatMontant={fmt} paiements={[paiement("1", "08:00:00", 10000), paiement("3", "11:00:00", 2000)]} depenses={[depense("d1", "07:00:00", 3000)]} />);
    const matin = document.querySelector('[data-moment="matin"]') as HTMLElement;
    const aprem = document.querySelector('[data-moment="apres_midi"]') as HTMLElement;
    expect(matin.textContent).toContain("10000 DJF");
    expect(matin.textContent).toContain("3000 DJF");
    expect(within(matin).queryByRole("table")).toBeNull();
    fireEvent.click(within(matin).getByRole("button"));
    expect(within(matin).getAllByRole("table").length).toBe(2);
    expect(within(aprem).queryByRole("table")).toBeNull(); // l'après-midi reste replié
    fireEvent.click(within(matin).getByRole("button"));
    expect(within(matin).queryByRole("table")).toBeNull();
  });

  it("une dépense supérieure aux encaissements donne un solde négatif en rouge", () => {
    render(<JourneeSection currency="DJF" formatMontant={fmt} paiements={[]} depenses={[depense("d1", "08:00:00", 7000)]} />);
    const solde = document.querySelector('[data-solde="matin"]')!;
    expect(solde.textContent).toContain("-7000 DJF");
    expect(solde.querySelector("p.text-red-600")).toBeTruthy();
  });

  it("affiche la date sur une ligne et l'heure sur la suivante", () => {
    render(<JourneeSection currency="DJF" formatMontant={fmt} paiements={[paiement("1", "08:00:00", 1000)]} depenses={[]} />);
    fireEvent.click(within(document.querySelector('[data-moment="matin"]') as HTMLElement).getByRole("button"));
    expect(screen.getByText("05/10/2026")).toBeTruthy();
    expect(screen.getByText("11:00:00")).toBeTruthy();
  });
});
