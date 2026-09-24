/**
 * École Miriam — Vérification d'email
 * ============================================================
 * Génération de tokens de vérification, envoi de l'email et validation.
 *
 * Le token est stocké dans la table `verification_tokens` (schéma Prisma)
 * avec une expiration de 24h. L'email contient un lien vers /verify-email
 * qui appelle l'API pour valider le token et marquer `emailVerified`.
 */

import { randomBytes } from "crypto";
import prismaBase from "@/lib/prisma-base";
import { sendEmail } from "@/lib/notifications/email";
import { createEmailLog, markEmailSent, markEmailFailed } from "@/lib/notifications/email-log";

const TOKEN_EXPIRY_HOURS = 24;
const TOKEN_BYTES = 32;

/**
 * Génère un token cryptographiquement sûr (64 caractères hex).
 */
function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString("hex");
}

/**
 * Construit l'URL de vérification à partir du token.
 * Priorité : AUTH_URL (NextAuth v5) > NEXTAUTH_URL (v4 legacy) > NEXT_PUBLIC_APP_URL > localhost
 */
function buildVerifyUrl(token: string): string {
  const baseUrl =
    process.env.AUTH_URL ??
    process.env.NEXTAUTH_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "http://localhost:3000";
  return `${baseUrl}/verify-email?token=${token}`;
}

/**
 * Gabarit HTML de l'email de vérification.
 */
