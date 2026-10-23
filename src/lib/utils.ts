import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Formate une date en français */
export function formatDate(date: Date | string, fmt = "dd MMMM yyyy") {
  return format(new Date(date), fmt, { locale: fr });
}

/**
 * Date et heure d'un événement horodaté (ex. encaissement), toujours à l'heure
 * de Djibouti : le même instant s'affiche pareil sur le serveur (UTC) et dans
 * le navigateur, sans écart d'hydratation ni décalage de 3 h sur les reçus.
 */
const TZ_DJIBOUTI = "Africa/Djibouti";
const fmtJour = new Intl.DateTimeFormat("fr-FR", { timeZone: TZ_DJIBOUTI, day: "2-digit", month: "2-digit", year: "numeric" });
const fmtHeure = new Intl.DateTimeFormat("fr-FR", { timeZone: TZ_DJIBOUTI, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });

/** « 14:32:07 » */
export function formatHeure(date: Date | string) {
  return fmtHeure.format(new Date(date));
}

/** « 05/10/2026 » (heure de Djibouti) */
export function formatJour(date: Date | string) {
  return fmtJour.format(new Date(date));
}

/** Heure de l'horloge de Djibouti, 0 à 23. */
export function heureDjibouti(date: Date | string): number {
  return parseInt(fmtHeure.format(new Date(date)).slice(0, 2), 10);
}

/** Heure de bascule entre la matinée et l'après-midi (13 h, heure de Djibouti). */
export const HEURE_BASCULE_DEMI_JOURNEE = 13;

/** « matin » avant 13 h, « apres_midi » à partir de 13 h (heure de Djibouti). */
export function demiJournee(date: Date | string): "matin" | "apres_midi" {
  return heureDjibouti(date) < HEURE_BASCULE_DEMI_JOURNEE ? "matin" : "apres_midi";
}

/** « 05/10/2026 14:32:07 » */
export function formatDateHeure(date: Date | string) {
  const d = new Date(date);
  return `${fmtJour.format(d)} ${fmtHeure.format(d)}`;
}

/** Temps relatif en français : "il y a 3 minutes" */
export function timeAgo(date: Date | string) {
  return formatDistanceToNow(new Date(date), { addSuffix: true, locale: fr });
}

/** Génère un matricule unique */
export function generateMatricule(annee: string, sequence: number): string {
  const year = annee.split("-")[0].slice(-2); // "25" pour 2025
  return `${year}-${String(sequence).padStart(4, "0")}`;
}

/** Formate un montant dans la devise spécifiée (DJF par défaut) */
export function formatCurrency(
  amount: number,
  currency = "DJF",
  locale = "fr-DJ"
): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

/** Calcule la moyenne pondérée */
export function calculerMoyenne(
  notes: { valeur: number; noteMax: number; coefficient: number }[]
): number | null {
  if (notes.length === 0) return null;

  const totalPondere = notes.reduce((sum, n) => {
    const sur20 = (n.valeur / n.noteMax) * 20;
    return sum + sur20 * n.coefficient;
  }, 0);

  const totalCoeff = notes.reduce((sum, n) => sum + n.coefficient, 0);

  if (totalCoeff === 0) return null;
  return Math.round((totalPondere / totalCoeff) * 100) / 100;
}

/** Couleur de note selon la valeur */
export function getNoteColor(note: number, max = 20): string {
  const pct = (note / max) * 100;
  if (pct >= 80) return "text-green-600 dark:text-green-400";
  if (pct >= 60) return "text-blue-600 dark:text-blue-400";
  if (pct >= 50) return "text-yellow-600 dark:text-yellow-400";
  return "text-red-600 dark:text-red-400";
}

/** Badge couleur de note */
export function getNoteBadgeVariant(note: number, max = 20) {
  const pct = (note / max) * 100;
  if (pct >= 80) return "success";
  if (pct >= 60) return "info";
  if (pct >= 50) return "warning";
  return "destructive";
}

/** Initiales d'un nom */
export function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/** Slug depuis un nom */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

const collator = new Intl.Collator("fr", { sensitivity: "base", numeric: true });

/**
 * Comparaison alphabétique française : insensible à la casse et aux accents,
 * nombres triés naturellement ("2ème" avant "10ème", "6ème A" avant "6ème B").
 */
export function compareAlpha(a: string, b: string): number {
  return collator.compare(a, b);
}

/** Tronque un texte */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength).trimEnd() + "…";
}
