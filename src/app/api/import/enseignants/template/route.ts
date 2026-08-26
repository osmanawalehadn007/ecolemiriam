import { NextResponse } from "next/server";
import { generateEnseignantTemplate } from "@/lib/import-templates";

/**
 * GET /api/import/enseignants/template
 *
 * Télécharge un modèle Excel vierge avec les en-têtes corrects
 * pour l'import d'enseignants.
 */
export async function GET() {
  const buffer = await generateEnseignantTemplate();
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="modele-import-enseignants.xlsx"',
    },
  });
}
