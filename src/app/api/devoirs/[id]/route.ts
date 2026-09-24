import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { z } from "zod";
import { checkPermission } from "@/lib/rbac";
import { siteFilterForModel } from "@/lib/site-scope";
import type { Role } from "@prisma/client";

// ------------------------------------------------------------
// PATCH /api/devoirs/[id]
// Mettre à jour un devoir (statut, description, date de remise)
// ------------------------------------------------------------
const UpdateDevoirSchema = z.object({
  description: z.string().min(1).optional(),
  type: z.enum(["EXERCICE", "LECTURE", "RECHERCHE", "REVISION", "PROJET", "DISSERTATION", "AUTRE"]).optional(),
  dateRemise: z.string().transform((str) => new Date(str)).optional(),
  statut: z.enum(["DONNE", "RENDU", "NON_RENDU", "CORRIGE"]).optional(),
  evaluationId: z.string().nullable().optional(),
  fichiers: z.array(z.object({
    nom: z.string(),
    type: z.string(),
    taille: z.number(),
    dataUrl: z.string(),
  })).nullable().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }
    const denied = checkPermission(session.user.role as Role, "cahier-texte:write");
    if (denied) return denied;

    const { id } = await params;
    const siteFilter = siteFilterForModel("devoir", session.user);

    // eslint-disable-next-line ecolemiriam/require-annee-filter -- lookup par id : le devoir porte son année via sa classe
    const existing = await prisma.devoir.findFirst({
      where: { id, tenantId: session.user.tenantId, ...siteFilter },
    });
    if (!existing) {
      return NextResponse.json({ error: "Devoir introuvable" }, { status: 404 });
    }

    const body = await req.json();
    const parsed = UpdateDevoirSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Données invalides", details: parsed.error }, { status: 400 });
    }

    const data = parsed.data;
    const devoir = await prisma.devoir.update({
      where: { id },
      data: {
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.type !== undefined ? { type: data.type } : {}),
        ...(data.dateRemise !== undefined ? { dateRemise: data.dateRemise } : {}),
        ...(data.statut !== undefined ? { statut: data.statut } : {}),
        ...(data.evaluationId !== undefined ? { evaluationId: data.evaluationId } : {}),
        ...(data.fichiers !== undefined
          ? { fichiers: data.fichiers === null ? undefined : data.fichiers }
          : {}),
      },
      include: {
        classe: { select: { nom: true, niveau: true } },
        matiere: { select: { nom: true, code: true } },
      },
    });

    return NextResponse.json(devoir);
  } catch (error) {
    console.error("[API/devoirs/[id]] PATCH", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

// ------------------------------------------------------------
// DELETE /api/devoirs/[id]
// ------------------------------------------------------------
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }
    const denied = checkPermission(session.user.role as Role, "cahier-texte:delete");
    if (denied) return denied;

    const { id } = await params;
    const siteFilter = siteFilterForModel("devoir", session.user);

    // eslint-disable-next-line ecolemiriam/require-annee-filter -- lookup par id : le devoir porte son année via sa classe
    const existing = await prisma.devoir.findFirst({
      where: { id, tenantId: session.user.tenantId, ...siteFilter },
    });
    if (!existing) {
      return NextResponse.json({ error: "Devoir introuvable" }, { status: 404 });
    }

    await prisma.devoir.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[API/devoirs/[id]] DELETE", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
