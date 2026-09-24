import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/rbac";
import { preparerPlanIndispo } from "@/lib/import-indisponibilites-server";

/**
 * POST /api/import/indisponibilites/analyze
 *
 * Première étape : lire le fichier CSV/Excel et produire un plan de
 * prévisualisation sans rien écrire. L'utilisateur voit combien
 * d'indisponibilités seraient importées, lesquelles sont en erreur
 * (enseignant introuvable, horaires invalides) avant de confirmer.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }
    const denied = checkPermission(session.user.role, "emploi-du-temps:write");
    if (denied) return denied;

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "Aucun fichier fourni" }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();
    const plan = await preparerPlanIndispo(session.user.tenantId, buffer);

    if (plan.lignes.length === 0) {
      return NextResponse.json(
        { error: "Aucune ligne exploitable. Vérifiez les en-têtes : Enseignant, Jour, Heure début, Heure fin sont requis." },
        { status: 400 }
      );
    }

    return NextResponse.json(plan);
  } catch (error) {
    console.error("[API/import/indisponibilites/analyze]", error);
    const message = error instanceof Error ? error.message : "Erreur lors de l'analyse";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
