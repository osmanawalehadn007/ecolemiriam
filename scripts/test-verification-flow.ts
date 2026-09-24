/**
 * Test du flow complet de vérification d'email
 * ============================================================
 * Simule ce qui se passe quand on crée un utilisateur :
 *   1. Crée un token en base (verification_tokens)
 *   2. Envoie l'email de vérification via Resend
 *   3. Vérifie que le token est bien en base
 *   4. Affiche l'URL de vérification pour tester le clic
 *
 * Usage:
 *   npx tsx scripts/test-verification-flow.ts <email-destinataire> [nom-utilisateur]
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });

import { sendVerificationEmail, verifyEmailToken } from "../src/lib/security/email-verification";

const BANNER = "═".repeat(70);

async function main() {
  const to = process.argv[2] ?? "awaleh.osman.d@icloud.com";
  const userName = process.argv[3] ?? "Utilisateur Test";

  console.log(BANNER);
  console.log("  TEST DU FLOW DE VÉRIFICATION D'EMAIL");
  console.log(BANNER);

  // ── 1. Vérification de la configuration ──────────────────────
  console.log("\n── 1. Configuration ──");
  console.log("  RESEND_API_KEY:", process.env.RESEND_API_KEY ? "présente" : "ABSENTE");
  console.log("  EMAIL_FROM:", process.env.EMAIL_FROM ?? "École Miriam <noreply@ecolemiriam.com>");
  console.log("  AUTH_URL:", process.env.AUTH_URL ?? "(non défini)");
  console.log("  NEXTAUTH_URL:", process.env.NEXTAUTH_URL ?? "(non défini)");
  console.log("  NEXT_PUBLIC_APP_URL:", process.env.NEXT_PUBLIC_APP_URL ?? "(non défini)");
  console.log("  DATABASE_URL:", process.env.DATABASE_URL ? "présente" : "ABSENTE");
  console.log("  DIRECT_URL:", process.env.DIRECT_URL ? "présente" : "ABSENTE");

  // ── 2. Envoi de l'email de vérification ────────────────────
  console.log("\n── 2. Envoi de l'email de vérification ──");
  console.log("  Destinataire:", to);
  console.log("  Nom:", userName);

  // Mot de passe temporaire simulé (comme dans createUser)
  const tempPassword = "Test1234!";
  const tenantId = "test-tenant-id";
  const userId = "test-user-id";

  console.log("  Mot de passe temporaire:", tempPassword);
  console.log("\n  Appel de sendVerificationEmail()...");

  try {
    const result = await sendVerificationEmail(
      to,
      userName,
      undefined,        // ecoleNom (défaut: "École Miriam")
      true,             // force = true (supprime les tokens précédents)
      tempPassword,     // mot de passe temporaire
      { tenantId, userId, createdBy: userId }  // logContext
    );

    console.log("\n── 3. Résultat ──");
    console.log("  Succès:", result.success);
    console.log("  Token:", result.token ? `${result.token.slice(0, 16)}...` : "(aucun)");
    console.log("  EmailLog ID:", result.emailLogId ?? "(aucun)");
    console.log("  Erreur:", result.error ?? "(aucune)");

    if (result.success) {
      // ── 4. Construire l'URL de vérification ────────────────
      const baseUrl =
        process.env.AUTH_URL ??
        process.env.NEXTAUTH_URL ??
        process.env.NEXT_PUBLIC_APP_URL ??
        "http://localhost:3000";
      const verifyUrl = `${baseUrl}/verify-email?token=${result.token}`;

      console.log("\n── 4. URL de vérification ──");
      console.log("  URL:", verifyUrl);
      console.log("\n  ⚠️  Vérifie que AUTH_URL pointe vers la bonne URL en production.");
      console.log("      Si AUTH_URL=http://localhost:3000, le lien dans l'email ne marchera pas");
      console.log("      pour les utilisateurs en production.");
      console.log("      En production, AUTH_URL doit être https://ecolemiriam.com");

      // ── 5. Tester la validation du token ────────────────────
      console.log("\n── 5. Test de validation du token ──");
      console.log("  (Ne pas valider maintenant — l'utilisateur doit cliquer le lien)");

      // ── 6. Conseils ─────────────────────────────────────────
      console.log("\n── 6. Prochaines étapes ──");
      console.log(`  1. Vérifie la boîte ${to} (réception + spam)`);
      console.log("  2. Si l'email arrive, clique sur le bouton 'Vérifier mon adresse email'");
      console.log("  3. Vérifie que l'URL de redirection fonctionne");
      console.log("  4. Si l'email n'arrive PAS, compare avec le test direct:");
      console.log("     npx tsx scripts/test-email-delivery.ts " + to);
      console.log("     → Si le test direct arrive mais pas celui-ci, le problème");
      console.log("       vient du contenu (HTML, sujet, headers) ou de la DB.");
    } else {
      console.log("\n❌ Échec de l'envoi. Vérifie:");
      console.log("  - La connexion à la DB (DATABASE_URL / DIRECT_URL)");
      console.log("  - La clé RESEND_API_KEY");
      console.log("  - Les logs ci-dessus pour l'erreur exacte");
    }
  } catch (err) {
    console.error("\n❌ Exception lors de sendVerificationEmail:");
    console.error("  ", err);
    console.error("\n  Causes possibles:");
    console.error("  - DB inaccessible (verificationToken.create échoue)");
    console.error("  - Table verification_tokens inexistante (migration manquante)");
    console.error("  - RLS bloque l'écriture (rôle app sans contexte tenant)");
  }

  console.log(`\n${BANNER}`);
  console.log("  FIN DU TEST");
  console.log(BANNER);

  process.exit(0);
}

main().catch((err) => {
  console.error("Erreur fatale:", err);
  process.exit(1);
});
