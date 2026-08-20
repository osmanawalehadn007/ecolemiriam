/**
 * Test d'intégration RLS — prouve l'isolation inter-tenant au niveau base.
 *
 * Prérequis :
 * - La migration `migration_rls_hardening.sql` a été exécutée.
 * - Le rôle `ecolemiriam_app` existe avec NOBYPASSRLS.
 * - DATABASE_URL pointe vers le rôle `ecolemiriam_app`.
 * - Deux tenants de test existent en base avec des élèves.
 *
 * Ce test vérifie que :
 * 1. Avec le contexte tenant A, on ne voit QUE les élèves de A.
 * 2. Sans contexte, l'opération échoue (fail-closed).
 * 3. Un INSERT avec un tenantId étranger est rejeté (WITH CHECK).
 * 4. Le site filtering isole les données entre sites d'un même tenant.
 *
 * NOTE : ce test nécessite une vraie base PostgreSQL. Il est
 * marqué skip si DATABASE_URL n'est pas configurée pour le rôle
 * ecolemiriam_app (détecté par la présence de RLS_ACTIVE=true).
 */

import { describe, it, expect, beforeAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { runWithTenant, prismaWithRls, assertTenantContext } from "@/lib/prisma-rls";

const RLS_ACTIVE = process.env.RLS_ACTIVE === "true";

// Client direct (bypass RLS) pour préparer les données de test
const adminPrisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DIRECT_URL || process.env.DATABASE_URL,
    },
  },
});

