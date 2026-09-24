import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/rbac";
import prisma from "@/lib/prisma";
import { siteFilterForModel } from "@/lib/site-scope";
import { anneeFilterForModel } from "@/lib/annee-scope";
import { getAnneeCouranteLibelle } from "@/lib/annee-scolaire";
import { mergeFilters } from "@/lib/site-scope";
import { checkPermission } from "@/lib/rbac";
import { revalidateTag, revalidatePath } from "next/cache";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const denied = checkPermission(session.user.role, "eleves:write");
  if (denied) return denied;

  // Déplacement d'élèves en masse : action administrative.
  const denied = checkPermission(session.user.role, "eleves:write");
  if (denied) return denied;

  const body = await req.json();
  const { eleveIds, nouvelleClasseId } = body as {
    eleveIds: string[];
    nouvelleClasseId: string;
  };

  if (!eleveIds?.length || !nouvelleClasseId) {
    return NextResponse.json({ error: "eleveIds et nouvelleClasseId requis" }, { status: 400 });
  }


  const classeFilter = siteFilterForModel("classe", session.user);
  const eleveFilter = siteFilterForModel("eleve", session.user);
  // La classe de destination doit appartenir à l'année en cours : c'est
  // exactement le défaut qui avait rattaché des élèves 2026-2027 à une
  // « 6ème1 » de 2025-2026.
  const targetClasse = await prisma.classe.findFirst({
    where: mergeFilters(
      { id: nouvelleClasseId, tenantId: session.user.tenantId },
      classeFilter,
      anneeFilterForModel(
        "classe",
        await getAnneeCouranteLibelle(session.user.tenantId),
      ),
    ),
  });

  if (!targetClasse) {
    return NextResponse.json(
      { error: "Classe destination introuvable pour l'année en cours" },
      { status: 404 }
    );
  }

  const result = await prisma.eleve.updateMany({
    where: {
      id: { in: eleveIds },
      tenantId: session.user.tenantId,
      ...eleveFilter,
    },
    data: { classeId: nouvelleClasseId },
  });

  revalidateTag("eleves-stats", "max");
  // Les effectifs par classe affichés dans Paramètres → Pédagogie.
  revalidatePath("/parametres");
  revalidatePath("/eleves");
  revalidateTag("dashboard-data", "max");
  revalidateTag("classes-list", "max");
  revalidateTag("eleves-stats");
  revalidateTag("dashboard-data");
  revalidateTag("classes-list");

  return NextResponse.json({ count: result.count });
}
