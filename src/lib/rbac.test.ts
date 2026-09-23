import { describe, it, expect, vi } from "vitest";
import type { Role } from "@prisma/client";

// `rbac.ts` importe `@/lib/auth` (qui initialise NextAuth au chargement du
// module) et `@/lib/audit` (qui ouvre une écriture Prisma). On les neutralise :
// seule la matrice déclarative `ROLE_PERMISSIONS` est testée ici.
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(), auditFire: vi.fn() }));

import { ROLE_PERMISSIONS, roleHasPermission, checkAnyPermission } from "@/lib/rbac";

/**
 * Tests de non-régression de la matrice RBAC (`docs/AUDIT_RBAC_ROLES.md` § 8).
 *
 * Chaque cas correspond à un constat de l'audit. Ces tests doivent rester
 * rouges si une permission trop large est réintroduite.
 */
describe("RBAC — matrice des permissions", () => {
  it("C1 : un élève ne peut ni créer, ni modifier, ni supprimer un cours", () => {
    expect(roleHasPermission("STUDENT", "cours:write")).toBe(false);
    expect(roleHasPermission("STUDENT", "cours:delete")).toBe(false);
    expect(roleHasPermission("STUDENT", "cours:read")).toBe(true);
  });

  it("les mutations d'élèves restent réservées aux rôles administratifs", () => {
    const nonAutorises: Role[] = [
      "PARENT",
      "STUDENT",
      "TEACHER",
      "CLASS_TEACHER",
      "COUNSELOR",
      "NURSE",
      "ACCOUNTANT",
    ];
    for (const role of nonAutorises) {
      expect(roleHasPermission(role, "eleves:write")).toBe(false);
      expect(roleHasPermission(role, "eleves:delete")).toBe(false);
    }

    for (const role of ["TENANT_ADMIN", "PRINCIPAL", "SECRETARY"] as Role[]) {
      expect(roleHasPermission(role, "eleves:write")).toBe(true);
    }
  });

  it("périodes et règles d'appréciation exigent notes:write", () => {
    const nonAutorises: Role[] = [
      "PARENT",
      "STUDENT",
      "SECRETARY",
      "COUNSELOR",
      "NURSE",
      "ACCOUNTANT",
    ];
    for (const role of nonAutorises) {
      expect(roleHasPermission(role, "notes:write")).toBe(false);
    }
    expect(roleHasPermission("TEACHER", "notes:write")).toBe(true);
    expect(roleHasPermission("PRINCIPAL", "notes:write")).toBe(true);
  });

  it("périodes et règles d'appréciation exigent notes:manage (direction seule)", () => {
    // Les enseignants saisissent des notes, ils ne pilotent pas le calendrier
    // ni les règles d'appréciation de l'établissement.
    expect(roleHasPermission("TEACHER", "notes:manage")).toBe(false);
    expect(roleHasPermission("CLASS_TEACHER", "notes:manage")).toBe(false);
    for (const role of [
      "PARENT",
      "STUDENT",
      "SECRETARY",
      "COUNSELOR",
      "NURSE",
      "ACCOUNTANT",
    ] as Role[]) {
      expect(roleHasPermission(role, "notes:manage")).toBe(false);
    }
    expect(roleHasPermission("TENANT_ADMIN", "notes:manage")).toBe(true);
    expect(roleHasPermission("PRINCIPAL", "notes:manage")).toBe(true);
    // La saisie reste ouverte aux enseignants.
    expect(roleHasPermission("TEACHER", "notes:write")).toBe(true);
  });

  it("les mentions officielles exigent etablissement:write (propriétaire seul)", () => {
    expect(roleHasPermission("TENANT_ADMIN", "etablissement:write")).toBe(true);
    expect(roleHasPermission("SUPER_ADMIN", "etablissement:write")).toBe(true);
    for (const role of [
      "PRINCIPAL",
      "SECRETARY",
      "TEACHER",
      "CLASS_TEACHER",
      "ACCOUNTANT",
      "PARENT",
      "STUDENT",
    ] as Role[]) {
      expect(roleHasPermission(role, "etablissement:write")).toBe(false);
    }
  });

  it("les convocations exigent vie-scolaire:write", () => {
    const nonAutorises: Role[] = [
      "PARENT",
      "STUDENT",
      "TEACHER",
      "NURSE",
      "ACCOUNTANT",
    ];
    for (const role of nonAutorises) {
      expect(roleHasPermission(role, "vie-scolaire:write")).toBe(false);
    }
    expect(roleHasPermission("COUNSELOR", "vie-scolaire:write")).toBe(true);
    // Décision D1 (23/09/2026) : le secrétariat convoque les familles. Les deux
    // permissions sont nécessaires — `read` ouvre la page, `write` la création.
    expect(roleHasPermission("SECRETARY", "vie-scolaire:read")).toBe(true);
    expect(roleHasPermission("SECRETARY", "vie-scolaire:write")).toBe(true);
  });

  it("PARENT et STUDENT restent en lecture seule sur les données scolaires", () => {
    for (const role of ["PARENT", "STUDENT"] as Role[]) {
      expect(roleHasPermission(role, "eleves:write")).toBe(false);
      expect(roleHasPermission(role, "eleves:delete")).toBe(false);
      expect(roleHasPermission(role, "notes:write")).toBe(false);
      expect(roleHasPermission(role, "bulletins:publish")).toBe(false);
      expect(roleHasPermission(role, "vie-scolaire:write")).toBe(false);
    }
  });

  it("le super-admin dispose de toutes les permissions", () => {
    expect(roleHasPermission("SUPER_ADMIN", "eleves:write")).toBe(true);
    expect(roleHasPermission("SUPER_ADMIN", "parametres:write")).toBe(true);
    expect(roleHasPermission("SUPER_ADMIN", "nimporte:quoi")).toBe(true);
  });

  it("couvre les 11 rôles de l'enum Prisma", () => {
    const roles: Role[] = [
      "SUPER_ADMIN",
      "TENANT_ADMIN",
      "PRINCIPAL",
      "SECRETARY",
      "TEACHER",
      "CLASS_TEACHER",
      "COUNSELOR",
      "NURSE",
      "ACCOUNTANT",
      "PARENT",
      "STUDENT",
    ];
    expect(Object.keys(ROLE_PERMISSIONS).sort()).toEqual([...roles].sort());
    for (const role of roles) {
      expect(ROLE_PERMISSIONS[role].length).toBeGreaterThan(0);
    }
  });
});

