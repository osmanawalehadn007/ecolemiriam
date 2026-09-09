/**
 * École Miriam — Canal Email (Resend)
 * Docs: https://resend.com/docs
 *
 * Variables d'environnement :
 *   RESEND_API_KEY=re_...
 *   EMAIL_FROM="École Miriam <noreply@ecolemiriam.com>"
 *   RESEND_WEBHOOK_SECRET=whsec_... (pour vérifier les webhooks)
 *
 * Si la clé est absente, l'envoi est simulé (utile en dev / sandbox).
 */

import { Resend } from "resend";

export interface EmailResult {
  success: boolean;
  sent: number;
  error?: string;
  /** IDs Resend par destinataire : { email: resendId } — pour corrélation webhook */
  emailIds?: Record<string, string>;
}

const FROM = process.env.EMAIL_FROM ?? "École Miriam <noreply@ecolemiriam.com>";
const BATCH = 50; // limite Resend par appel

/**
 * Envoie un email à une liste de destinataires (un email par destinataire,
 * en BCC implicite via envois individuels groupés par lots).
 *
 * @param to    — liste des adresses destinataires
 * @param subject — sujet de l'email
 * @param html    — contenu HTML
 * @param text    — contenu plain text (optionnel mais recommandé pour la délivrabilité)
 * @param tags    — tags Resend pour le suivi (optionnel)
 */
export async function sendEmail(
  to: string[],
  subject: string,
  html: string,
  text?: string,
  tags?: Record<string, string>
): Promise<EmailResult> {
  const recipients = [...new Set(to.filter(Boolean))];
  if (recipients.length === 0) return { success: true, sent: 0 };

  const apiKey = process.env.RESEND_API_KEY;
  const isProd = process.env.NODE_ENV === "production";

  // ── Diagnostic : logger ce que le runtime voit réellement ────────────
  // On logge le préfixe (6 chars) seulement — jamais la clé complète.
  const keyPrefix = apiKey ? apiKey.slice(0, 6) : "ABSENTE";
  const keyLength = apiKey ? apiKey.length : 0;
  const fromValue = process.env.EMAIL_FROM ?? FROM;
  console.log(`[Email] sendEmail appelé — destinataires: ${recipients.length}, sujet: "${subject}", FROM: "${fromValue}", RESEND_API_KEY: ${keyPrefix}…(${keyLength} chars), NODE_ENV: ${process.env.NODE_ENV ?? "undefined"}`);

  if (!apiKey || apiKey.includes("xxxx")) {
    if (isProd) {
      // En production, une clé manquante est une erreur — ne pas simuler.
      console.error(`[Email] RESEND_API_KEY manquante ou placeholder en production — ABANDON (clé=${keyPrefix}, length=${keyLength})`);
      return { success: false, sent: 0, error: "RESEND_API_KEY manquante en production" };
    }
    console.warn(`[Email] RESEND_API_KEY manquante — simulation (${recipients.length} destinataires)`);
    return { success: true, sent: recipients.length };
  }

  const resend = new Resend(apiKey);
  let sent = 0;
  const emailIds: Record<string, string> = {};

  try {
    for (let i = 0; i < recipients.length; i += BATCH) {
      const batch = recipients.slice(i, i + BATCH);
      // Resend Batch API : un message par destinataire.
      const payload = batch.map((email) => ({
        from: FROM,
        to: [email],
        subject,
        html,
        ...(text ? { text } : {}),
        ...(tags ? { tags: Object.entries(tags).map(([name, value]) => ({ name, value })) } : {}),
      }));
      console.log(`[Email] Appel resend.batch.send — ${batch.length} destinataire(s)`);
      const { data, error } = await resend.batch.send(payload);
      if (error) {
        console.error("[Email] Erreur lot Resend:", JSON.stringify(error));
        return { success: false, sent, error: error.message };
      }
      console.log(`[Email] Réponse Resend — type de data: ${typeof data}, Array.isArray: ${Array.isArray(data)}, clés: ${data ? Object.keys(data) : "null"}`);
      // Capturer les IDs Resend pour corrélation webhook.
      // L'API batch retourne { data: [{ id: "..." }] } — un objet contenant
      // un tableau, pas un tableau direct. Les deux formes sont gérées pour
      // robustesse (selon la version du SDK / API).
      const items: { id?: string }[] = Array.isArray(data)
        ? data
        : data && Array.isArray(data.data)
          ? data.data
          : [];
      const captured = items.length;
      items.forEach((item: { id?: string }, idx: number) => {
        if (item.id && batch[idx]) {
          emailIds[batch[idx]] = item.id;
        }
      });
      console.log(`[Email] IDs capturés: ${captured}, emailIds: ${Object.keys(emailIds).length}`);
      sent += batch.length;
    }
    console.log(`[Email] Envoi terminé — sent: ${sent}, emailIds: ${JSON.stringify(emailIds)}`);
    return { success: true, sent, emailIds };
  } catch (err) {
    console.error("[Email] Erreur envoi:", err instanceof Error ? `${err.name}: ${err.message}` : String(err));
    return { success: false, sent, error: err instanceof Error ? err.message : "Erreur réseau" };
  }
}

/**
 * Gabarit HTML simple aux couleurs École Miriam pour les notifications.
 */
export function renderNotificationEmail(
  ecoleNom: string,
  titre: string,
  contenu: string
): string {
  const body = contenu.replace(/\n/g, "<br />");
  return `<!DOCTYPE html>
<html lang="fr"><body style="margin:0;background:#f4f4f7;font-family:-apple-system,Segoe UI,Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.06);">
        <tr><td style="background:#4f46e5;padding:20px 28px;color:#fff;font-size:18px;font-weight:700;">${escapeHtml(ecoleNom)}</td></tr>
        <tr><td style="padding:28px;">
          <h1 style="margin:0 0 12px;font-size:20px;color:#111;">${escapeHtml(titre)}</h1>
          <div style="font-size:15px;line-height:1.6;color:#374151;">${body}</div>
        </td></tr>
        <tr><td style="padding:16px 28px;border-top:1px solid #eee;font-size:12px;color:#9ca3af;">
          Envoyé via École Miriam — merci de ne pas répondre à cet email.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
