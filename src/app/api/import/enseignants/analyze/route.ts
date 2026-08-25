import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { preparerPlan } from "@/lib/import-enseignants-server";
import { checkPermission } from "@/lib/rbac";

/**
 * POST /api/import/enseignants/analyze
 *
 * Première étape de l'import : lire le fichier et dire ce qui se passerait,
 * **sans rien écrire**. L'utilisateur voit combien d'enseignants seraient créés
 * ou ignorés, et pourquoi, avant de confirmer.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }
    const denied = checkPermission(session.user.role, "parametres:write");
    if (denied) return denied;

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "Aucun fichier fourni" }, { status: 400 });

    const { plan } = await preparerPlan(
      {
        id: session.user.id,
        tenantId: session.user.tenantId,
        role: session.user.role,
        siteId: session.user.siteId ?? null,
        siteIds: session.user.siteIds ?? [],
        tenantHasSites: session.user.tenantHasSites,
      },
      await file.arrayBuffer(),
    );

    if (plan.lignes.length === 0) {
      return NextResponse.json(
        { error: "Aucune ligne exploitable. Vérifiez les en-têtes : nom, email et site sont requis." },
        { status: 400 },
      );
    }

    return NextResponse.json(plan);
  } catch (error) {
    console.error("[API/import/enseignants/analyze]", error);
    const message = error instanceof Error ? error.message : "Erreur lors de l'analyse";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
