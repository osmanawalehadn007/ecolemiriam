import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authorize } from "@/lib/rbac";
import { siteFilterForModel } from "@/lib/site-scope";

// POST /api/fournitures/[id]/valider
// Le secrétariat valide une liste soumise
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await authorize({ permission: "fournitures:validate" });
  if (!gate.ok) return gate.response;
  const { tenantId, userId } = gate;
  const { id } = await params;

  const siteFilter = siteFilterForModel("fournitureListe", gate.session.user);

  const liste = await prisma.fournitureListe.findFirst({
    where: { id, tenantId, ...siteFilter },
    select: { id: true, statut: true },
  });

  if (!liste) {
    return NextResponse.json({ error: "Liste introuvable" }, { status: 404 });
  }

  if (liste.statut !== "SOUMISE") {
    return NextResponse.json(
      { error: "Seules les listes soumises peuvent être validées." },
      { status: 400 }
    );
  }

  const updated = await prisma.fournitureListe.update({
    where: { id },
    data: {
      statut: "VALIDEE",
      valideeParId: userId,
      valideeAt: new Date(),
    },
  });

  return NextResponse.json(updated);
}
