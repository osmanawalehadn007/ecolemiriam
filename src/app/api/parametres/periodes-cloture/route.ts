import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/rbac";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { checkPermission } from "@/lib/rbac";

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const denied = checkPermission(session.user.role, "parametres:write");
  if (denied) return denied;

  // Ouvrir/clôturer une période de notes pilote le calendrier de saisie : c'est
  // un acte de direction (`notes:manage`), pas un acte d'enseignant.
  const denied = checkPermission(session.user.role, "notes:manage");
  if (denied) return denied;

  const body = await req.json();
  const { periodeId, statut, dateLimiteSaisie } = body;

  if (!periodeId || !statut) {
    return NextResponse.json({ error: "periodeId et statut requis" }, { status: 400 });
  }

  if (statut !== "OUVERTE" && statut !== "CLOTUREE") {
    return NextResponse.json({ error: "statut invalide" }, { status: 400 });
  }

  const data: {
    statut: "OUVERTE" | "CLOTUREE";
    cloturedAt: Date | null;
    dateLimiteSaisie?: Date;
  } = { statut, cloturedAt: statut === "CLOTUREE" ? new Date() : null };
  const data: Prisma.PeriodeUpdateInput = { statut };
  data.cloturedAt = statut === "CLOTUREE" ? new Date() : null;
  if (dateLimiteSaisie) {
    data.dateLimiteSaisie = new Date(dateLimiteSaisie);
  }

  const periode = await prisma.periode.update({
    where: { id: periodeId },
    data,
  });

  return NextResponse.json(periode);
}
