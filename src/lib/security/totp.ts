/**
 * École Miriam — Utilitaires TOTP pour la 2FA
 * ============================================================
 * Génération de secrets, QR codes et vérification de codes TOTP
 * compatibles Google Authenticator, Authy, Microsoft Authenticator, etc.
 */

import { generateSecret, generateURI, generateSync, verifySync } from "otplib";
import QRCode from "qrcode";

/**
 * Génère un secret TOTP aléatoire (base32).
 */
export function generateTOTPSecret(): string {
  return generateSecret();
}

/**
 * Génère l'URI otpauth:// pour le QR code.
 */
export function generateOTPAuthURI(
  secret: string,
  email: string,
  issuer = "École Miriam"
): string {
  return generateURI({ issuer, label: email, secret });
}

/**
 * Génère un QR code en data URL (base64 PNG) à partir d'un URI otpauth.
 */
export async function generateQRCodeDataURL(otpauthURI: string): Promise<string> {
  return QRCode.toDataURL(otpauthURI, {
    width: 256,
    margin: 2,
    color: { dark: "#000000", light: "#ffffff" },
  });
}

/**
 * Vérifie un code TOTP (6 chiffres) contre un secret.
 * @returns true si le code est valide
 */
export function verifyTOTP(token: string, secret: string): boolean {
  try {
    const result = verifySync({ token, secret, epochTolerance: 30 });
    return result.valid;
  } catch {
    return false;
  }
}

/**
 * Génère le code TOTP actuel pour un secret (utile pour les tests).
 */
export function generateCurrentToken(secret: string): string {
  return generateSync({ secret });
}
