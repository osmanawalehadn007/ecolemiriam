/**
 * Modèles de matières par défaut du collège et du lycée, tirés des classeurs
 * Excel de l'école (« 8eme1 bulletin », « Seconde », « 1erGFM bulletin »).
 *
 * Dans ces classeurs, la moyenne générale est la moyenne simple des matières :
 * toutes ont donc le coefficient 1. `niveau` suit la convention de
 * `Matiere.niveau` (numéro du niveau : 8, 10 pour la Seconde, 11 pour la
 * Première, voir AGENTS.md § « Règles d'affichage des matières »).
 *
 * Le modèle « 1ère GFM » s'applique au niveau 11 : les matières de la filière
 * (gestion, mercatique, management…) sont donc créées pour tout le niveau
 * Première, pas pour la seule classe GFM.
 */

export interface MatiereModele {
  nom: string;
  code: string;
  coefficient: number;
  couleur: string;
}

export interface ModeleMatieres {
  id: "college-8eme" | "lycee-seconde" | "lycee-premiere-gfm";
  libelle: string;
  /** Valeur de `Matiere.niveau`. */
  niveau: string;
  matieres: MatiereModele[];
}

// Palette de la grille d'emploi du temps (matiereColor dans EmploiDuTempsView).
const COULEURS = [
  "#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899",
  "#14b8a6", "#f97316", "#6366f1", "#84cc16", "#06b6d4",
];

function matieres(liste: [nom: string, code: string][]): MatiereModele[] {
  return liste.map(([nom, code], i) => ({ nom, code, coefficient: 1, couleur: COULEURS[i % COULEURS.length] }));
}

export const MODELES_MATIERES: ModeleMatieres[] = [
  {
    id: "college-8eme",
    libelle: "8ème année (collège)",
    niveau: "8",
    matieres: matieres([
      ["Français", "FR"],
      ["Maths", "MATH"],
      ["Physique-Chimie", "PC"],
      ["SVT", "SVT"],
      ["Hist-Géo", "HG"],
      ["Anglais", "ANG"],
      ["Arabe", "AR"],
    ]),
  },
  {
    id: "lycee-seconde",
    libelle: "Seconde (lycée)",
    niveau: "10",
    matieres: matieres([
      ["Français", "FR"],
      ["Maths", "MATH"],
      ["Physique-Chimie", "PC"],
      ["SVT", "SVT"],
      ["Hist-Géo", "HG"],
      ["Anglais", "ANG"],
      ["Arabe", "AR"],
      ["Informatique", "INFO"],
      ["SES", "SES"],
    ]),
  },
  {
    id: "lycee-premiere-gfm",
    libelle: "1ère GFM (lycée)",
    niveau: "11",
    matieres: matieres([
      ["Français", "FR"],
      ["Maths", "MATH"],
      ["Gestion financière", "GF"],
      ["Mercatique", "MERC"],
      ["Hist-Géo", "HG"],
      ["Anglais", "ANG"],
      ["Arabe", "AR"],
      ["Communication", "COM"],
      ["Économie-Droit", "ECO"],
      ["Management", "MGT"],
      ["Principe de gestion", "PG"],
    ]),
  },
];

export function trouverModele(id: string): ModeleMatieres | undefined {
  return MODELES_MATIERES.find((m) => m.id === id);
}

/** Comparaison tolérante : sans accents, casse, tirets ni espaces multiples. */
export function normaliserNom(nom: string): string {
  return nom
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[-.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Matières du modèle qui n'existent pas encore. Une matière existante la
 * couvre si elle porte le même nom et le même niveau, ou aucun niveau
 * (matière commune à tous les niveaux).
 */
export function matieresACreer(
  modele: ModeleMatieres,
  existantes: { nom: string; niveau: string | null }[]
): MatiereModele[] {
  return modele.matieres.filter((m) => {
    const nom = normaliserNom(m.nom);
    return !existantes.some(
      (e) => normaliserNom(e.nom) === nom && (e.niveau === null || e.niveau === "" || e.niveau === modele.niveau)
    );
  });
}
