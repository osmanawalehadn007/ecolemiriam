import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { z } from "zod";
import { checkPermission } from "@/lib/rbac";
import { siteFilterForModel } from "@/lib/site-scope";

// ------------------------------------------------------------
// GET /api/cahier-de-texte/[id]/commentaires
// Liste des commentaires d'une entrée du cahier de texte
// ------------------------------------------------------------
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }
    const denied = checkPermission(session.user.role, "cahier-texte:read");
    if (denied) return denied;

    const { id } = await params;
    const siteFilter = siteFilterForModel("cahierTexte", session.user);

    // Vérifier que l'entrée existe et appartient au tenant
    const entry = await prisma.cahierTexte.findFirst({
      where: { id, tenantId: session.user.tenantId, ...siteFilter },
    });
    if (!entry) {
      return NextResponse.json({ error: "Entrée introuvable" }, { status: 404 });
    }

    const commentaires = await prisma.cahierTexteCommentaire.findMany({
      where: { cahierTexteId: id, tenantId: session.user.tenantId },
      include: {
        auteur: { select: { name: true, role: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json(commentaires);
  } catch (error) {
    console.error("[API/cahier-de-texte/[id]/commentaires] GET", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

// ------------------------------------------------------------
// POST /api/cahier-de-texte/[id]/commentaires
// Ajouter un commentaire (COUNSELOR, PRINCIPAL, TENANT_ADMIN, etc.)
// Permission requise : cahier-texte:read (lecture suffit pour commenter)
// ------------------------------------------------------------
const CommentSchema = z.object({
  contenu: z.string().min(1).max(2000),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }
    // Permission read suffit pour commenter (le conseiller a read mais pas write)
    const denied = checkPermission(session.user.role, "cahier-texte:read");
    if (denied) return denied;

    const { id } = await params;
    const siteFilter = siteFilterForModel("cahierTexte", session.user);

    const entry = await prisma.cahierTexte.findFirst({
      where: { id, tenantId: session.user.tenantId, ...siteFilter },
    });
    if (!entry) {
      return NextResponse.json({ error: "Entrée introuvable" }, { status: 404 });
    }

    const body = await req.json();
    const parsed = CommentSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Données invalides", details: parsed.error },
        { status: 400 }
      );
    }

    const commentaire = await prisma.cahierTexteCommentaire.create({
      data: {
        tenantId: session.user.tenantId,
        cahierTexteId: id,
        auteurId: session.user.id,
        contenu: parsed.data.contenu,
      },
      include: {
        auteur: { select: { name: true, role: true } },
      },
    });

    return NextResponse.json(commentaire, { status: 201 });
  } catch (error) {
    console.error("[API/cahier-de-texte/[id]/commentaires] POST", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

// ------------------------------------------------------------
// DELETE /api/cahier-de-texte/[id]/commentaires?commentaireId=xxx
// Supprimer un commentaire (par son auteur ou un admin)
// ------------------------------------------------------------
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }
    const denied = checkPermission(session.user.role, "cahier-texte:read");
    if (denied) return denied;

    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const commentaireId = searchParams.get("commentaireId");

    if (!commentaireId) {
      return NextResponse.json({ error: "commentaireId requis" }, { status: 400 });
    }

    const commentaire = await prisma.cahierTexteCommentaire.findFirst({
      where: { id: commentaireId, tenantId: session.user.tenantId, cahierTexteId: id },
    });

    if (!commentaire) {
      return NextResponse.json({ error: "Commentaire introuvable" }, { status: 404 });
    }

    // Seul l'auteur ou un admin/tenant_admin peut supprimer
    const canDelete =
      commentaire.auteurId === session.user.id ||
      ["SUPER_ADMIN", "TENANT_ADMIN"].includes(session.user.role);

    if (!canDelete) {
      return NextResponse.json({ error: "Non autorisé à supprimer ce commentaire" }, { status: 403 });
    }

    await prisma.cahierTexteCommentaire.delete({ where: { id: commentaireId } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[API/cahier-de-texte/[id]/commentaires] DELETE", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
