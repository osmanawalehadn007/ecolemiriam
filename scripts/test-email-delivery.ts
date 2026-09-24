/**
 * Diagnostic d'envoi d'email via Resend
 * ============================================================
 * Vérifie la configuration, envoie un email de test, inspecte la
 * réponse de l'API Resend et affiche les conseils de délivrabilité.
 *
 * Usage:
 *   npx tsx scripts/test-email-delivery.ts <email-destinataire>
 *
 * Sans argument, envoie à l'adresse définie par TEST_EMAIL_TO dans .env
 * (ou wilsan.zz@gmail.com par défaut).
 *
 * Prérequis:
 *   - RESEND_API_KEY dans .env (.env.local est chargé automatiquement)
 *   - EMAIL_FROM (optionnel, défaut "École Miriam <noreply@ecolemiriam.com>")
 */

import { Resend } from "resend";

// ── Chargement .env.local (tsx ne le fait pas automatiquement) ──
import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });

const BANNER = "═".repeat(70);

function log(emoji: string, label: string, value?: unknown) {
  if (value === undefined) {
    console.log(`${emoji}  ${label}`);
  } else {
    console.log(`${emoji}  ${label}:`, value);
  }
}

async function main() {
  const to = process.argv[2] ?? process.env.TEST_EMAIL_TO ?? "wilsan.zz@gmail.com";
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? "École Miriam <noreply@ecolemiriam.com>";

  console.log(BANNER);
  console.log("  DIAGNOSTIC D'ENVOI D'EMAIL — RESEND");
  console.log(BANNER);

  // ── 1. Vérification de la configuration ──────────────────────
  console.log("\n── 1. Configuration ──");
  log("🔑", "RESEND_API_KEY", apiKey ? `${apiKey.slice(0, 8)}…${apiKey.slice(-4)} (${apiKey.length} chars)` : "ABSENTE");
  log("📧", "EMAIL_FROM", from);
  log("📥", "Destinataire", to);
  log("🌐", "RESEND_WEBHOOK_SECRET", process.env.RESEND_WEBHOOK_SECRET ? "présent" : "ABSENT — webhook non vérifié");

  if (!apiKey || apiKey.includes("xxxx")) {
    console.error("\n❌ RESEND_API_KEY manquante ou placeholder. Ajoute-la dans .env.local:");
    console.error("   RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");
    process.exit(1);
  }

  // ── 2. Test de l'API Resend (GET /domains) ──────────────────
  // La clé restreinte "sending only" ne peut pas lister les domains,
  // ce qui confirme le scope de la clé (comme l'erreur 401 vue dans Resend).
  console.log("\n── 2. Scope de la clé API ──");
  const resend = new Resend(apiKey);
  try {
    // @ts-expect-error — la méthode domains.list() existe sur le SDK mais peut être restreinte
    const { data, error } = await resend.domains.list();
    if (error) {
      log("⚠️ ", "Clé restreinte (envoi only) — c'est OK pour l'envoi, mais le webhook doit être configuré via le dashboard Resend");
      log("🔒", "Erreur API domains.list:", error.message ?? error);
    } else if (data) {
      log("✅", "Clé avec accès domains — domains visibles:");
      (Array.isArray(data) ? data : [data]).forEach((d: { name?: string; status?: string }) => {
        console.log(`     • ${d.name} — ${d.status}`);
      });
    }
  } catch (err) {
    log("⚠️ ", "Clé restreinte (envoi only) — c'est OK pour l'envoi");
    log("🔒", "Détail:", (err as Error).message);
  }

  // ── 3. Envoi de l'email de test ─────────────────────────────
  console.log("\n── 3. Envoi de l'email de test ──");
  const subject = `[Diagnostic] Test délivrabilité — ${new Date().toISOString().slice(0, 19).replace("T", " ")}`;
  const html = `<!DOCTYPE html>
<html lang="fr"><body style="margin:0;padding:24px;font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f4f4f7;">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.06);">
      <tr><td style="background:#4f46e5;padding:20px 28px;color:#fff;font-size:18px;font-weight:700;">École Miriam — Test de délivrabilité</td></tr>
      <tr><td style="padding:24px 28px;color:#333;font-size:14px;line-height:1.6;">
        <p>Cet email a été envoyé par le script <code>scripts/test-email-delivery.ts</code> pour diagnostiquer la délivrabilité.</p>
        <p><strong>Date :</strong> ${new Date().toLocaleString("fr-FR")}</p>
        <p><strong>Destinataire :</strong> ${to}</p>
        <p><strong>Expéditeur :</strong> ${from}</p>
        <p>Si vous lisez ce message, l'email a bien été délivré. Vérifiez néanmoins qu'il n'est pas dans le dossier Spam.</p>
      </td></tr>
      <tr><td style="padding:16px 28px;background:#f9fafb;color:#6b7280;font-size:12px;border-top:1px solid #e5e7eb;">
        Email de diagnostic — École Miriam
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;

  const text = `École Miriam — Test de délivrabilité\n\nDate: ${new Date().toLocaleString("fr-FR")}\nDestinataire: ${to}\nExpéditeur: ${from}\n\nCet email a été envoyé par le script scripts/test-email-delivery.ts pour diagnostiquer la délivrabilité.`;

  const payload = {
    from,
    to: [to],
    subject,
    html,
    text,
    tags: [{ name: "category", value: "diagnostic" }],
  };

  console.log("   Envoi en cours…");
  const sendResult = await resend.batch.send([payload]);

  console.log("\n── 4. Réponse de l'API Resend ──");
  if (sendResult.error) {
    log("❌", "Erreur Resend:", sendResult.error);
    console.log("\n   Causes possibles:");
    console.log("   • Domaine non vérifié dans Resend (https://resend.com/domains)");
    console.log("   • Clé API invalide ou expirée");
    console.log("   • Adresse destinataire mal formée");
    process.exit(1);
  }

  const items: { id?: string }[] = Array.isArray(sendResult.data)
    ? sendResult.data
    : sendResult.data && Array.isArray((sendResult.data as { data?: unknown[] }).data)
      ? (sendResult.data as { data: { id?: string }[] }).data
      : [];

  const emailId = items[0]?.id;
  log("✅", "Email envoyé — ID Resend:", emailId ?? "(non retourné)");
  log("📊", "Réponse complète:", JSON.stringify(sendResult.data, null, 2));

  // ── 5. Vérification DNS (rappel) ────────────────────────────
  console.log("\n── 5. Rappel DNS (vérifier avec dig) ──");
  console.log("   SPF:    dig TXT ecolemiriam.com +short");
  console.log("   DKIM:   dig TXT resend._domainkey.ecolemiriam.com +short");
  console.log("   DMARC:  dig TXT _dmarc.ecolemiriam.com +short");

  // ── 6. Conseils de délivrabilité ────────────────────────────
  console.log("\n── 6. Prochaines étapes ──");
  console.log(`   1. Vérifie la boîte ${to} (y compris le dossier Spam)`);
  console.log("   2. Si l'email est en spam → teste sur https://mail-tester.com");
  console.log("   3. Vérifie le domaine sur https://resend.com/domains (statut Verified)");
  console.log("   4. Vérifie les bounces sur https://resend.com/emails");
  console.log("   5. Configure le webhook sur https://resend.com/webhooks:");
  console.log("      URL: https://ecolemiriam.com/api/webhooks/resend");
  console.log("      Ajoute RESEND_WEBHOOK_SECRET=whsec_... dans l'environnement");
  if (emailId) {
    console.log(`   6. ID Resend pour corrélation: ${emailId}`);
  }

  console.log(`\n${BANNER}`);
  console.log("  FIN DU DIAGNOSTIC");
  console.log(BANNER);
}

main().catch((err) => {
  console.error("\n❌ Erreur inattendue:", err);
  process.exit(1);
});
