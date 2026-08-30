/**
 * École Miriam — Configuration dynamique de la grille horaire
 * ============================================================
 * La grille standard (collège/lycée) utilise des pas de 30 min (07:00→17:30).
 * Pour le maternel et le primaire, les enseignants ont besoin d'une grille
 * plus fine (pas de 10 ou 15 min) avec des durées de séance variables
 * (10, 15, 20, 30, 35, 45, 50 min) sélectionnables via un sélecteur à flèches.
 *
 * La décision se prend selon le `type` de la Structure pédagogique de la
 * classe sélectionnée (MATERNELLE / PRIMAIRE / COLLEGE / LYCEE), qui est
 * lui-même rattaché à un Site. Quand l'utilisateur sélectionne un site dont
 * les structures sont de type maternel/primaire, la grille fine s'affiche.
 */

export type StructureType = "MATERNELLE" | "PRIMAIRE" | "COLLEGE" | "LYCEE" | "";

/** Types de structure qui déclenchent la grille fine (maternel + primaire). */
export const FINE_GRID_TYPES: ReadonlySet<string> = new Set(["MATERNELLE", "PRIMAIRE"]);

/** Pas de grille disponibles selon le type de structure. */
export const GRID_STEP_FINE = 10; // minutes
export const GRID_STEP_STANDARD = 30; // minutes

/** Durées de séance sélectionnables dans le sélecteur à flèches. */
export const FINE_DURATIONS = [10, 15, 20, 30, 35, 45, 50] as const;
export type FineDuration = (typeof FINE_DURATIONS)[number];

/** Durées standards (collège/lycée) — pas de 30 min, donc multiples de 30. */
export const STANDARD_DURATIONS = [30, 60, 90, 120] as const;

/** Plage horaire par défaut. */
export const DAY_START = "07:00";
export const DAY_END = "18:00";

/** Hauteur de cellule en pixels selon le pas de grille. */
export const SLOT_HEIGHT_FINE = 24; // 10 min → grille plus dense, cellules plus petites
export const SLOT_HEIGHT_STANDARD = 48; // 30 min

export interface GridConfig {
  /** Pas de la grille en minutes (10 pour maternel/primaire, 30 sinon). */
  stepMinutes: number;
  /** Hauteur de chaque cellule en pixels. */
  slotHeight: number;
  /** Tous les slots horaires de la journée (ex: ["07:00", "07:10", "07:20", ...]). */
  slots: string[];
  /** Durées de séance disponibles pour le sélecteur. */
  durations: readonly number[];
  /** True si la grille fine est active (maternel/primaire). */
  isFineGrid: boolean;
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function minutesToTime(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Génère la liste des slots horaires pour une plage et un pas donnés. */
function buildSlots(start: string, end: string, stepMinutes: number): string[] {
  const startMin = timeToMinutes(start);
  const endMin = timeToMinutes(end);
  const slots: string[] = [];
  for (let m = startMin; m < endMin; m += stepMinutes) {
    slots.push(minutesToTime(m));
  }
  // Inclure l'heure de fin comme dernier slot (pour le select "heureFin")
  slots.push(minutesToTime(endMin));
  return slots;
}

/**
 * Construit la configuration de grille selon le type de structure.
 *
 * @param structureType - Type de la structure pédagogique ("MATERNELLE",
 *   "PRIMAIRE", "COLLEGE", "LYCEE", ou "" si la classe n'a pas de structure).
 * @param dayStart - Heure de début (défaut "07:00").
 * @param dayEnd - Heure de fin (défaut "18:00").
 */
export function getGridConfig(
  structureType: string | null | undefined,
  dayStart: string = DAY_START,
  dayEnd: string = DAY_END,
): GridConfig {
  const isFine = structureType ? FINE_GRID_TYPES.has(structureType) : false;
  const stepMinutes = isFine ? GRID_STEP_FINE : GRID_STEP_STANDARD;
  const slotHeight = isFine ? SLOT_HEIGHT_FINE : SLOT_HEIGHT_STANDARD;
  const durations = isFine ? FINE_DURATIONS : STANDARD_DURATIONS;
  const slots = buildSlots(dayStart, dayEnd, stepMinutes);

  return {
    stepMinutes,
    slotHeight,
    slots,
    durations,
    isFineGrid: isFine,
  };
}

/**
 * Détermine le type de structure d'une classe à partir de ses métadonnées.
 * Utilisé côté composant client où la structure est déjà résolue.
 */
export function getStructureTypeFromClasse(
  classe: { structure?: { type?: string | null } | null } | null | undefined,
): string {
  return classe?.structure?.type ?? "";
}

/**
 * Vérifie si un type de structure déclenche la grille fine.
 */
export function isFineGridType(structureType: string | null | undefined): boolean {
  return structureType ? FINE_GRID_TYPES.has(structureType) : false;
}

/**
 * Calcule l'heure de fin à partir d'une heure de début et d'une durée en minutes.
 */
export function computeEndTime(heureDebut: string, durationMinutes: number): string {
  const debutMin = timeToMinutes(heureDebut);
  return minutesToTime(debutMin + durationMinutes);
}

/**
 * Calcule la durée en minutes entre deux heures.
 */
export function computeDuration(heureDebut: string, heureFin: string): number {
  return timeToMinutes(heureFin) - timeToMinutes(heureDebut);
}

/**
 * Vérifie qu'une heure de début + durée reste dans la plage horaire.
 */
export function isDurationValid(
  heureDebut: string,
  durationMinutes: number,
  dayEnd: string = DAY_END,
): boolean {
  const debutMin = timeToMinutes(heureDebut);
  return debutMin + durationMinutes <= timeToMinutes(dayEnd);
}

/**
 * Génère les options d'heure de début valides pour une grille donnée,
 * en filtrant celles qui ne permettent pas de caser la durée sélectionnée.
 */
export function getValidStartSlots(
  slots: string[],
  durationMinutes: number,
  dayEnd: string = DAY_END,
): string[] {
  const endMin = timeToMinutes(dayEnd);
  return slots.filter((slot) => {
    const slotMin = timeToMinutes(slot);
    return slotMin + durationMinutes <= endMin;
  });
}
