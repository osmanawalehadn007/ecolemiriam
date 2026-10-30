/**
 * Découpe une année scolaire en trois trimestres de durée égale.
 * Les bulletins, les évaluations et les notes sont rattachés à une période :
 * sans période, aucun bulletin ne peut être généré.
 */
export type PeriodeADefaut = { nom: string; numero: number; dateDebut: Date; dateFin: Date };

const JOUR = 86_400_000;

export function decouperEnTrimestres(dateDebut: Date, dateFin: Date): PeriodeADefaut[] {
  const total = dateFin.getTime() - dateDebut.getTime();
  const tiers = Math.floor(total / 3);
  return [1, 2, 3].map((numero) => {
    const debut = numero === 1 ? dateDebut : new Date(dateDebut.getTime() + tiers * (numero - 1) + JOUR);
    const fin = numero === 3 ? dateFin : new Date(dateDebut.getTime() + tiers * numero);
    return { nom: `Trimestre ${numero}`, numero, dateDebut: debut, dateFin: fin };
  });
}
