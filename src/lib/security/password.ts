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
 * Valide la robustesse d'un mot de passe.
 * @returns null si valide, sinon un message d'erreur.
 */
export function validatePasswordStrength(password: string): string | null {
  if (password.length < 8) return "Le mot de passe doit faire au moins 8 caractères";
  if (password.length > 128) return "Le mot de passe est trop long";

  let categories = 0;
  if (/[a-z]/.test(password)) categories++;
  if (/[A-Z]/.test(password)) categories++;
  if (/[0-9]/.test(password)) categories++;
  if (/[^a-zA-Z0-9]/.test(password)) categories++;

  if (categories < 3) {
    return "Le mot de passe doit contenir au moins 3 des 4 catégories : minuscules, majuscules, chiffres, caractères spéciaux";
  }

  // Détecter les mots de passe courants faibles
  const common = ["password", "123456", "admin", "ecolemiriam", "miriam", "00000000"];
  if (common.some((c) => password.toLowerCase().includes(c))) {
    return "Ce mot de passe est trop commun";
  }

  return null;
}
