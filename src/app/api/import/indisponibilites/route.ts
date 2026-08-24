import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/rbac";
import { preparerPlanIndispo, appliquerPlanIndispo } from "@/lib/import-indisponibilites-server";

/**
 * POST /api/import/indisponibilites — seconde étape : appliquer le plan.
 *
 * Le client renvoie le fichier et le hash de l'analyse. Le serveur rejoue
 * l'analyse (pour valider le hash) puis écrit les indisponibilités.
 * Les saisies manuelles (source = "MANUEL") sont préservées ; seules les
 * indisponibilités d'import précédentes (source = "IMPORT") des enseignants
 * concernés sont remplacées.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }
    const denied = checkPermission(session.user.role, "emploi-du-temps:write");
    if (denied) return denied;

    const tenantId = session.user.tenantId;
    const siteId = (session.user as { siteId?: string | null }).siteId ?? null;

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "Aucun fichier fourni" }, { status: 400 });
    }

    const hashAttendu = formData.get("hash") as string | null;
    if (!hashAttendu) {
      return NextResponse.json(
        { error: "Import non prévisualisé. Analysez le fichier avant de confirmer." },
        { status: 400 }
      );
    }

    const buffer = await file.arrayBuffer();
    const plan = await preparerPlanIndispo(tenantId, buffer);

    if (plan.hash !== hashAttendu) {
      return NextResponse.json(
        { error: "Le fichier a changé depuis l'analyse. Relancez la prévisualisation." },
        { status: 409 }
      );
    }

    const result = await appliquerPlanIndispo(tenantId, siteId, plan);

    return NextResponse.json({
      success: true,
      created: result.created,
      enseignantsConcernes: result.enseignantsConcernes.length,
      message: `${result.created} indisponibilité(s) importée(s) pour ${result.enseignantsConcernes.length} enseignant(s)`,
    });
  } catch (error) {
    console.error("[API/import/indisponibilites]", error);
    const message = error instanceof Error ? error.message : "Erreur serveur";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
