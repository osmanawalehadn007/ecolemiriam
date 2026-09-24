import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/rbac";
import prisma from "@/lib/prisma";
import { siteFilterForModel } from "@/lib/site-scope";
import { checkPermission } from "@/lib/rbac";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const denied = checkPermission(session.user.role, "eleves:write");
  if (denied) return denied;

  // Créer une dispense déclasse l'élève pour une matière : action administrative.
  const denied = checkPermission(session.user.role, "eleves:write");
  if (denied) return denied;

  const body = await req.json();
  const { eleveId, matiereId, motif } = body;

  if (!eleveId || !matiereId) {
    return NextResponse.json({ error: "eleveId et matiereId requis" }, { status: 400 });
  }


  const siteFilter = siteFilterForModel("eleve", session.user);
  const eleve = await prisma.eleve.findFirst({
    where: { id: eleveId, tenantId: session.user.tenantId, ...siteFilter },
  });
  if (!eleve) {
    return NextResponse.json({ error: "Élève introuvable" }, { status: 404 });
  }

  const matiere = await prisma.matiere.findFirst({
    where: { id: matiereId, tenantId: session.user.tenantId, ...siteFilterForModel("matiere", session.user) },
    select: { id: true, nom: true, code: true },
  });
  if (!matiere) {
    return NextResponse.json({ error: "Matière introuvable" }, { status: 404 });
  }

  const dispense = await prisma.dispenseMatiere.create({
    data: {
      tenantId: session.user.tenantId,
      eleveId,
      matiereId,
      motif: motif || null,
    },
  });

  return NextResponse.json({
    id: dispense.id,
    matiereId: matiere.id,
    matiereNom: matiere.nom,
    motif: dispense.motif,
  });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const denied = checkPermission(session.user.role, "eleves:write");
  if (denied) return denied;

  const denied = checkPermission(session.user.role, "eleves:write");
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id requis" }, { status: 400 });
  }

  // La dispense n'a pas de `siteId` propre : son périmètre est celui de son
  // élève. On vérifie donc l'appartenance (tenant + site) AVANT de supprimer,
  // comme au POST — l'ancienne version supprimait par `id` nu.
  const dispenseFilter = siteFilterForModel("dispenseMatiere", session.user);
  const existing = await prisma.dispenseMatiere.findFirst({
    where: { id, tenantId: session.user.tenantId, ...dispenseFilter },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Dispense introuvable" }, { status: 404 });
  }

  await prisma.dispenseMatiere.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
