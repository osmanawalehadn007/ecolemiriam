import { describe, it, expect } from "vitest";
import {
  MESSAGE_AUTORISATEUR_REFUSE,
  MESSAGE_PAYEUR_REFUSE,
  ROLES_AUTORISATEURS_DEPENSE,
  ROLES_PAYEURS_DEPENSE,
  peutAutoriserDepense,
  peutPayerDepense,
} from "@/lib/depense-habilitations";

// Référentiel partagé par les menus déroulants « Autorisé par » / « Payé par »
// (écran Finances), la server action `createDepense` et les triggers
// PostgreSQL. Toute évolution de la règle doit casser ce test, pas passer
// inaperçue.

describe("peutAutoriserDepense", () => {
  it("habilite le responsable d'établissement et le chef d'établissement", () => {
    expect(peutAutoriserDepense("TENANT_ADMIN")).toBe(true);
    expect(peutAutoriserDepense("PRINCIPAL")).toBe(true);
  });

  it.each([
    "SECRETARY",
    "TEACHER",
    "CLASS_TEACHER",
    "COUNSELOR",
    "NURSE",
    "ACCOUNTANT",
    "PARENT",
    "STUDENT",
    // L'équipe plateforme n'engage pas les dépenses d'un établissement.
    "SUPER_ADMIN",
  ])("refuse le rôle %s", (role) => {
    expect(peutAutoriserDepense(role)).toBe(false);
  });

  it("refuse une valeur absente ou inconnue", () => {
    expect(peutAutoriserDepense(null)).toBe(false);
    expect(peutAutoriserDepense(undefined)).toBe(false);
    expect(peutAutoriserDepense("")).toBe(false);
    expect(peutAutoriserDepense("CAISSIER")).toBe(false);
  });
});

describe("peutPayerDepense", () => {
  it("habilite le comptable / caissier (ACCOUNTANT)", () => {
    expect(peutPayerDepense("ACCOUNTANT")).toBe(true);
  });

  it.each([
    "SUPER_ADMIN",
    "TENANT_ADMIN",
    "PRINCIPAL",
    "SECRETARY",
    "TEACHER",
    "CLASS_TEACHER",
    "COUNSELOR",
    "NURSE",
    "PARENT",
    "STUDENT",
  ])("refuse le rôle %s", (role) => {
    expect(peutPayerDepense(role)).toBe(false);
  });

  it("refuse une valeur absente ou inconnue", () => {
    expect(peutPayerDepense(null)).toBe(false);
    expect(peutPayerDepense(undefined)).toBe(false);
    expect(peutPayerDepense("caissier")).toBe(false);
  });
});

describe("référentiels exposés", () => {
  it("liste officielle des autorisateurs, dans l'ordre", () => {
    expect([...ROLES_AUTORISATEURS_DEPENSE]).toEqual(["TENANT_ADMIN", "PRINCIPAL"]);
  });

  it("liste officielle des payeurs, dans l'ordre", () => {
    expect([...ROLES_PAYEURS_DEPENSE]).toEqual(["ACCOUNTANT"]);
  });

  it("les messages d'erreur nomment les rôles attendus", () => {
    expect(MESSAGE_AUTORISATEUR_REFUSE).toContain("TENANT_ADMIN");
    expect(MESSAGE_AUTORISATEUR_REFUSE).toContain("PRINCIPAL");
    expect(MESSAGE_PAYEUR_REFUSE).toContain("ACCOUNTANT");
  });

  it("un rôle ne cumule pas les deux habilitations par défaut", () => {
    // ACCOUNTANT paie mais n'autorise pas ; TENANT_ADMIN autorise mais ne paie pas.
    expect(peutAutoriserDepense("ACCOUNTANT")).toBe(false);
    expect(peutPayerDepense("TENANT_ADMIN")).toBe(false);
  });
});
