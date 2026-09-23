import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { checkPermission } from "@/lib/rbac";
import { siteFilterForRelation, mergeFilters } from "@/lib/site-filter";
import { teacherEleveRelationFilter } from "@/lib/teacher-classes";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }
    const denied = checkPermission(session.user.role, "bulletins:write");
    if (denied) return denied;

    const { id } = await params;
    const body = await req.json();
    const { appreciation, decision, moyenneGenerale, rang } = body;

    const siteFilter = siteFilterForRelation(session.user, "eleve");

    // `id` vient de l'URL : le filtre de site borne le SITE, le périmètre
    // enseignant borne les CLASSES. Sans lui, un enseignant modifiait
    // l'appréciation, la décision ou le rang du bulletin d'une autre classe.
    const existing = await prisma.bulletin.findFirst({
      where: mergeFilters(
        { id, tenantId: session.user.tenantId },
        siteFilter,
        await teacherEleveRelationFilter(session.user, "eleve")
      ),
    });
    if (!existing) return NextResponse.json({ error: "Bulletin introuvable" }, { status: 404 });

    const updated = await prisma.bulletin.update({
      where: { id },
      data: {
        appreciation: appreciation !== undefined ? appreciation : undefined,
        decision: decision !== undefined ? decision : undefined,
        moyenneGenerale: moyenneGenerale !== undefined ? moyenneGenerale : undefined,
        rang: rang !== undefined ? rang : undefined,
      },
    });

    return NextResponse.json({ success: true, bulletin: updated });
  } catch (error) {
    console.error("[API/bulletins/[id]] PUT Error", error);
    return NextResponse.json({ error: "Erreur lors de la mise à jour" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }
    const denied = checkPermission(session.user.role, "bulletins:delete");
    if (denied) return denied;

    const { id } = await params;

    const siteFilter2 = siteFilterForRelation(session.user, "eleve");

    // Même garde qu'en PUT : la suppression d'un bulletin n'est ouverte que
    // dans le périmètre de l'enseignant (404 par identifiant d'URL).
    const existing = await prisma.bulletin.findFirst({
      where: mergeFilters(
        { id, tenantId: session.user.tenantId },
        siteFilter2,
        await teacherEleveRelationFilter(session.user, "eleve")
      ),
    });
    if (!existing) return NextResponse.json({ error: "Bulletin introuvable" }, { status: 404 });

    await prisma.bulletin.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[API/bulletins/[id]] DELETE Error", error);
    return NextResponse.json({ error: "Erreur lors de la suppression" }, { status: 500 });
  }
}
