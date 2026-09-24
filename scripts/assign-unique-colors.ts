/**
 * Assigne 37 couleurs uniques avec contraste maximum entre elles.
 * Les couleurs sont réparties dans tout l'espace HSL pour maximiser
 * la distinction visuelle.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
const TENANT_ID = "cms8kt0b40001zbi3o63y7c5v";

/**
 * 37 couleurs uniques réparties dans l'espace HSL.
 * On parcourt le cercle chromatique (0-360°) par pas de ~37°,
 * en alternant la luminosité et la saturation pour maximiser le contraste.
 */
const COULEURS_UNIQUES: string[] = [
  "#ef4444", // 1. Rouge
  "#3b82f6", // 2. Bleu
  "#f59e0b", // 3. Ambre/Orange
  "#10b981", // 4. Émeraude
  "#8b5cf6", // 5. Violet
  "#ec4899", // 6. Rose
  "#14b8a6", // 7. Sarcelle
  "#f97316", // 8. Orange foncé
  "#6366f1", // 9. Indigo
  "#84cc16", // 10. Citron vert
  "#06b6d4", // 11. Cyan
  "#a855f7", // 12. Pourpre
  "#eab308", // 13. Jaune
  "#dc2626", // 14. Rouge foncé
  "#0ea5e9", // 15. Bleu ciel
  "#22c55e", // 16. Vert
  "#d946ef", // 17. Magenta
  "#fbbf24", // 18. Jaune ambre
  "#7c3aed", // 19. Violet foncé
  "#059669", // 20. Vert foncé
  "#e11d48", // 21. Rose-rouge foncé
  "#0891b2", // 22. Cyan foncé
  "#ca8a04", // 23. Ambre foncé
  "#2563eb", // 24. Bleu foncé
  "#9333ea", // 25. Pourpre foncé
  "#65a30d", // 26. Citron vert foncé
  "#db2777", // 27. Rose foncé
  "#0d9488", // 28. Sarcelle foncé
  "#c2410c", // 29. Orange brun
  "#4f46e5", // 30. Indigo foncé
  "#16a34a", // 31. Vert moyen
  "#be185d", // 32. Rose profond
  "#1d4ed8", // 33. Bleu royal
  "#b45309", // 34. Brun ambre
  "#15803d", // 35. Vert forêt
  "#86198f", // 36. Pourpre profond
  "#9f1239", // 37. Rouge vin
];

async function main() {
  const matieres = await prisma.matiere.findMany({
    where: { tenantId: TENANT_ID },
    select: { id: true, nom: true, code: true, couleur: true },
    orderBy: { nom: "asc" },
  });

  console.log(`=== ${matieres.length} matières — assignation couleurs uniques ===\n`);

  // Vérifier qu'on a assez de couleurs
  if (matieres.length > COULEURS_UNIQUES.length) {
    console.log(`ATTENTION: ${matieres.length} matières mais seulement ${COULEURS_UNIQUES.length} couleurs!`);
  }

  // Assigner une couleur unique à chaque matière (par ordre alphabétique)
  for (let i = 0; i < matieres.length; i++) {
    const m = matieres[i];
    const couleur = COULEURS_UNIQUES[i % COULEURS_UNIQUES.length];
    const ancienneCouleur = m.couleur;

    await prisma.matiere.update({
      where: { id: m.id },
      data: { couleur },
    });

    const change = ancienneCouleur !== couleur;
    console.log(`  ${change ? "[MOD]" : "[OK]"} ${m.nom.padEnd(45)}  ${ancienneCouleur ?? "null"} → ${couleur}`);
  }

  // Vérification : aucune couleur en double
  const finales = await prisma.matiere.findMany({
    where: { tenantId: TENANT_ID },
    select: { nom: true, couleur: true },
    orderBy: { nom: "asc" },
  });

  const couleursUtilisees = finales.map((m) => m.couleur);
  const doublons = couleursUtilisees.filter((c, i) => couleursUtilisees.indexOf(c) !== i);

  console.log(`\n=== Vérification ===`);
  console.log(`  Total matières: ${finales.length}`);
  console.log(`  Couleurs uniques: ${new Set(couleursUtilisees).size}`);
  if (doublons.length > 0) {
    console.log(`  DOUBLONS: ${doublons.join(", ")}`);
  } else {
    console.log(`  AUCUN DOUBLON — toutes les couleurs sont uniques`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("Erreur:", e);
  process.exit(1);
});