/**
 * Les trois points « à confirmer » du § 7 de l'audit ont été tranchés
 * (décisions A1 / B1 / C1 du 23/09/2026, cf. § 8bis). Ces cas verrouillent les
 * décisions : ils deviennent rouges si un élargissement est réintroduit.
 */
describe("RBAC — arbitrages métier du 23/09/2026", () => {
  it("A1 : publier les bulletins est un acte de direction, pas du professeur principal", () => {
    expect(roleHasPermission("CLASS_TEACHER", "bulletins:publish")).toBe(false);
    // Le PP garde la saisie, l'édition et le conseil de classe.
    expect(roleHasPermission("CLASS_TEACHER", "bulletins:write")).toBe(true);
    expect(roleHasPermission("CLASS_TEACHER", "bulletins:read")).toBe(true);
    // La direction conserve la publication.
    expect(roleHasPermission("TENANT_ADMIN", "bulletins:publish")).toBe(true);
    expect(roleHasPermission("PRINCIPAL", "bulletins:publish")).toBe(true);
  });

  it("B1 : le comptable lit le RH et génère la paie, sans écrire les fiches RH", () => {
    expect(roleHasPermission("ACCOUNTANT", "rh:read")).toBe(true);
    expect(roleHasPermission("ACCOUNTANT", "paie:write")).toBe(true);
    // Ni fiches RH (salaire, RIB, contrat), ni absences/congés du personnel.
    expect(roleHasPermission("ACCOUNTANT", "rh:write")).toBe(false);

    // La génération d'un bulletin (POST /api/rh/[id]) accepte l'un OU l'autre.
    expect(checkAnyPermission("ACCOUNTANT", ["rh:write", "paie:write"])).toBeNull();
    expect(checkAnyPermission("TENANT_ADMIN", ["rh:write", "paie:write"])).toBeNull();
    expect(checkAnyPermission("PARENT", ["rh:write", "paie:write"])?.status).toBe(403);
    expect(checkAnyPermission("NURSE", ["rh:write", "paie:write"])?.status).toBe(403);
  });

  it("C1 : la radiation reste un soft delete ouvert au secrétariat", () => {
    expect(roleHasPermission("SECRETARY", "eleves:delete")).toBe(true);
    expect(roleHasPermission("SECRETARY", "eleves:write")).toBe(true);
    // Aucune purge physique n'existe : la direction n'a pas de permission
    // distincte, et la garde `eleves:delete` couvre bien le seul soft delete.
    expect(roleHasPermission("TENANT_ADMIN", "eleves:delete")).toBe(true);
  });

  it("ne rouvre pas la lecture seule des familles sur les modules scolaires", () => {
    expect(roleHasPermission("ACCOUNTANT", "eleves:write")).toBe(false);
    expect(roleHasPermission("ACCOUNTANT", "bulletins:publish")).toBe(false);
    expect(roleHasPermission("CLASS_TEACHER", "eleves:write")).toBe(false);
  });
});