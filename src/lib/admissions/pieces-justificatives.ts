/**
 * École Miriam — Pièces justificatives requises pour les admissions
 * ============================================================
 * Définit la liste des documents obligatoires et optionnels
 * qu'un candidat doit fournir pour que son dossier soit complet.
 */

export interface PieceJustificative {
  /** Identifiant unique (utilisé comme clé dans le tableau documents) */
  id: string;
  /** Libellé affiché à l'utilisateur */
  label: string;
  /** Types MIME acceptés */
  accept: string[];
  /** Taille maximale en bytes */
  maxSize: number;
  /** true = obligatoire pour passer à DOSSIER_COMPLET */
  required: boolean;
  /** Description affichée sous le label */
  description?: string;
}

export const PIECES_JUSTIFICATIVES: PieceJustificative[] = [
  {
    id: "acte_naissance",
    label: "Acte de naissance",
    accept: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
    maxSize: 5 * 1024 * 1024, // 5 MB
    required: true,
    description: "Copie lisible de l'acte de naissance de l'élève",
  },
  {
    id: "photo_identite",
    label: "Photo d'identité",
    accept: ["image/jpeg", "image/png", "image/webp"],
    maxSize: 2 * 1024 * 1024, // 2 MB
    required: true,
    description: "Photo d'identité récente de l'élève",
  },
  {
    id: "carte_identite_parent",
    label: "Carte d'identité du parent",
    accept: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
    maxSize: 5 * 1024 * 1024, // 5 MB
    required: true,
    description: "Pièce d'identité du parent ou tuteur légal",
  },
  {
    id: "bulletin_precedent",
    label: "Bulletin de l'année précédente",
    accept: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
    maxSize: 5 * 1024 * 1024, // 5 MB
    required: false,
    description: "Dernier bulletin de notes (si applicable)",
  },
  {
    id: "certificat_transfert",
    label: "Certificat de transfert",
    accept: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
    maxSize: 5 * 1024 * 1024, // 5 MB
    required: false,
    description: "Certificat de transfert de l'ancien établissement (si applicable)",
  },
];

export const PIECES_REQUISES = PIECES_JUSTIFICATIVES.filter((p) => p.required);

/**
 * Vérifie si toutes les pièces obligatoires sont présentes dans
 * le tableau de documents fourni.
 */
export function piecesRequisesPresentes(documents: { nom: string; url: string }[]): {
  complet: boolean;
  manquantes: string[];
} {
  const idsPresent = new Set(documents.map((d) => d.nom));
  const manquantes = PIECES_REQUISES
    .filter((p) => !idsPresent.has(p.id))
    .map((p) => p.label);
  return {
    complet: manquantes.length === 0,
    manquantes,
  };
}
