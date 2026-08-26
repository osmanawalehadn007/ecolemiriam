/**
 * École Miriam — Utilitaires de sécurité pour les mots de passe
 * ============================================================
 */

import crypto from "crypto";

const LOWERCASE = "abcdefghijkmnopqrstuvwxyz"; // sans l
const UPPERCASE = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // sans I, O
const DIGITS = "23456789"; // sans 0, 1
const SPECIALS = "!@#$%^&*-_=+?";

/**
 * Génère un mot de passe aléatoire fort de 16 caractères.
 * Garantit au moins 1 minuscule, 1 majuscule, 1 chiffre, 1 spécial.
 * Utilise crypto.randomBytes (CSPRNG) — pas Math.random().
 */
export function generateSecurePassword(length = 16): string {
  const allChars = LOWERCASE + UPPERCASE + DIGITS + SPECIALS;
  const bytes = crypto.randomBytes(length);

  // Garantir au moins un caractère de chaque catégorie
  const password: string[] = [
    LOWERCASE[bytes[0] % LOWERCASE.length],
    UPPERCASE[bytes[1] % UPPERCASE.length],
    DIGITS[bytes[2] % DIGITS.length],
    SPECIALS[bytes[3] % SPECIALS.length],
  ];

  for (let i = 4; i < length; i++) {
    password.push(allChars[bytes[i] % allChars.length]);
  }

  // Mélanger avec crypto (Fisher-Yates)
  for (let i = password.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [password[i], password[j]] = [password[j], password[i]];
  }

  return password.join("");
}

/**
 * Règles de robustesse affichées à l'utilisateur (réutilisable côté client/serveur).
 */
export const PASSWORD_REQUIREMENTS_HINT =
  "Le mot de passe doit obligatoirement contenir au moins 8 caractères et inclure " +
  "au moins 3 des 4 catégories suivantes : minuscules (a-z), majuscules (A-Z), " +
  "chiffres (0-9) et caractères spéciaux (!@#$%…).";

/**
 * Valide la robustesse d'un mot de passe.
 * @returns null si valide, sinon un message d'erreur détaillant les exigences.
 */
export function validatePasswordStrength(password: string): string | null {
  if (password.length < 8) {
    return "Le mot de passe est trop court : il doit obligatoirement contenir au moins 8 caractères.";
  }
  if (password.length > 128) return "Le mot de passe est trop long (128 caractères maximum).";

  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasDigit = /[0-9]/.test(password);
  const hasSpecial = /[^a-zA-Z0-9]/.test(password);
  const categories = [hasLower, hasUpper, hasDigit, hasSpecial].filter(Boolean).length;

  if (categories < 3) {
    const manquantes: string[] = [];
    if (!hasLower) manquantes.push("une minuscule (a-z)");
    if (!hasUpper) manquantes.push("une majuscule (A-Z)");
    if (!hasDigit) manquantes.push("un chiffre (0-9)");
    if (!hasSpecial) manquantes.push("un caractère spécial (!@#$%…)");

    return (
      "Le mot de passe doit obligatoirement inclure au moins 3 des 4 catégories " +
      "suivantes : minuscules (a-z), majuscules (A-Z), chiffres (0-9), caractères spéciaux (!@#$%…). " +
      `Il manque actuellement : ${manquantes.join(", ")}.`
    );
  }

  // Détecter les mots de passe courants faibles
  const common = ["password", "123456", "admin", "ecolemiriam", "miriam", "00000000"];
  if (common.some((c) => password.toLowerCase().includes(c))) {
    return "Ce mot de passe est trop commun. Choisissez un mot de passe plus original.";
  }

  return null;
}
