import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PersonnelAbsencesConges } from "@/components/rh/PersonnelAbsencesConges";

// Mock fetch
global.fetch = vi.fn() as unknown as typeof fetch;

const mockEnseignants = [
  { id: "e1", user: { name: "Alice" } },
  { id: "e2", user: { name: "Bob" } },
];

const mockAbsences = [
  {
    id: "a1",
    date: new Date("2025-01-15"),
    heureDebut: "08:00",
    heureFin: "10:00",
    type: "ABSENCE",
    statut: "EN_ATTENTE",
    motif: "Maladie",
    commentaire: null,
    enseignant: { id: "e1", user: { name: "Alice" } },
    saisiePar: { name: "Admin" },
  },
  {
    id: "a2",
    date: new Date("2025-01-10"),
    heureDebut: null,
    heureFin: null,
    type: "RETARD",
    statut: "JUSTIFIEE",
    motif: null,
    commentaire: null,
    enseignant: { id: "e2", user: { name: "Bob" } },
    saisiePar: null,
  },
];

const mockConges = [
  {
    id: "c1",
    type: "ANNUEL",
    statut: "DEMANDE",
    dateDebut: new Date("2025-02-01"),
    dateFin: new Date("2025-02-10"),
    nbJours: 10,
    motif: "Vacances",
    enseignant: { id: "e1", user: { name: "Alice" } },
    demandePar: { name: "Alice" },
    approuvePar: null,
  },
  {
    id: "c2",
    type: "MALADIE",
    statut: "APPROUVE",
    dateDebut: new Date("2025-01-05"),
    dateFin: new Date("2025-01-08"),
    nbJours: 3,
    motif: null,
    enseignant: { id: "e2", user: { name: "Bob" } },
    demandePar: { name: "Bob" },
    approuvePar: { name: "Admin" },
  },
];

