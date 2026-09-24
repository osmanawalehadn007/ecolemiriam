/**
 * Nettoyage des matières en base :
 * 1. Renommer les matières avec initiales vers leur nom complet
 * 2. Assigner des couleurs à chaque matière
 * 3. Normaliser les noms (Poésie/Chant → Poésie-Chant, etc.)
 *
 * RÈGLE : Le numéro suffixe d'une matière indique le NIVEAU (1-5 pour le primaire).
 * "Lecture 1" = matière "Lecture" pour le niveau 1 (1ère année).
 * Ce script ne modifie que les noms/couleurs des matières, pas les créneaux.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
const TENANT_ID = "cms8kt0b40001zbi3o63y7c5v";

/** Palette de couleurs pour les matières (hex). */
const COULEURS = [
  "#3b82f6", // bleu
  "#ef4444", // rouge
  "#f59e0b", // ambre
  "#8b5cf6", // violet
  "#10b981", // émeraude
  "#f97316", // orange
  "#ec4899", // rose
  "#14b8a6", // sarcelle
  "#6366f1", // indigo
  "#84cc16", // citron vert
  "#06b6d4", // cyan
  "#a855f7", // pourpre
  "#eab308", // jaune
  "#64748b", // ardoise
  "#dc2626", // rose-rouge
];

/** Mapping : ancien nom → nouveau nom (nettoyé, sans initiales). */
const RENOMMAGES: Record<string, string> = {
  // Codes/initiales → noms complets
  "LECTURE": "Lecture",
  "LANGAGE": "Langage",
  "ARABE": "Arabe",
  "ANGLAIS": "Anglais",
  "POESIE/ CHANT": "Poésie-Chant",
  "POESIE/CHANT": "Poésie-Chant",
  " ÉDUCATION MORALE CIVIQUE ET ISLAMIQUE": "Éducation Morale Civique et Islamique",
  "ÉDUCATION MORALE CIVIQUE ET ISLAMIQUE": "Éducation Morale Civique et Islamique",
  "EMCI  (soutien) 20  ou 25 min": "Éducation Morale Civique et Islamique",
  "EMCI  (soutien) 20  ou 25 min": "Éducation Morale Civique et Islamique",
  "EMT 20 min  (soutien)": "Éducation Morale et Travaux",
  "H.G 45  ou 60 min": "Histoire-Géographie",
  "Outil de langue 15 ou 20 min": "Outil de Langue",
  "PROJET DE LA CLASSE 20  ou 25 min  (soutien)": "Projet de la Classe",
  "Lecture soutien ": "Lecture Soutien",
  "Lecture Plaisir ": "Lecture Plaisir",
  "Production écrite ": "Production Écrite",
  "Science de la vie et de la terre  ": "Sciences de la Vie et de la Terre",
  "INFORMATION ET GESTION  ": "Information et Gestion",
  "Science Economie et Sociale  ": "Sciences Économiques et Sociales",
  "Economie et Droit  ": "Économie et Droit",
};

async function main() {
  const matieres = await prisma.matiere.findMany({
    where: { tenantId: TENANT_ID },
    select: { id: true, nom: true, code: true, couleur: true, niveau: true },
  });

  console.log(`=== ${matieres.length} matières trouvées ===\n`);

  let colorIdx = 0;
  let modifications = 0;

  for (const m of matieres) {
    const updates: { nom?: string; couleur?: string } = {};

    // 1. Renommer si nécessaire
    const nouveauNom = RENOMMAGES[m.nom];
    if (nouveauNom && nouveauNom !== m.nom) {
      updates.nom = nouveauNom;
    }

    // 2. Assigner une couleur si manquante
    if (!m.couleur) {
      updates.couleur = COULEURS[colorIdx % COULEURS.length];
      colorIdx++;
    }

    if (Object.keys(updates).length > 0) {
      await prisma.matiere.update({
        where: { id: m.id },
        data: updates,
      });
      modifications++;
      const anciensChangements = [
        updates.nom ? `nom: "${m.nom}" → "${updates.nom}"` : null,
        updates.couleur ? `couleur: ${updates.couleur}` : null,
      ].filter(Boolean);
      console.log(`  [MOD] ${m.nom}: ${anciensChangements.join(", ")}`);
    } else {
      console.log(`  [OK]  ${m.nom}  couleur=${m.couleur}  niveau=${m.niveau}`);
    }
  }

  console.log(`\n${modifications} matières modifiées sur ${matieres.length}`);

  // 3. Vérification finale
  const finales = await prisma.matiere.findMany({
    where: { tenantId: TENANT_ID },
    select: { id: true, nom: true, code: true, couleur: true, niveau: true },
    orderBy: { nom: "asc" },
  });

  console.log(`\n=== Matières finales (${finales.length}) ===`);
  for (const m of finales) {
    console.log(`  ${m.nom.padEnd(45)}  code=${(m.code ?? "").padEnd(8)}  couleur=${m.couleur ?? "null"}  niveau=${m.niveau ?? "null"}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("Erreur:", e);
  process.exit(1);
});
