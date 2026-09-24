import { NextResponse } from "next/server";
import { generatePersonnelTemplate } from "@/lib/import-templates";

/**
 * GET /api/import/personnel/template
 *
 * Télécharge un modèle Excel vierge avec les en-têtes corrects
 * pour l'import du personnel (staff non-enseignant).
 */
export async function GET() {
  const buffer = await generatePersonnelTemplate();
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="modele-import-personnel.xlsx"',
    },
  });
}