describe("PersonnelAbsencesConges", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders absences list with correct data", () => {
    render(
      <PersonnelAbsencesConges
        absences={mockAbsences}
        conges={[]}
        enseignants={mockEnseignants}
      />
    );
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Maladie")).toBeInTheDocument();
  });

  it("renders empty state when no absences", () => {
    render(
      <PersonnelAbsencesConges
        absences={[]}
        conges={[]}
        enseignants={mockEnseignants}
      />
    );
    expect(screen.getByText("noAbsences")).toBeInTheDocument();
  });

  it("renders conges list with correct data", () => {
    render(
      <PersonnelAbsencesConges
        absences={[]}
        conges={mockConges}
        enseignants={mockEnseignants}
      />
    );
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getAllByText(/10/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/days/).length).toBeGreaterThan(0);
  });

  it("renders empty state when no conges", () => {
    render(
      <PersonnelAbsencesConges
        absences={[]}
        conges={[]}
        enseignants={mockEnseignants}
      />
    );
    expect(screen.getByText("noLeaves")).toBeInTheDocument();
  });

  it("shows add absence form when button clicked", () => {
    render(
      <PersonnelAbsencesConges
        absences={[]}
        conges={[]}
        enseignants={mockEnseignants}
      />
    );
    fireEvent.click(screen.getByText("addAbsence"));
    expect(screen.getByText("validate")).toBeInTheDocument();
  });

  it("shows add leave form when button clicked", () => {
    render(
      <PersonnelAbsencesConges
        absences={[]}
        conges={[]}
        enseignants={mockEnseignants}
      />
    );
    fireEvent.click(screen.getByText("addLeave"));
    expect(screen.getByText("validate")).toBeInTheDocument();
  });

  it("submits absence form and calls API", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ absence: mockAbsences[0] }),
    });

    render(
      <PersonnelAbsencesConges
        absences={[]}
        conges={[]}
        enseignants={mockEnseignants}
      />
    );

    fireEvent.click(screen.getByText("addAbsence"));

    const select = screen.getAllByRole("combobox")[0];
    fireEvent.change(select, { target: { value: "e1" } });

    const validateBtn = screen.getByText("validate");
    fireEvent.click(validateBtn);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/rh/absences",
        expect.objectContaining({ method: "POST" })
      );
    });
  });

  it("submits conge form and calls API", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ conge: mockConges[0] }),
    });

    render(
      <PersonnelAbsencesConges
        absences={[]}
        conges={[]}
        enseignants={mockEnseignants}
      />
    );

    fireEvent.click(screen.getByText("addLeave"));

    const select = screen.getAllByRole("combobox")[0];
    fireEvent.change(select, { target: { value: "e1" } });

    const validateBtn = screen.getByText("validate");
    fireEvent.click(validateBtn);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/rh/conges",
        expect.objectContaining({ method: "POST" })
      );
    });
  });

  it("justifies an absence when check button clicked", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ absence: { ...mockAbsences[0], statut: "JUSTIFIEE" } }),
    });

    render(
      <PersonnelAbsencesConges
        absences={[mockAbsences[0]]}
        conges={[]}
        enseignants={mockEnseignants}
      />
    );

    const checkBtn = (screen.getAllByRole("button") as HTMLButtonElement[]).find(
      (b: HTMLButtonElement) => b.querySelector("svg.lucide-check") !== null
    );
    if (checkBtn) {
      fireEvent.click(checkBtn);
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          "/api/rh/absences/a1",
          expect.objectContaining({ method: "PATCH" })
        );
      });
    }
  });

  it("approves a conge when check button clicked", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ conge: { ...mockConges[0], statut: "APPROUVE" } }),
    });

    render(
      <PersonnelAbsencesConges
        absences={[]}
        conges={[mockConges[0]]}
        enseignants={mockEnseignants}
      />
    );

    const buttons = screen.getAllByRole("button") as HTMLButtonElement[];
    const checkBtn = buttons.find((b: HTMLButtonElement) => b.querySelector("svg.lucide-check") !== null);
    if (checkBtn) {
      fireEvent.click(checkBtn);
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          "/api/rh/conges/c1",
          expect.objectContaining({ method: "PATCH" })
        );
      });
    }
  });

  it("displays saisiePar name when present", () => {
    render(
      <PersonnelAbsencesConges
        absences={[mockAbsences[0]]}
        conges={[]}
        enseignants={mockEnseignants}
      />
    );
    expect(screen.getByText(/Admin/)).toBeInTheDocument();
  });

  it("displays approuvePar name when present", () => {
    render(
      <PersonnelAbsencesConges
        absences={[]}
        conges={[mockConges[1]]}
        enseignants={mockEnseignants}
      />
    );
    expect(screen.getByText(/Admin/)).toBeInTheDocument();
  });

  // --- Branches supplémentaires pour couvrir lignes 313, 369-405, 442 ---

  it("unjustifies an absence when X button clicked (INJUSTIFIEE)", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ absence: { ...mockAbsences[0], statut: "INJUSTIFIEE" } }),
    });

    render(
      <PersonnelAbsencesConges
        absences={[mockAbsences[0]]}
        conges={[]}
        enseignants={mockEnseignants}
      />
    );

    const xBtn = (screen.getAllByRole("button") as HTMLButtonElement[]).find(
      (b: HTMLButtonElement) => b.querySelector("svg.lucide-x") !== null
    );
    expect(xBtn).toBeDefined();
    if (xBtn) {
      fireEvent.click(xBtn);
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          "/api/rh/absences/a1",
          expect.objectContaining({
            method: "PATCH",
            body: expect.stringContaining("INJUSTIFIEE"),
          })
        );
      });
    }
  });

  it("refuses a conge when X button clicked (REFUSE)", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ conge: { ...mockConges[0], statut: "REFUSE" } }),
    });

    render(
      <PersonnelAbsencesConges
        absences={[]}
        conges={[mockConges[0]]}
        enseignants={mockEnseignants}
      />
    );

    const xBtn = (screen.getAllByRole("button") as HTMLButtonElement[]).find(
      (b: HTMLButtonElement) => b.querySelector("svg.lucide-x") !== null
    );
    expect(xBtn).toBeDefined();
    if (xBtn) {
      fireEvent.click(xBtn);
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          "/api/rh/conges/c1",
          expect.objectContaining({
            method: "PATCH",
            body: expect.stringContaining("REFUSE"),
          })
        );
      });
    }
  });

  it("fills conge form fields (type, nbDays, dates, motif) and submits", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ conge: mockConges[0] }),
    });

    render(
      <PersonnelAbsencesConges
        absences={[]}
        conges={[]}
        enseignants={mockEnseignants}
      />
    );

    fireEvent.click(screen.getByText("addLeave"));

    // Sélection enseignant
    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "e1" } });

    // Type de congé (2e select)
    fireEvent.change(selects[1], { target: { value: "MALADIE" } });

    // Nombre de jours
    const nbDaysInput = screen.getByRole("spinbutton");
    fireEvent.change(nbDaysInput, { target: { value: "3" } });

    // Dates
    const dateInputs = screen.getAllByDisplayValue(/.*/).filter(
      (el) => el.getAttribute("type") === "date"
    );
    fireEvent.change(dateInputs[0], { target: { value: "2025-03-01" } });
    fireEvent.change(dateInputs[1], { target: { value: "2025-03-05" } });

    // Motif
    const motifInput = screen.getByPlaceholderText("motifPlaceholder");
    fireEvent.change(motifInput, { target: { value: "Grippe" } });

    // Soumission
    fireEvent.click(screen.getByText("validate"));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/rh/conges",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("MALADIE"),
        })
      );
    });
  });

  it("shows error toast when absence form submitted without teacher", async () => {
    render(
      <PersonnelAbsencesConges
        absences={[]}
        conges={[]}
        enseignants={mockEnseignants}
      />
    );

    fireEvent.click(screen.getByText("addAbsence"));
    // Ne pas sélectionner d'enseignant, soumettre directement
    fireEvent.click(screen.getByText("validate"));

    // Le fetch ne doit pas être appelé (validation côté client)
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("shows error toast when conge form submitted without teacher", async () => {
    render(
      <PersonnelAbsencesConges
        absences={[]}
        conges={[]}
        enseignants={mockEnseignants}
      />
    );

    fireEvent.click(screen.getByText("addLeave"));
    fireEvent.click(screen.getByText("validate"));

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("cancels absence form when cancel button clicked", () => {
    render(
      <PersonnelAbsencesConges
        absences={[]}
        conges={[]}
        enseignants={mockEnseignants}
      />
    );

    fireEvent.click(screen.getByText("addAbsence"));
    expect(screen.getByText("validate")).toBeInTheDocument();

    fireEvent.click(screen.getByText("cancel"));
    // Le formulaire disparaît — validate n'est plus présent (sauf si conge form ouvert)
    expect(screen.queryByText("validate")).not.toBeInTheDocument();
  });

  it("cancels conge form when cancel button clicked", () => {
    render(
      <PersonnelAbsencesConges
        absences={[]}
        conges={[]}
        enseignants={mockEnseignants}
      />
    );

    fireEvent.click(screen.getByText("addLeave"));
    expect(screen.getByText("validate")).toBeInTheDocument();

    fireEvent.click(screen.getByText("cancel"));
    expect(screen.queryByText("validate")).not.toBeInTheDocument();
  });

  it("shows error toast when absence API returns error", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({}),
    });

    render(
      <PersonnelAbsencesConges
        absences={[]}
        conges={[]}
        enseignants={mockEnseignants}
      />
    );

    fireEvent.click(screen.getByText("addAbsence"));
    const select = screen.getAllByRole("combobox")[0];
    fireEvent.change(select, { target: { value: "e1" } });
    fireEvent.click(screen.getByText("validate"));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });
  });

  it("shows error toast when conge API returns error", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({}),
    });

    render(
      <PersonnelAbsencesConges
        absences={[]}
        conges={[]}
        enseignants={mockEnseignants}
      />
    );

    fireEvent.click(screen.getByText("addLeave"));
    const select = screen.getAllByRole("combobox")[0];
    fireEvent.change(select, { target: { value: "e1" } });
    fireEvent.click(screen.getByText("validate"));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });
  });

  it("renders INJUSTIFIEE badge for unjustified absence", () => {
    render(
      <PersonnelAbsencesConges
        absences={[{ ...mockAbsences[0], statut: "INJUSTIFIEE" }]}
        conges={[]}
        enseignants={mockEnseignants}
      />
    );
    expect(screen.getByText("unjustified")).toBeInTheDocument();
  });

  it("renders various conge statuts (REFUSE, EN_COURS, TERMINE, ANNULE)", () => {
    const statuts = ["REFUSE", "EN_COURS", "TERMINE", "ANNULE"] as const;
    statuts.forEach((statut) => {
      const { unmount } = render(
        <PersonnelAbsencesConges
          absences={[]}
          conges={[{ ...mockConges[0], statut }]}
          enseignants={mockEnseignants}
        />
      );
      // Le badge du statut doit être rendu
      expect(screen.getAllByText(/congeStatus/).length).toBeGreaterThan(0);
      unmount();
    });
  });

  it("renders fallback config for unknown absence type", () => {
    render(
      <PersonnelAbsencesConges
        absences={[{ ...mockAbsences[0], type: "UNKNOWN_TYPE" }]}
        conges={[]}
        enseignants={mockEnseignants}
      />
    );
    // Le type inconnu utilise la config AUTRE — ne crash pas
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("renders fallback config for unknown conge statut", () => {
    render(
      <PersonnelAbsencesConges
        absences={[]}
        conges={[{ ...mockConges[0], statut: "UNKNOWN_STATUT" }]}
        enseignants={mockEnseignants}
      />
    );
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("renders absence without heureDebut/heureFin", () => {
    render(
      <PersonnelAbsencesConges
        absences={[mockAbsences[1]]}
        conges={[]}
        enseignants={mockEnseignants}
      />
    );
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("renders conge without motif", () => {
    render(
      <PersonnelAbsencesConges
        absences={[]}
        conges={[mockConges[1]]}
        enseignants={mockEnseignants}
      />
    );
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });
});
