import { test, expect, SEED_PARENT, loginWithCredentials } from "./fixtures";
import { PrismaClient } from "@prisma/client";

/**
 * ============================================================
 * Portail famille `/mes-factures` — isolation PARENT (non négociable)
 * ============================================================
 * `siteFilterForModel` renvoie `{}` pour PARENT/STUDENT : leur isolation ne peut
 * venir que du filtre relationnel (`eleveScopeFilter` → `parents.some.parent.userId`).
 * Ce test le prouve de bout en bout :
 *
 *   1. on crée DEUX factures en base — une pour l'enfant du parent de
 *      démonstration, une pour un autre élève du même établissement ;
 *   2. le parent se connecte (identifiants de la seed) et ouvre `/mes-factures` ;
 *   3. il doit voir la facture de son enfant et JAMAIS celle de l'autre élève.
 *
 * Sans cette vérification, une régression du périmètre exposerait la
 * facturation des autres familles — c'est exactement le type de fuite déjà
 * rencontré sur ce projet (cf. AGENTS.md §14).
 */
const prisma = new PrismaClient();

/** Contexte minimal : le parent de la seed, son enfant, et un autre élève. */
async function contexteIsolation() {
  const parentUser = await prisma.user.findFirst({
    where: { email: SEED_PARENT.email },
    select: { id: true, tenantId: true },
  });
  if (!parentUser?.tenantId) return null;

  const lien = await prisma.eleveParent.findFirst({
    where: { parent: { userId: parentUser.id } },
    select: { eleveId: true },
  });
  if (!lien) return null;

  const autre = await prisma.eleve.findFirst({
    where: { tenantId: parentUser.tenantId, id: { not: lien.eleveId } },
    select: { id: true },
  });
  if (!autre) return null;

  return { tenantId: parentUser.tenantId, enfantId: lien.eleveId, autreId: autre.id };
}

test.describe("Portail famille — isolation", () => {
  test("un parent ne voit que les factures de ses propres enfants", async ({ page }) => {
    const ctx = await contexteIsolation();
    test.skip(!ctx, "base de démonstration sans parent rattaché à un élève");
    if (!ctx) return;

    const marque = Date.now();
    const enfant = await prisma.facture.create({
      data: {
        tenantId: ctx.tenantId,
        eleveId: ctx.enfantId,
        numero: `FAC-E2E-${marque}-A`,
        libelle: `E2E enfant ${marque}`,
        montant: 5000,
        statut: "EN_ATTENTE",
      },
      select: { id: true },
    });
    const autreEleve = await prisma.facture.create({
      data: {
        tenantId: ctx.tenantId,
        eleveId: ctx.autreId,
        numero: `FAC-E2E-${marque}-B`,
        libelle: `E2E autre eleve ${marque}`,
        montant: 7000,
        statut: "EN_ATTENTE",
      },
      select: { id: true },
    });

    try {
      await loginWithCredentials(page, SEED_PARENT.email, SEED_PARENT.password, "/mes-factures");
      await page.goto("/mes-factures");

      // La facture de son enfant est visible…
      await expect(page.getByText(`E2E enfant ${marque}`)).toBeVisible({ timeout: 20000 });
      // …et celle d'un autre élève ne l'est JAMAIS.
      await expect(page.getByText(`E2E autre eleve ${marque}`)).toHaveCount(0);
    } finally {
      await prisma.facture.deleteMany({
        where: { id: { in: [enfant.id, autreEleve.id] } },
      });
    }
  });
});
