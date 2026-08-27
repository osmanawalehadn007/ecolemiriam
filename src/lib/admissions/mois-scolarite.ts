/**
 * École Miriam — Mois de scolarité facturé à l'admission
 * =======================================================
 * La facture d'inscription générée au passage à ADMIS inclut :
 *   1. Les frais d'inscription (one-time)
 *   2. Une mensualité de scolarité
 *
 * Le mois de cette mensualité dépend de la période :
 *   - En août / septembre (rentrée) → septembre par défaut.
 *   - Après septembre → le mois en cours par défaut.
 * Dans tous les cas l'utilisateur peut choisir un autre mois de l'année
 * scolaire via le sélecteur au moment de l'admission.
 *
 * Représentation : chaîne "YYYY-MM" (mois sur 1-12), ex. "2026-09".
 * Source unique de vérité partagée entre le formulaire (client) et la route
 * de génération de facture (serveur).
 */

const MOIS_FR = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];

/** `true` si la chaîne est un mois valide au format "YYYY-MM". */
export function isMoisScolariteValide(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/** Formate "YYYY-MM" → "Septembre 2026". Renvoie la chaîne brute si invalide. */
export function formatMoisScolarite(value: string): string {
  if (!isMoisScolariteValide(value)) return value;
  const [annee, mois] = value.split("-").map(Number);
  return `${MOIS_FR[mois - 1]} ${annee}`;
}

/**
 * Premier mois de l'année scolaire qui contient `now` (toujours un septembre).
 * Août et au-delà → septembre de l'année courante ; janvier-juillet →
 * septembre de l'année précédente.
 */
function debutAnneeScolaire(now: Date): { annee: number; mois: number } {
  const y = now.getFullYear();
  const m = now.getMonth(); // 0-11
  return m >= 7 ? { annee: y, mois: 9 } : { annee: y - 1, mois: 9 };
}

/**
 * Mois de scolarité par défaut ("YYYY-MM") selon la date du jour :
 *   - août (7) ou septembre (8) → septembre de l'année courante ;
 *   - sinon → mois en cours.
 */
export function moisScolariteDefaut(now: Date = new Date()): string {
  const m = now.getMonth(); // 0-11
  if (m === 7 || m === 8) {
    return `${now.getFullYear()}-09`;
  }
  const mois1 = m + 1; // 1-12
  return `${now.getFullYear()}-${String(mois1).padStart(2, "0")}`;
}

/**
 * Options de mois proposées dans le sélecteur d'admission : les 12 mois de
 * l'année scolaire en cours (septembre → août), format `{ value, label }`.
 */
export function optionsMoisScolarite(
  now: Date = new Date()
): { value: string; label: string }[] {
  const debut = debutAnneeScolaire(now);
  const options: { value: string; label: string }[] = [];
  for (let i = 0; i < 12; i++) {
    const moisIndex = (debut.mois - 1 + i) % 12; // 0-11
    const annee = debut.annee + Math.floor((debut.mois - 1 + i) / 12);
    const value = `${annee}-${String(moisIndex + 1).padStart(2, "0")}`;
    options.push({ value, label: `${MOIS_FR[moisIndex]} ${annee}` });
  }
  return options;
}
