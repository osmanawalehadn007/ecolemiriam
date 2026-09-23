import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getBulletinAnnuelData } from "@/lib/pdf/bulletin-generator";
import { checkPermission } from "@/lib/rbac";
import { isEleveInTeacherScope } from "@/lib/teacher-classes";

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }
    const denied = checkPermission(session.user.role, "bulletins:read");
    if (denied) return denied;

    const { searchParams } = new URL(req.url);
    const eleveId = searchParams.get("eleveId");
    const anneeId = searchParams.get("anneeId");

    if (!eleveId || !anneeId) {
      return NextResponse.json({ error: "Paramètres manquants" }, { status: 400 });
    }

    // Garde serveur : `eleveId` vient de l'URL — le bilan annuel n'est
    // prévisualisable que pour un élève de ses classes.
    if (!(await isEleveInTeacherScope(session.user, eleveId))) {
      return NextResponse.json(
        { error: "Cet élève ne fait pas partie de votre périmètre" },
        { status: 403 }
      );
    }

    const data = await getBulletinAnnuelData(eleveId, anneeId, session.user.tenantId);

    if (!data) {
      return NextResponse.json({ error: "Données introuvables" }, { status: 404 });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("[API/bulletins/annuel-preview]", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