function renderVerificationEmailHtml(
  userName: string,
  verifyUrl: string,
  ecoleNom = "École Miriam",
  temporaryPassword?: string
): string {
  const passwordBlock = temporaryPassword
    ? `
          <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:16px;margin:0 0 24px;">
            <p style="font-size:14px;line-height:1.6;color:#374151;margin:0 0 8px;">
              <strong>Votre mot de passe temporaire :</strong>
            </p>
            <p style="font-size:18px;font-family:monospace;font-weight:700;color:#1e40af;margin:0 0 8px;letter-spacing:1px;">
              ${escapeHtml(temporaryPassword)}
            </p>
            <p style="font-size:13px;line-height:1.5;color:#6b7280;margin:0;">
              Après avoir vérifié votre email, vous pourrez définir votre propre mot de passe.
              Vous pouvez aussi utiliser ce mot de passe temporaire pour vous connecter directement.
            </p>
          </div>`
    : "";

  return `<!DOCTYPE html>
<html lang="fr"><body style="margin:0;background:#f4f4f7;font-family:-apple-system,Segoe UI,Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.06);">
        <tr><td style="background:#4f46e5;padding:20px 28px;color:#fff;font-size:18px;font-weight:700;">${escapeHtml(ecoleNom)}</td></tr>
        <tr><td style="padding:28px;">
          <h1 style="margin:0 0 12px;font-size:20px;color:#111;">Vérifiez votre adresse email</h1>
          <p style="font-size:15px;line-height:1.6;color:#374151;margin:0 0 16px;">
            Bonjour <strong>${escapeHtml(userName)}</strong>,
          </p>
          <p style="font-size:15px;line-height:1.6;color:#374151;margin:0 0 24px;">
            Vous venez de créer un compte sur École Miriam. Pour activer votre espace et garantir
            la sécurité de votre établissement, veuillez confirmer votre adresse email en cliquant
            sur le bouton ci-dessous.
          </p>
          ${passwordBlock}
          <p style="text-align:center;margin:0 0 24px;">
            <a href="${verifyUrl}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 32px;border-radius:8px;">
              Vérifier mon adresse email
            </a>
          </p>
          <p style="font-size:13px;line-height:1.6;color:#6b7280;margin:0 0 8px;">
            Ou copiez ce lien dans votre navigateur :
          </p>
          <p style="font-size:13px;line-height:1.6;color:#6b7280;margin:0 0 24px;word-break:break-all;">
            ${verifyUrl}
          </p>
          <p style="font-size:13px;line-height:1.6;color:#6b7280;margin:0;">
            Ce lien expire dans 24 heures. Si vous n&rsquo;avez pas créé de compte,
            vous pouvez ignorer cet email.
          </p>
        </td></tr>
        <tr><td style="padding:16px 28px;border-top:1px solid #eee;font-size:12px;color:#9ca3af;">
          Envoyé via École Miriam — merci de ne pas répondre à cet email.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

/**
 * Version plain text de l'email de vérification (pour la délivrabilité).
 */
function renderVerificationEmailText(
  userName: string,
  verifyUrl: string,
  ecoleNom = "École Miriam",
  temporaryPassword?: string
): string {
  const pwdLine = temporaryPassword
    ? `\nVotre mot de passe temporaire : ${temporaryPassword}\nAprès vérification, vous pourrez définir votre propre mot de passe.\n`
    : "";

  return `${ecoleNom}
================================

Vérifiez votre adresse email

Bonjour ${userName},

Vous venez de créer un compte sur École Miriam. Pour activer votre
espace et garantir la sécurité de votre établissement, veuillez
confirmer votre adresse email en cliquant sur le lien ci-dessous :
${pwdLine}
${verifyUrl}

Ce lien expire dans 24 heures. Si vous n'avez pas créé de compte,
vous pouvez ignorer cet email.

---
Envoyé via École Miriam — merci de ne pas répondre à cet email.`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export interface SendVerificationResult {
  success: boolean;
  token?: string;
  error?: string;
  emailLogId?: string;
}

/**
 * Génère un token de vérification, le persiste en base et envoie l'email.
 *
 * @param userEmail         — email de l'utilisateur (identifiant unique)
 * @param userName          — nom affiché dans l'email
 * @param ecoleNom          — nom de l'établissement (pour le branding)
 * @param force             — si true, supprime les tokens précédents avant d'en créer un nouveau
 * @param temporaryPassword — mot de passe temporaire à inclure dans l'email (optionnel)
 * @param logContext        — contexte pour le journal des emails (tenantId, userId, createdBy)
 */
export async function sendVerificationEmail(
  userEmail: string,
  userName: string,
  ecoleNom?: string,
  force = false,
  temporaryPassword?: string,
  logContext?: { tenantId?: string | null; userId?: string | null; createdBy?: string | null }
): Promise<SendVerificationResult> {
  // Nettoyer les tokens expirés ou existants pour cet email
  if (force) {
    await prismaBase.verificationToken.deleteMany({
      where: { identifier: userEmail },
    });
  } else {
    await prismaBase.verificationToken.deleteMany({
      where: { identifier: userEmail, expires: { lt: new Date() } },
    });
  }

  const token = generateToken();
  const expires = new Date();
  expires.setHours(expires.getHours() + TOKEN_EXPIRY_HOURS);

  await prismaBase.verificationToken.create({
    data: {
      identifier: userEmail,
      token,
      expires,
    },
  });

  const verifyUrl = buildVerifyUrl(token);
  const html = renderVerificationEmailHtml(userName, verifyUrl, ecoleNom, temporaryPassword);
  const text = renderVerificationEmailText(userName, verifyUrl, ecoleNom, temporaryPassword);

  const subject = "Vérifiez votre adresse email — École Miriam";

  // Créer l'enregistrement EmailLog avant l'envoi
  let emailLogId: string | undefined;
  if (logContext) {
    try {
      emailLogId = await createEmailLog({
        tenantId: logContext.tenantId,
        userId: logContext.userId,
        email: userEmail,
        type: "VERIFICATION",
        subject,
        createdBy: logContext.createdBy,
        tags: { category: "verification" },
      });
    } catch (err) {
      console.warn("[sendVerificationEmail] Impossible de créer l'EmailLog:", err);
    }
  }

  const result = await sendEmail(
    [userEmail],
    subject,
    html,
    text,
    { category: "verification" }
  );

  if (!result.success) {
    // Marquer l'EmailLog comme échoué
    if (emailLogId) {
      await markEmailFailed(emailLogId, result.error ?? "Échec d'envoi").catch(() => {});
    }
    return { success: false, error: result.error ?? "Échec d'envoi de l'email", emailLogId };
  }

  // Marquer l'EmailLog comme envoyé avec l'ID Resend
  if (emailLogId) {
    const resendId = result.emailIds?.[userEmail] ?? null;
    await markEmailSent(emailLogId, resendId).catch(() => {});
  }

  return { success: true, token, emailLogId };
}

export interface VerifyTokenResult {
  success: boolean;
  email?: string;
  error?: string;
}

/**
 * Valide un token de vérification et marque l'email comme vérifié.
 * - Le token doit exister, ne pas avoir expiré, et correspondre à un user actif.
 * - Marque `User.emailVerified = now()` et supprime le token consommé.
 */
export async function verifyEmailToken(
  token: string
): Promise<VerifyTokenResult> {
  if (!token || token.length !== TOKEN_BYTES * 2) {
    return { success: false, error: "Token invalide" };
  }

  const record = await prismaBase.verificationToken.findUnique({
    where: { token },
  });

  if (!record) {
    return { success: false, error: "Token introuvable ou déjà utilisé" };
  }

  if (record.expires < new Date()) {
    // Nettoyer le token expiré
    await prismaBase.verificationToken.delete({ where: { token } });
    return { success: false, error: "Ce lien a expiré. Veuillez en demander un nouveau." };
  }

  // Marquer l'email comme vérifié
   
  const user = await prismaBase.user.findFirst({
    where: { email: { equals: record.identifier, mode: "insensitive" } },
    select: { id: true, isActive: true },
  });

  if (!user) {
    await prismaBase.verificationToken.delete({ where: { token } });
    return { success: false, error: "Aucun compte associé à ce lien" };
  }

  if (!user.isActive) {
    return { success: false, error: "Ce compte est désactivé. Contactez votre administrateur." };
  }

   
  await prismaBase.user.update({
    where: { id: user.id },
    data: { emailVerified: new Date() },
  });

  // Supprimer le token consommé + tous les tokens expirés de cet email
  await prismaBase.verificationToken.deleteMany({
    where: { identifier: record.identifier },
  });

  return { success: true, email: record.identifier };
}

/**
 * Vérifie si un utilisateur a confirmé son email.
 * Retourne true si emailVerified est non null.
 */
export async function isEmailVerified(userEmail: string): Promise<boolean> {
   
  const user = await prismaBase.user.findFirst({
    where: { email: { equals: userEmail, mode: "insensitive" } },
    select: { emailVerified: true },
  });
  return !!user?.emailVerified;
}
