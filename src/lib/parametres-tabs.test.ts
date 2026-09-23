import { describe, it, expect, vi } from "vitest";
import type { Role } from "@prisma/client";

// `parametres-tabs.ts` s'appuie sur `rbac.ts`, qui importe `@/lib/auth` (et
// initialise NextAuth au chargement) : on neutralise ce chargement réel.
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(), auditFire: vi.fn() }));

import {
  allowedParametresTabs,
  PARAMETRES_TAB_PERMISSIONS,
} from "@/lib/parametres-tabs";

/**
 * L'écran Paramètres n'est plus réservé « en bloc » à la direction : chaque
 * onglet exige la permission de son module. Ces cas verrouillent la politique
 * (et évitent qu'un onglet devienne invisible pour tous).
 */
describe("Paramètres — onglets dérivés des permissions", () => {
  it("le propriétaire et le super-admin voient tous les onglets", () => {
    const all = Object.keys(PARAMETRES_TAB_PERMISSIONS);
    expect(allowedParametresTabs("TENANT_ADMIN").sort()).toEqual([...all].sort());
    expect(allowedParametresTabs("SUPER_ADMIN").sort()).toEqual([...all].sort());
  });

  it("le chef d'établissement garde la pédagogie et les comptes, pas les mentions officielles", () => {
    const tabs = allowedParametresTabs("PRINCIPAL");
    expect(tabs.sort()).toEqual(
      [
        "utilisateurs",
        "parents",
        "doublons",
        "classes",
        "matieres",
        "appreciations",
        "periodes",
        "tarifs",
      ].sort()
    );
    expect(tabs).not.toContain("signature");
    expect(tabs).not.toContain("sites");
  });

  it("le secrétariat garde les annuaires qu'il administre", () => {
    expect(allowedParametresTabs("SECRETARY").sort()).toEqual(
      ["parents", "doublons", "classes", "matieres"].sort()
    );
  });

  it("un enseignant voit les référentiels pédagogiques + l'annuaire de SES familles", () => {
    // `parents:read` accordé au TEACHER (audit § 8 P2) : la page applique
    // `teacherParentFilter` (familles de ses classes uniquement).
    expect(allowedParametresTabs("TEACHER").sort()).toEqual(
      ["classes", "matieres", "parents"].sort()
    );
    expect(allowedParametresTabs("CLASS_TEACHER").sort()).toEqual(
      ["parents", "classes", "matieres"].sort()
    );
  });

  it("le comptable voit les tarifs et l'annuaire des parents", () => {
    expect(allowedParametresTabs("ACCOUNTANT").sort()).toEqual(
      ["parents", "tarifs"].sort()
    );
  });

  it("les familles et l'infirmerie n'ont accès à aucun onglet", () => {
    for (const role of ["PARENT", "STUDENT", "NURSE"] as Role[]) {
      expect(allowedParametresTabs(role)).toEqual([]);
    }
  });
});