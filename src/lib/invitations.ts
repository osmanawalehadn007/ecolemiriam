import { createHash, randomBytes } from "crypto";

/**
 * ============================================================
 * EcolPro — Invitations d'utilisateurs (cœur métier, sans I/O)
 * ============================================================
 *
 * Principes de sécurité :
 *  - Le jeton n'est jamais stocké en clair : seule son empreinte SHA-256 est
 *    persistée (`Invitation.tokenHash`). Un vol de la table ne permet donc pas
 *    de rejouer une invitation.
 *  - Le jeton est aléatoire (256 bits) et à usage unique.
 *  - Il expire (`INVITATION_TTL_HOURS`).
 *
 * Ce module est volontairement PUR (aucun accès base ni réseau) pour être
 * testable sans mock et réutilisable côté serveur uniquement.
 */

/** Durée de validité d'une invitation (heures). */
export const INVITATION_TTL_HOURS = 72;

/** Chemin public d'acceptation d'une invitation. */
export const INVITATION_URL_PATH = "/accept-invitation";

/** Longueur minimale d'un mot de passe choisi par l'utilisateur invité. */
export const MIN_PASSWORD_LENGTH = 10;

/** Rôles qu'un administrateur peut attribuer via une invitation. */
export const INVITABLE_ROLES = [
  "TENANT_ADMIN",
  "PRINCIPAL",
  "SECRETARY",
  "TEACHER",
  "CLASS_TEACHER",
  "COUNSELOR",
  "NURSE",
  "ACCOUNTANT",
  "PARENT",
] as const;

export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export function isInvitableRole(role: string): role is InvitableRole {
  return (INVITABLE_ROLES as readonly string[]).includes(role);
}

/** Jeton brut (transmis par email) + empreinte (persistée). */
export interface GeneratedInvitationToken {
  token: string;
  tokenHash: string;
}

/**
 * Génère un jeton d'invitation cryptographiquement sûr (256 bits, base64url)
 * et l'empreinte SHA-256 à stocker en base.
 */
export function generateInvitationToken(): GeneratedInvitationToken {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashInvitationToken(token) };
}

/** Empreinte SHA-256 (hex) — utilisée pour la recherche par jeton. */
export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Date d'expiration à partir de maintenant (ou d'une date donnée). */
export function invitationExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + INVITATION_TTL_HOURS * 60 * 60 * 1000);
}

export function isInvitationExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime();
}

/** URL absolue à envoyer par email. */
export function buildInvitationUrl(token: string, baseUrl?: string): string {
  const base =
    baseUrl ??
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.AUTH_URL ??
    "http://localhost:3000";
  return `${base.replace(/\/+$/, "")}${INVITATION_URL_PATH}?token=${encodeURIComponent(token)}`;
}

/**
 * Politique de mot de passe pour les comptes créés via invitation.
 * Retourne un message d'erreur, ou `null` si le mot de passe est acceptable.
 */
export function validatePasswordStrength(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères`;
  }
  if (!/[A-Za-z]/.test(password)) {
    return "Le mot de passe doit contenir au moins une lettre";
  }
  if (!/[0-9]/.test(password)) {
    return "Le mot de passe doit contenir au moins un chiffre";
  }
  return null;
}

/**
 * Gabarit HTML de l'email d'invitation (bouton d'action + lien de secours).
 */
export function renderInvitationEmail(params: {
  tenantName: string;
  inviterName?: string | null;
  email: string;
  role: string;
  inviteUrl: string;
  expiresAt: Date;
}): string {
  const { tenantName, inviterName, email, role, inviteUrl, expiresAt } = params;
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const expires = expiresAt.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  return `<!DOCTYPE html>
<html lang="fr"><body style="margin:0;background:#f4f4f7;font-family:-apple-system,Segoe UI,Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.06);">
        <tr><td style="background:#4f46e5;padding:20px 28px;color:#fff;font-size:18px;font-weight:700;">${esc(tenantName)}</td></tr>
        <tr><td style="padding:28px;">
          <h1 style="margin:0 0 12px;font-size:20px;color:#111;">Vous êtes invité(e) sur EcolPro</h1>
          <p style="font-size:15px;line-height:1.6;color:#374151;">
            ${inviterName ? `${esc(inviterName)} vous invite` : "Vous êtes invité(e)"} à rejoindre
            <strong>${esc(tenantName)}</strong> sur EcolPro avec le rôle
            <strong>${esc(role)}</strong>.
          </p>
          <p style="font-size:15px;line-height:1.6;color:#374151;">
            Cliquez sur le bouton ci-dessous pour créer votre mot de passe et activer votre compte.
            Ce lien est valable jusqu'au <strong>${esc(expires)}</strong> et ne peut être utilisé qu'une fois.
          </p>
          <p style="text-align:center;margin:28px 0;">
            <a href="${esc(inviteUrl)}" style="background:#4f46e5;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;display:inline-block;">Créer mon compte</a>
          </p>
          <p style="font-size:12px;color:#6b7280;line-height:1.6;">
            Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :<br />
            <span style="word-break:break-all;color:#4f46e5;">${esc(inviteUrl)}</span>
          </p>
          <p style="font-size:12px;color:#9ca3af;line-height:1.6;">
            Cet email a été envoyé à ${esc(email)}. Si vous n'êtes pas à l'origine de cette demande,
            ignorez simplement ce message.
          </p>
        </td></tr>
        <tr><td style="padding:16px 28px;border-top:1px solid #eee;font-size:12px;color:#9ca3af;">
          Envoyé via EcolPro — merci de ne pas répondre à cet email.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

