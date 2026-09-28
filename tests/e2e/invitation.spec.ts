import { test, expect, SEED_ADMIN, markEmailVerified } from "./fixtures";
import type { Page } from "@playwright/test";

/**
 * ============================================================
 * Système d'invitation — parcours de bout en bout (UI réelle)
 * ============================================================
 *
 * Deux parcours couverts, sur une base LOCALE seedée (voir playwright.config.ts
 * qui refuse toute base distante) :
 *
 *  1. Inscription publique  : `/register` crée l'établissement + le compte
 *     administrateur, qui se connecte ensuite réellement.
 *  2. Invitation par l'admin: Paramètres → Utilisateurs → « Ajouter un
 *     utilisateur », puis acceptation par connexion du nouvel utilisateur.
 *
 * L'« acceptation » est vérifiée pour de vrai : on ouvre un contexte navigateur
 * neuf (cookies vides) et on se connecte avec les identifiants de l'invitation.
 * Le test passe donc par `authorize()` + bcrypt + `deriveClaims`.
 *
 * Note : `registerTenant` limite à 3 inscriptions par heure et par IP
 * (src/lib/actions/register.ts). Le compteur est en mémoire : relancer le
 * serveur de dev le remet à zéro si vous enchaînez les exécutions locales.
 */

/** Connexion générique avec des identifiants explicites. */
async function loginWith(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
}

/** Ouvre les onglets Paramètres → Utilisateurs. */
async function openUsersTab(page: Page) {
  await page.goto("/parametres");
  await page.getByRole("button", { name: "Utilisateurs & Contacts" }).click();
  await page.getByRole("button", { name: "Utilisateurs", exact: true }).click();
}