describe.skipIf(!RLS_ACTIVE)("RLS — isolation inter-tenant", () => {
  let tenantA: { id: string };
  let tenantB: { id: string };
  let siteA1: { id: string };
  let siteA2: { id: string };
  let eleveA1: { id: string };
  let eleveA2: { id: string };
  let eleveB: { id: string };

  beforeAll(async () => {
    // Créer deux tenants de test via le client admin (bypass RLS)
    tenantA = await adminPrisma.tenant.create({
      data: {
        name: "TEST Tenant A (RLS)",
        slug: "test-tenant-a-rls",
        status: "ACTIVE",
        plan: "PRO",
        email: "test-a@rls.test",
      },
    });

    tenantB = await adminPrisma.tenant.create({
      data: {
        name: "TEST Tenant B (RLS)",
        slug: "test-tenant-b-rls",
        status: "ACTIVE",
        plan: "PRO",
        email: "test-b@rls.test",
      },
    });

    // Créer deux sites pour le tenant A
    siteA1 = await adminPrisma.site.create({
      data: { nom: "Site A1", tenantId: tenantA.id },
    });
    siteA2 = await adminPrisma.site.create({
      data: { nom: "Site A2", tenantId: tenantA.id },
    });

    // Créer une année scolaire pour chaque tenant
    const anneeA = await adminPrisma.anneesScolaires.create({
      data: {
        libelle: "2025-2026",
        tenantId: tenantA.id,
        dateDebut: new Date("2025-09-01"),
        dateFin: new Date("2026-06-30"),
        isCurrent: true,
      },
    });
    await adminPrisma.anneesScolaires.create({
      data: {
        libelle: "2025-2026",
        tenantId: tenantB.id,
        dateDebut: new Date("2025-09-01"),
        dateFin: new Date("2026-06-30"),
        isCurrent: true,
      },
    });

    // Créer des élèves (matricule, dateNaissance, anneeInscription requis)
    eleveA1 = await adminPrisma.eleve.create({
      data: {
        prenom: "Alice",
        nom: "TestA1",
        sexe: "F",
        matricule: "RLS-A1-001",
        dateNaissance: new Date("2010-01-01"),
        anneeInscription: "2025-2026",
        tenantId: tenantA.id,
        siteId: siteA1.id,
      },
    });

    eleveA2 = await adminPrisma.eleve.create({
      data: {
        prenom: "Bob",
        nom: "TestA2",
        sexe: "M",
        matricule: "RLS-A2-002",
        dateNaissance: new Date("2010-02-01"),
        anneeInscription: "2025-2026",
        tenantId: tenantA.id,
        siteId: siteA2.id,
      },
    });

    eleveB = await adminPrisma.eleve.create({
      data: {
        prenom: "Charlie",
        nom: "TestB",
        sexe: "M",
        matricule: "RLS-B-003",
        dateNaissance: new Date("2010-03-01"),
        anneeInscription: "2025-2026",
        tenantId: tenantB.id,
      },
    });
  }, 30000);

  it("ne voit que les élèves du tenant A avec le contexte A", async () => {
    const eleves = await runWithTenant(tenantA.id, null, () =>
      prismaWithRls.eleve.findMany({ select: { id: true, nom: true } })
    );

    const ids = eleves.map((e) => e.id);
    expect(ids).toContain(eleveA1.id);
    expect(ids).toContain(eleveA2.id);
    expect(ids).not.toContain(eleveB.id);
  });

  it("ne voit que les élèves du tenant B avec le contexte B", async () => {
    const eleves = await runWithTenant(tenantB.id, null, () =>
      prismaWithRls.eleve.findMany({ select: { id: true } })
    );

    const ids = eleves.map((e) => e.id);
    expect(ids).toContain(eleveB.id);
    expect(ids).not.toContain(eleveA1.id);
    expect(ids).not.toContain(eleveA2.id);
  });

  it("échoue sans contexte tenant (fail-closed)", async () => {
    await expect(
      prismaWithRls.eleve.findMany()
    ).rejects.toThrow(/contexte tenant/);
  });

  it("rejette un INSERT avec un tenantId étranger (WITH CHECK)", async () => {
    await expect(
      runWithTenant(tenantA.id, null, () =>
        prismaWithRls.eleve.create({
          data: {
            prenom: "Hack",
            nom: "Attempt",
            sexe: "M",
            matricule: "RLS-HACK-999",
            dateNaissance: new Date("2010-01-01"),
            anneeInscription: "2025-2026",
            tenantId: tenantB.id, // tentative d'injection cross-tenant
          },
        })
      )
    ).rejects.toThrow();
  });

  it("isole les sites au sein d'un même tenant", async () => {
    // Avec le site A1, on ne voit que les élèves de A1
    const elevesSite1 = await runWithTenant(tenantA.id, siteA1.id, () =>
      prismaWithRls.eleve.findMany({ select: { id: true } })
    );
    const ids1 = elevesSite1.map((e) => e.id);
    expect(ids1).toContain(eleveA1.id);
    expect(ids1).not.toContain(eleveA2.id);

    // Avec le site A2, on ne voit que les élèves de A2
    const elevesSite2 = await runWithTenant(tenantA.id, siteA2.id, () =>
      prismaWithRls.eleve.findMany({ select: { id: true } })
    );
    const ids2 = elevesSite2.map((e) => e.id);
    expect(ids2).toContain(eleveA2.id);
    expect(ids2).not.toContain(eleveA1.id);
  });

  it("un admin (siteId null) voit tous les sites du tenant", async () => {
    const eleves = await runWithTenant(tenantA.id, null, () =>
      prismaWithRls.eleve.findMany({ select: { id: true } })
    );
    const ids = eleves.map((e) => e.id);
    expect(ids).toContain(eleveA1.id);
    expect(ids).toContain(eleveA2.id);
  });

  it("ne voit pas les tenants étrangers", async () => {
    const tenants = await runWithTenant(tenantA.id, null, () =>
      prismaWithRls.tenant.findMany()
    );
    expect(tenants.length).toBe(1);
    expect(tenants[0].id).toBe(tenantA.id);
  });

  it("assertTenantContext retourne le contexte actif", async () => {
    await runWithTenant(tenantA.id, siteA1.id, async () => {
      const ctx = assertTenantContext();
      expect(ctx.tenantId).toBe(tenantA.id);
      expect(ctx.siteId).toBe(siteA1.id);
    });
  });

  // Nettoyage après tous les tests
  it("nettoie les données de test", async () => {
    await adminPrisma.eleve.deleteMany({
      where: { nom: { in: ["TestA1", "TestA2", "TestB", "Attempt"] } },
    });
    await adminPrisma.site.deleteMany({
      where: { nom: { in: ["Site A1", "Site A2"] } },
    });
    await adminPrisma.anneesScolaires.deleteMany({
      where: { tenantId: { in: [tenantA.id, tenantB.id] } },
    });
    await adminPrisma.tenant.deleteMany({
      where: { id: { in: [tenantA.id, tenantB.id] } },
    });
  });
});
