import { describe, it, expect } from "vitest";
import { isMenuItemVisible } from "@/lib/menu";
import type { Role } from "@prisma/client";

/**
 * Menu dérivé de la matrice RBAC — l'entrée de la `Sidebar` n'est visible que
 * si le rôle détient la permission de lecture du module (et n'est pas à
 * périmètre personnel pour un écran `staffOnly`).
 */
describe("menu dérivé de la matrice", () => {
  it("TENANT_ADMIN voit tous les écrans de personnel", () => {
    const role = "TENANT_ADMIN" as Role;
    for (const href of [
      "/eleves", "/notes", "/absences", "/parents", "/facturation",
      "/rh", "/inventaire", "/admissions", "/communication", "/rapports",
      "/analytics", "/alumni", "/vie-scolaire", "/cours",
      "/emploi-du-temps", "/evaluations", "/orientation", "/messages",
    ]) {
      expect(isMenuItemVisible(href, role)).toBe(true);
    }
  });

  it("PARENT : seulement messages, orientation, cours, emploi et MES-FACTURES", () => {
    const role = "PARENT" as Role;
    expect(isMenuItemVisible("/messages", role)).toBe(true);
    expect(isMenuItemVisible("/orientation", role)).toBe(true);
    expect(isMenuItemVisible("/cours", role)).toBe(true);
    expect(isMenuItemVisible("/emploi-du-temps", role)).toBe(true);
    // Écran famille : c'est LE canal des factures pour un parent
    expect(isMenuItemVisible("/mes-factures", role)).toBe(true);
    // Écrans de personnel (staffOnly) : invisibles même si la permission existe
    expect(isMenuItemVisible("/notes", role)).toBe(false);
    expect(isMenuItemVisible("/absences", role)).toBe(false);
    expect(isMenuItemVisible("/facturation", role)).toBe(false);
    expect(isMenuItemVisible("/eleves", role)).toBe(false);
    expect(isMenuItemVisible("/rh", role)).toBe(false);
  });

  it("STUDENT : mes-factures visible, écrans de personnel invisibles", () => {
    const role = "STUDENT" as Role;
    expect(isMenuItemVisible("/mes-factures", role)).toBe(true);
    expect(isMenuItemVisible("/notes", role)).toBe(false);
    expect(isMenuItemVisible("/parents", role)).toBe(false);
  });

  it("SECRETARY : plus de divergence — les entrées affichées sont autorisées", () => {
    const role = "SECRETARY" as Role;
    // corrections de matrice de l'audit : ces entrées étaient visibles mais redirigées
    expect(isMenuItemVisible("/evaluations", role)).toBe(true);
    expect(isMenuItemVisible("/cours", role)).toBe(true);
    expect(isMenuItemVisible("/vie-scolaire", role)).toBe(true);
    expect(isMenuItemVisible("/facturation", role)).toBe(false);
    expect(isMenuItemVisible("/rh", role)).toBe(false);
    expect(isMenuItemVisible("/analytics", role)).toBe(false);
  });

  it("TEACHER / NURSE / ACCOUNTANT : les permissions d'alignement tiennent", () => {
    expect(isMenuItemVisible("/parents", "TEACHER" as Role)).toBe(true);
    expect(isMenuItemVisible("/cours", "NURSE" as Role)).toBe(true);
    expect(isMenuItemVisible("/emploi-du-temps", "ACCOUNTANT" as Role)).toBe(true);
  });

  it("/dashboard est visible de tous les rôles", () => {
    for (const role of ["PARENT", "STUDENT", "SECRETARY", "TENANT_ADMIN"] as Role[]) {
      expect(isMenuItemVisible("/dashboard", role)).toBe(true);
    }
  });
});