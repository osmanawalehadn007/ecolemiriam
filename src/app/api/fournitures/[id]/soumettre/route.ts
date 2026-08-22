import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authorize } from "@/lib/rbac";
import { siteFilterForModel } from "@/lib/site-scope";

// POST /api/fournitures/[id]/soumettre
// L'enseignant soumet sa liste au secrétariat pour validation
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await authorize({ permission: "fournitures:write" });
  if (!gate.ok) return gate.response;
  const { tenantId } = gate;
  const { id } = await params;

  const siteFilter = siteFilterForModel("fournitureListe", gate.session.user);

  const liste = await prisma.fournitureListe.findFirst({
    where: { id, tenantId, ...siteFilter },
    select: { id: true, statut: true },
  });

  if (!liste) {
    return NextResponse.json({ error: "Liste introuvable" }, { status: 404 });
  }

  if (liste.statut !== "BROUILLON" && liste.statut !== "REJETEE") {
    return NextResponse.json(
      { error: "Seules les listes en brouillon ou rejetées peuvent être soumises." },
      { status: 400 }
    );
  }

  const updated = await prisma.fournitureListe.update({
    where: { id },
    data: { statut: "SOUMISE" },
  });

  return NextResponse.json(updated);
}
