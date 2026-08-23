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
  const { tenantId, role, userId } = gate;
  const { id } = await params;

  const siteFilter = siteFilterForModel("fournitureListe", gate.session.user);

  const liste = await prisma.fournitureListe.findFirst({
    where: { id, tenantId, ...siteFilter },
    select: { id: true, statut: true, enseignantId: true },
  });

  if (!liste) {
    return NextResponse.json({ error: "Liste introuvable" }, { status: 404 });
  }

  // Enseignant : ne peut soumettre que SES propres listes
  if (role === "TEACHER" || role === "CLASS_TEACHER") {
    const enseignantSiteFilter = siteFilterForModel("enseignant", gate.session.user);
    const enseignant = await prisma.enseignant.findFirst({
      where: { userId, tenantId, ...enseignantSiteFilter },
      select: { id: true },
    });
    if (!enseignant || liste.enseignantId !== enseignant.id) {
      return NextResponse.json(
        { error: "Vous ne pouvez soumettre que vos propres listes." },
        { status: 403 }
      );
    }
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
