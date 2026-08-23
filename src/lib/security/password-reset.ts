/**
 * École Miriam — Réinitialisation de mot de passe
 * ============================================================
 * Génération de tokens de reset, envoi de l'email et validation.
 *
 * Réutilise la table `verification_tokens` avec un préfixe d'identifiant
 * `reset-password:` pour distinguer des tokens de vérification email.
 * Expiration courte (1h) pour limiter la fenêtre d'attaque.
 */

import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import prismaBase from "@/lib/prisma-base";
import { sendEmail } from "@/lib/notifications/email";
import { validatePasswordStrength } from "./password";

const TOKEN_EXPIRY_HOURS = 1;
const SET_PASSWORD_EXPIRY_HOURS = 1;
const TOKEN_BYTES = 32;
const RESET_PREFIX = "reset-password:";
const SET_PASSWORD_PREFIX = "set-password:";

function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString("hex");
}

function buildResetUrl(token: string): string {
  const baseUrl =
    process.env.AUTH_URL ??
    process.env.NEXTAUTH_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "http://localhost:3000";
  return `${baseUrl}/reset-password?token=${token}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderResetEmailHtml(
  userName: string,
  resetUrl: string,
  ecoleNom = "École Miriam"
): string {
  return `<!DOCTYPE html>
<html lang="fr"><body style="margin:0;background:#f4f4f7;font-family:-apple-system,Segoe UI,Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.06);">
        <tr><td style="background:#4f46e5;padding:20px 28px;color:#fff;font-size:18px;font-weight:700;">${escapeHtml(ecoleNom)}</td></tr>
        <tr><td style="padding:28px;">
          <h1 style="margin:0 0 12px;font-size:20px;color:#111;">Réinitialisation de votre mot de passe</h1>
          <p style="font-size:15px;line-height:1.6;color:#374151;margin:0 0 16px;">
            Bonjour <strong>${escapeHtml(userName)}</strong>,
          </p>
          <p style="font-size:15px;line-height:1.6;color:#374151;margin:0 0 24px;">
            Vous avez demandé à réinitialiser votre mot de passe. Cliquez sur le bouton
            ci-dessous pour en définir un nouveau.
          </p>
          <p style="text-align:center;margin:0 0 24px;">
            <a href="${resetUrl}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 32px;border-radius:8px;">
              Définir mon nouveau mot de passe
            </a>
          </p>
          <p style="font-size:13px;line-height:1.6;color:#6b7280;margin:0 0 8px;">
            Ou copiez ce lien dans votre navigateur :
          </p>
          <p style="font-size:13px;line-height:1.6;color:#6b7280;margin:0 0 24px;word-break:break-all;">
            ${resetUrl}
          </p>
          <p style="font-size:13px;line-height:1.6;color:#6b7280;margin:0;">
            Ce lien expire dans 1 heure. Si vous n&rsquo;avez pas demandé cette
            réinitialisation, vous pouvez ignorer cet email en toute sécurité.
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

function renderResetEmailText(
  userName: string,
  resetUrl: string,
  ecoleNom = "École Miriam"
): string {
  return `${ecoleNom}
================================

Réinitialisation de votre mot de passe

Bonjour ${userName},

Vous avez demandé à réinitialiser votre mot de passe. Cliquez sur le lien
ci-dessous pour en définir un nouveau :

${resetUrl}

Ce lien expire dans 1 heure. Si vous n'avez pas demandé cette
réinitialisation, vous pouvez ignorer cet email.

---
Envoyé via École Miriam — merci de ne pas répondre à cet email.`;
}

export interface SendResetResult {
  success: boolean;
  token?: string;
  error?: string;
}

/**
 * Génère un token de reset, le persiste en base et envoie l'email.
 * @param userEmail — email de l'utilisateur
 * @param userName  — nom affiché dans l'email
 * @param ecoleNom  — nom de l'établissement (branding)
 */
export async function sendPasswordResetEmail(
  userEmail: string,
  userName: string,
  ecoleNom?: string
): Promise<SendResetResult> {
  const identifier = `${RESET_PREFIX}${userEmail.toLowerCase()}`;

  // Supprimer les tokens précédents pour cet email
  await prismaBase.verificationToken.deleteMany({
    where: { identifier },
  });

  const token = generateToken();
  const expires = new Date();
  expires.setHours(expires.getHours() + TOKEN_EXPIRY_HOURS);

  await prismaBase.verificationToken.create({
    data: {
      identifier,
      token,
      expires,
    },
  });

  const resetUrl = buildResetUrl(token);
  const html = renderResetEmailHtml(userName, resetUrl, ecoleNom);
  const text = renderResetEmailText(userName, resetUrl, ecoleNom);

  const result = await sendEmail(
    [userEmail],
    "Réinitialisation de votre mot de passe — École Miriam",
    html,
    text
  );

  if (!result.success) {
    return { success: false, error: result.error ?? "Échec d'envoi de l'email" };
  }

  return { success: true, token };
}

export interface ResetPasswordResult {
  success: boolean;
  email?: string;
  error?: string;
}

/**
 * Valide un token de reset et définit le nouveau mot de passe.
 * - Le token doit exister, ne pas avoir expiré.
 * - L'identifiant doit avoir le préfixe `reset-password:`.
 * - Le mot de passe doit respecter les règles de robustesse.
 */
export async function resetPasswordWithToken(
  token: string,
  newPassword: string
): Promise<ResetPasswordResult> {
  if (!token || token.length !== TOKEN_BYTES * 2) {
    return { success: false, error: "Token invalide" };
  }

  const strengthError = validatePasswordStrength(newPassword);
  if (strengthError) {
    return { success: false, error: strengthError };
  }

  const record = await prismaBase.verificationToken.findUnique({
    where: { token },
  });

  if (!record) {
    return { success: false, error: "Token introuvable ou déjà utilisé" };
  }

  if (!record.identifier.startsWith(RESET_PREFIX)) {
    return { success: false, error: "Token invalide" };
  }

  if (record.expires < new Date()) {
    await prismaBase.verificationToken.delete({ where: { token } });
    return { success: false, error: "Ce lien a expiré. Veuillez en demander un nouveau." };
  }

  const email = record.identifier.slice(RESET_PREFIX.length);

  // eslint-disable-next-line ecolemiriam/require-tenant-id, ecolemiriam/require-site-filter -- reset password : lookup par email
  const user = await prismaBase.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true, isActive: true },
  });

  if (!user) {
    await prismaBase.verificationToken.delete({ where: { token } });
    return { success: false, error: "Aucun compte associé à ce lien" };
  }

  if (!user.isActive) {
    return { success: false, error: "Ce compte est désactivé. Contactez votre administrateur." };
  }

  const hashed = await bcrypt.hash(newPassword, 12);

  // eslint-disable-next-line ecolemiriam/require-tenant-id -- self-update après reset : user.id provient du lookup
  await prismaBase.user.update({
    where: { id: user.id },
    data: { password: hashed },
  });

  // Supprimer le token consommé + tous les tokens de reset pour cet email
  await prismaBase.verificationToken.deleteMany({
    where: { identifier: record.identifier },
  });

  return { success: true, email };
}

