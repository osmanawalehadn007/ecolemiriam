/**
 * École Miriam — Sanitization des inputs utilisateur
 * ============================================================
 * Fonctions de nettoyage pour les données saisies par l'utilisateur.
 * Complète la validation Zod en neutralisant les caractères dangereux.
 */

/**
 * Supprime les caractères de contrôle et null bytes d'une chaîne.
 * Empêche les attaques par injection de caractères cachés, CRLF injection,
 * et les null bytes qui peuvent tromper les validations.
 */
export function sanitizeString(input: string): string {
  if (typeof input !== "string") return "";
  // Supprimer les null bytes et caractères de contrôle (sauf tab, newline, CR)
  return input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

/**
 * Nettoie un nom propre : supprime les caractères de contrôle, les balises
 * HTML, et normalise les espaces. Garde les accents et caractères internationaux.
 */
export function sanitizeName(input: string): string {
  return sanitizeString(input)
    .replace(/<[^>]*>/g, "") // supprimer balises HTML
    .replace(/\s+/g, " ") // normaliser espaces
    .trim()
    .slice(0, 200); // limite raisonnable
}

/**
 * Nettoie un texte libre (notes, motifs, descriptions).
 * Supprime les balises HTML script/style, les caractères de contrôle.
 * Conserve les retours à la ligne.
 */
export function sanitizeText(input: string): string {
  return sanitizeString(input)
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, "")
    .replace(/javascript:/gi, "")
    .replace(/on\w+\s*=/gi, "") // onerror=, onclick=, etc.
    .trim()
    .slice(0, 5000);
}

/**
 * Nettoie un email : trim, lowercase, validation format.
 */
export function sanitizeEmail(input: string): string {
  return sanitizeString(input).trim().toLowerCase().slice(0, 254);
}

/**
 * Nettoie un numéro de téléphone : garde uniquement les chiffres et +.
 */
export function sanitizePhone(input: string): string {
  return sanitizeString(input).replace(/[^\d+]/g, "").slice(0, 20);
}

/**
 * Nettoie une URL : supprime les protocoles dangereux (javascript:, data:).
 */
export function sanitizeUrl(input: string): string {
  const cleaned = sanitizeString(input).trim();
  if (/^javascript:/i.test(cleaned)) return "";
  if (/^data:/i.test(cleaned) && !/^data:image\//i.test(cleaned)) return "";
  return cleaned.slice(0, 2048);
}
