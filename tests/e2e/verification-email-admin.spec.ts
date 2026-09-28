import { test, expect, SEED_ADMIN, loginWithCredentials } from "./fixtures";
import { PrismaClient } from "@prisma/client";

/**
 * ============================================================
 * Vérification d'email par l'administration (bouton de l'annuaire)
 * ============================================================
 * Un compte créé par l'administration démarre avec `emailVerified = null` : le
 * garde-fou de connexion (`authorize()` → « Email non vérifié ») lui refuse
 * l'accès, et il n'existait aucun moyen de débloquer un compte dont l'adresse
 * est pourtant fiable (le renvoi d'email n'arrive pas toujours).
 *
 * Le bouton « Marquer l'email comme vérifié » (Paramètres → Utilisateurs →
 * Utilisateurs) comble ce trou. Ce test décrit le parcours du terrain :
 *   1. l'admin crée un utilisateur (comme dans la vraie vie) ;
 *   2. ce nouvel utilisateur NE PEUT PAS se connecter ;
 *   3. l'admin marque son email comme vérifié ;
 *   4. l'utilisateur se connecte (et arrive sur le changement de mot de passe
 *      forcé, puisque l'admin a défini son mot de passe).
 */
const prisma = new PrismaClient();

const MOT_DE_PASSE = "VerifE2E2026!";

/** Nettoie le compte créé par le test (UserTenant suit en cascade). */
async function supprimerCompte(email: string) {
  await prisma.user.deleteMany({ where: { email } });
}

test.describe("Annuaire — vérification d'email", () => {
  test("le bouton de l'admin débloque un compte non vérifié", async ({
    authedPage: page,
    browser,
  }) => {
    const stamp = Date.now();
    const email = `verif.e2e.${stamp}@ecolpro.test`;

    try {
      // 1. L'admin crée l'utilisateur depuis l'annuaire.
      await page.goto("/parametres");
      await page.getByRole("button", { name: "Utilisateurs & Contacts" }).click();
      await page.getByRole("button", { name: "Utilisateurs", exact: true }).click();
      await page.getByRole("button", { name: "Ajouter un utilisateur" }).click();
      await page.getByRole("button", { name: "Enseignant", exact: true }).click();
      await page.fill("#name", `Compte À Vérifier ${stamp}`);
      await page.fill("#email", email);
      await page.fill("#password", MOT_DE_PASSE);
      await page.getByRole("button", { name: "Créer", exact: true }).click();
      await expect(page.getByText("Utilisateur créé")).toBeVisible({ timeout: 15000 });

      // 2. Connexion REFUSÉE : l'email n'est pas vérifié.
      const ctx = await browser.newContext();
      const page2 = await ctx.newPage();
      await page2.goto("/login");
      await page2.fill('input[type="email"]', email);
      await page2.fill('input[type="password"]', MOT_DE_PASSE);
      await page2.click('button[type="submit"]');
      await expect(page2).toHaveURL(/\/login/, { timeout: 20000 });
      await ctx.close();

      // 3. L'admin marque l'email comme vérifié (bouton par ligne).
      const ligne = page.locator("tr", { hasText: email });
      await expect(ligne).toBeVisible({ timeout: 20000 });
      await ligne.getByTitle("Marquer l'email comme vérifié").click();

      // Signal fiable : c'est bien l'ACTION de vérification qui a abouti (le
      // toast « Utilisateur créé » de l'étape 1 est encore affiché et ferait
      // échouer une assertion trop généreuse en strict mode).
      await expect(
        page.locator('[data-sonner-toast]').filter({ hasText: /marqué|marked/i }),
      ).toBeVisible({ timeout: 20000 });
      await expect(ligne.getByTitle("Marquer l'email comme vérifié")).toHaveCount(0, {
        timeout: 20000,
      });

      // 4. Connexion ACCEPTÉE (le compte doit changer son mot de passe).
      const ctx2 = await browser.newContext();
      const page3 = await ctx2.newPage();
      await loginWithCredentials(page3, email, MOT_DE_PASSE, "/change-password");
      await expect(page3).toHaveURL(/\/change-password/, { timeout: 20000 });
      await ctx2.close();
    } finally {
      await supprimerCompte(email);
    }
  });
});

