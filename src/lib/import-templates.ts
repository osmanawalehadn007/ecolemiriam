/**
 * École Miriam — Génération de modèles Excel vierges pour l'import
 * =================================================================
 *
 * Produit des fichiers .xlsx avec les en-têtes corrects et une ligne
 * d'exemple, pour guider l'utilisateur dans le formatage de ses données
 * avant import.
 */

import ExcelJS from "exceljs";

export interface TemplateColumn {
  header: string;
  example: string;
  width?: number;
  note?: string;
}

/**
 * Génère un buffer Excel à partir d'une liste de colonnes.
 * - Ligne 1 : en-têtes
 * - Ligne 2 : exemple (en italique gris)
 * - Lignes 3+ : vides pour saisie
 */
export async function generateTemplate(
  sheetName: string,
  columns: TemplateColumn[],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);

  // En-têtes (ligne 1)
  columns.forEach((col, i) => {
    const cell = ws.getCell(1, i + 1);
    cell.value = col.header;
    cell.font = { bold: true };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF4472C4" },
    };
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.alignment = { vertical: "middle", horizontal: "left" };
    ws.getColumn(i + 1).width = col.width ?? 22;
  });

  // Exemple (ligne 2) — en italique gris pour indiquer que c'est un exemple
  columns.forEach((col, i) => {
    const cell = ws.getCell(2, i + 1);
    cell.value = col.example;
    cell.font = { italic: true, color: { argb: "FF888888" } };
  });

  // Ligne d'aide (ligne 3) — notes sur chaque colonne
  let hasNotes = false;
  columns.forEach((col, i) => {
    if (col.note) {
      const cell = ws.getCell(3, i + 1);
      cell.value = col.note;
      cell.font = { italic: true, size: 9, color: { argb: "FFAAAAAA" } };
      hasNotes = true;
    }
  });

  // Geler la ligne d'en-tête
  ws.views = [{ state: "frozen", ySplit: hasNotes ? 3 : 2 }];

  // Filtres auto sur la ligne d'en-tête
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: columns.length },
  };

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * Modèle pour l'import d'enseignants.
 */
export async function generateEnseignantTemplate(): Promise<Buffer> {
  return generateTemplate("Enseignants", [
    { header: "Nom", example: "AHMED ALI MOHAMED", width: 28, note: "Nom complet (obligatoire)" },
    { header: "Email", example: "ahmed.ali@exemple.com", width: 30, note: "Email unique (obligatoire)" },
    { header: "Site d'affectation", example: "Campus Central", width: 22, note: "Nom exact du site (obligatoire)" },
    { header: "Temps", example: "Plein", width: 12, note: "Plein, TP, CDI / Partiel, PP, CDD (obligatoire)" },
    { header: "Téléphone", example: "+253 77123456", width: 18, note: "Format international (optionnel)" },
    { header: "Matière", example: "Mathématiques", width: 20, note: "Nom de la matière (optionnel)" },
    { header: "Classe", example: "1ère A", width: 16, note: "Nom de la classe (optionnel, auto-créée si inconnue)" },
  ]);
}

/**
 * Modèle pour l'import du personnel (staff non-enseignant).
 */
export async function generatePersonnelTemplate(): Promise<Buffer> {
  return generateTemplate("Personnel", [
    { header: "Nom", example: "AHMED ALI MOHAMED", width: 28, note: "Nom complet (obligatoire)" },
    { header: "Email", example: "ahmed.ali@exemple.com", width: 30, note: "Email unique (obligatoire)" },
    { header: "Site d'affectation", example: "Campus Central", width: 22, note: "Nom exact du site (obligatoire)" },
    { header: "Rôle", example: "SECRETAIRE", width: 18, note: "SECRETAIRE, GESTIONNAIRE, COMPTABLE, INFIRMIER, CONSEILLER, SURVEILLANT (obligatoire)" },
    { header: "Téléphone", example: "+253 77123456", width: 18, note: "Format international (optionnel)" },
    { header: "Fonction", example: "Secrétaire de direction", width: 25, note: "Description du poste (optionnel)" },
  ]);
}