// ============================================================
// TOKEN SET-PASSWORD (après vérification email)
// ============================================================

/**
 * Génère un token set-password pour un utilisateur dont l'email vient
 * d'être vérifié. Ce token permet à l'utilisateur de définir son
 * propre mot de passe sans connaître le mot de passe temporaire.
 */
export async function generateSetPasswordToken(
  userEmail: string
): Promise<string> {
  const identifier = `${SET_PASSWORD_PREFIX}${userEmail.toLowerCase()}`;

  // Supprimer les tokens précédents
  await prismaBase.verificationToken.deleteMany({
    where: { identifier },
  });

  const token = generateToken();
  const expires = new Date();
  expires.setHours(expires.getHours() + SET_PASSWORD_EXPIRY_HOURS);

  await prismaBase.verificationToken.create({
    data: { identifier, token, expires },
  });

  return token;
}

/**
 * Valide un token set-password et définit le nouveau mot de passe.
 * Utilisé après la vérification email pour permettre à l'utilisateur
 * de choisir son propre mot de passe.
 */
export async function setPasswordWithToken(
  token: string,
  newPassword: string
): Promise<ResetPasswordResult> {
  if (!token || token.length !== TOKEN_BYTES * 2) {
    return { success: false, error: "Token invalide" };
  }

  const strengthError = validatePasswordStrength(newPassword);
  if (strengthError) {
    return { success: false, error: strengthError };
  }

  const record = await prismaBase.verificationToken.findUnique({
    where: { token },
  });

  if (!record) {
    return { success: false, error: "Token introuvable ou déjà utilisé" };
  }

  if (!record.identifier.startsWith(SET_PASSWORD_PREFIX)) {
    return { success: false, error: "Token invalide" };
  }

  if (record.expires < new Date()) {
    await prismaBase.verificationToken.delete({ where: { token } });
    return { success: false, error: "Ce lien a expiré. Veuillez vous connecter et utiliser 'Mot de passe oublié'." };
  }

  const email = record.identifier.slice(SET_PASSWORD_PREFIX.length);

  // eslint-disable-next-line ecolemiriam/require-tenant-id, ecolemiriam/require-site-filter -- set-password : lookup par email
  const user = await prismaBase.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true, isActive: true, emailVerified: true },
  });

  if (!user) {
    await prismaBase.verificationToken.delete({ where: { token } });
    return { success: false, error: "Aucun compte associé à ce lien" };
  }

  if (!user.isActive) {
    return { success: false, error: "Ce compte est désactivé. Contactez votre administrateur." };
  }

  if (!user.emailVerified) {
    return { success: false, error: "Votre email n'est pas vérifié." };
  }

  const hashed = await bcrypt.hash(newPassword, 12);

  // eslint-disable-next-line ecolemiriam/require-tenant-id -- self-update : user.id provient du lookup
  await prismaBase.user.update({
    where: { id: user.id },
    data: { password: hashed },
  });

  // Supprimer le token consommé
  await prismaBase.verificationToken.deleteMany({
    where: { identifier: record.identifier },
  });

  return { success: true, email };
}