test.describe("Système d'invitation", () => {
  test("inscription : création de l'établissement et du compte administrateur", async ({
    page,
    browser,
  }) => {
    const stamp = Date.now();
    const adminEmail = `admin.e2e.${stamp}@ecolpro.test`;
    const adminPassword = "InviteE2E2026!";

    await page.goto("/register");
    await page.fill("#schoolName", `École E2E ${stamp}`);
    await page.fill("#city", "Dakar");
    await page.fill("#phone", "+221770000000");
    await page.fill("#email", `contact.${stamp}@ecolpro.test`);
    await page.fill("#adminFirstName", "Awa");
    await page.fill("#adminLastName", "Diop");
    await page.fill("#adminEmail", adminEmail);
    await page.fill("#adminPassword", adminPassword);
    // Libellé réel du bouton : `register.submit` dans src/i18n/fr.json.
    await page.getByRole("button", { name: "Créer mon espace École Miriam" }).click();

    // Écran de confirmation d'inscription (`register.successMsg`).
    await expect(page.getByText(/a été enregistré/)).toBeVisible({
      timeout: 20000,
    });

    const ctx = await browser.newContext();
    const newPage = await ctx.newPage();

    // Tant que l'email n'est pas vérifié, la connexion est REFUSÉE : le compte
    // est créé avec `emailVerified = null` et `authorize()` bloque ces comptes.
    await loginWith(newPage, adminEmail, adminPassword);
    await expect(newPage).toHaveURL(/\/login/, { timeout: 20000 });

    // Clic sur le lien de vérification : la CI n'a aucun fournisseur d'email
    // (Resend), on applique donc l'état produit par /api/auth/verify-email.
    await markEmailVerified(adminEmail);

    // ACCEPTATION : l'administrateur créé se connecte (nouveau contexte).
    await loginWith(newPage, adminEmail, adminPassword);
    await expect(newPage).toHaveURL(/\/(dashboard|select-tenant)/, { timeout: 20000 });
    await ctx.close();
  });

  test("invitation : l'admin crée un utilisateur, qui peut ensuite se connecter", async ({
    authedPage: page,
    browser,
  }) => {
    const stamp = Date.now();
    const email = `invite.e2e.${stamp}@ecolpro.test`;
    const password = "InviteE2E2026!";
    const newPassword = "NouveauE2E2026!";
    const name = `Moussa E2E ${stamp}`;

    await openUsersTab(page);

    // Ouvre le formulaire d'invitation et le remplit.
    // L'ajout est en deux étapes : choix du rôle, puis identité + mot de passe.
    // `exact: true` est requis : « Enseignant » matche aussi « Importer
    // enseignants » et « Enseignants 2 » (filtre de la liste).
    await page.getByRole("button", { name: "Ajouter un utilisateur" }).click();
    await page.getByRole("button", { name: "Enseignant", exact: true }).click();
    await page.fill("#name", name);
    await page.fill("#email", email);
    await page.fill("#password", password);
    await page.getByRole("button", { name: "Créer", exact: true }).click();

    // Le compte invité apparaît dans l'annuaire de l'établissement.
    // (Pas de `page.reload()` : l'onglet actif est un état client et un
    // rechargement le réinitialiserait sur « Établissement ». La server action
    // revalide `/parametres`, la liste se met donc à jour d'elle-même.)
    await expect(page.getByText("Utilisateur créé")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(email)).toBeVisible({ timeout: 15000 });

    // L'admin a défini le mot de passe : le compte doit d'abord être vérifié
    // (email envoyé via Resend en production ; la base de la CI n'a pas de
    // fournisseur d'email, on applique donc l'état que produit le lien).
    await markEmailVerified(email);

    // ACCEPTATION : un compte créé par l'admin démarre avec un mot de passe
    // connu de l'admin — le changement est donc OBLIGATOIRE avant tout accès.
    const ctx = await browser.newContext();
    const newPage = await ctx.newPage();
    await loginWith(newPage, email, password);
    await expect(newPage).toHaveURL(/\/change-password/, { timeout: 20000 });

    // Changement de mot de passe forcé.
    //
    // Le formulaire est un composant client : tant que React n'a pas hydraté,
    // `onSubmit` n'est pas attaché et le navigateur fait un GET natif sur la
    // page (même piège que celui documenté dans fixtures.ts). On recharge et on
    // retente, puis on vérifie l'ÉTAT FINAL — la connexion avec le nouveau mot
    // de passe — plutôt que la navigation déclenchée par `signOut`.
    let changed = false;
    for (let attempt = 0; attempt < 3 && !changed; attempt++) {
      await newPage.goto("/change-password");
      await newPage.waitForLoadState("networkidle");
      await newPage.fill("#current-password", password);
      await newPage.fill("#new-password", newPassword);
      await newPage.fill("#confirm-password", newPassword);
      await newPage.getByRole("button", { name: "Mettre à jour mon mot de passe" }).click();
      try {
        await newPage.waitForURL(/\/(login|dashboard|select-tenant)/, { timeout: 15000 });
        changed = true;
      } catch {
        // Formulaire non hydraté (GET natif) → nouvelle tentative.
      }
    }
    expect(changed, "le changement de mot de passe forcé doit aboutir").toBe(true);

    // Reconnexion avec le nouveau mot de passe → accès à l'application.
    await loginWith(newPage, email, newPassword);
    await expect(newPage).toHaveURL(/\/(dashboard|select-tenant)/, { timeout: 20000 });
    await ctx.close();
  });

  test("invitation par lien : l'admin invite, l'utilisateur accepte et se connecte", async ({
    authedPage: page,
    browser,
  }) => {
    const stamp = Date.now();
    const email = `lien.e2e.${stamp}@ecolpro.test`;
    const password = "LienE2E2026!";

    await openUsersTab(page);

    // L'admin émet l'invitation (email non configuré en local ⇒ lien affiché).
    await page.getByTestId("open-invite").click();
    await page.fill("#invite-form-email", email);
    await page.fill("#invite-form-name", `Prof Lien ${stamp}`);
    await page.selectOption("#invite-form-role", "TEACHER");
    await page.getByTestId("send-invitation").click();

    await expect(page.getByText("Invitation créée")).toBeVisible({ timeout: 15000 });
    const linkInput = page.getByTestId("invite-link");
    await expect(linkInput).toBeVisible({ timeout: 15000 });
    const inviteUrl = await linkInput.inputValue();
    expect(inviteUrl).toContain("/accept-invitation?token=");

    // ACCEPTATION : page publique, l'utilisateur choisit son mot de passe.
    const ctx = await browser.newContext();
    const acceptPage = await ctx.newPage();
    await acceptPage.goto(inviteUrl);
    await acceptPage.fill("#invite-name", `Prof Lien ${stamp}`);
    await acceptPage.fill("#invite-password", password);
    await acceptPage.fill("#invite-confirm", password);
    await acceptPage.getByRole("button", { name: "Créer mon compte" }).click();
    // `heading` : le texte est aussi présent dans le toast de succès.
    await expect(
      acceptPage.getByRole("heading", { name: "Compte activé !" })
    ).toBeVisible({ timeout: 20000 });

    // L'utilisateur se connecte : il a choisi son mot de passe, donc pas de
    // changement forcé → accès direct.
    await loginWith(acceptPage, email, password);
    await expect(acceptPage).toHaveURL(/\/(dashboard|select-tenant)/, { timeout: 20000 });
    await ctx.close();
  });

  test("invitation : refus d'un email déjà rattaché à la plateforme", async ({
    authedPage: page,
  }) => {
    await openUsersTab(page);
    await page.getByRole("button", { name: "Ajouter un utilisateur" }).click();
    // Étape 1 : le rôle (l'ancien champ `#role` n'existe plus).
    await page.getByRole("button", { name: "Enseignant", exact: true }).click();
    await page.fill("#name", "Doublon E2E");
    // Email administrateur de la base seedée : déjà utilisé.
    await page.fill("#email", SEED_ADMIN.email);
    await page.fill("#password", "InviteE2E2026!");
    await page.getByRole("button", { name: "Créer", exact: true }).click();

    // EN PRODUCTION, Next.js masque le message des erreurs levées dans une
    // server action (digest seulement) : l'admin voit une erreur générique et
    // non « Un utilisateur avec cet email existe déjà ». On vérifie donc qu'une
    // erreur est bien remontée et que la création n'est pas confirmée — le
    // message exact, lui, est couvert par les tests d'intégration.
    await expect(page.locator('[data-sonner-toast][data-type="error"]')).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText("Utilisateur créé")).toHaveCount(0);
  });
});
