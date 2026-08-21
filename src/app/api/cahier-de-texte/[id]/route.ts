import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { z } from "zod";
import { checkPermission } from "@/lib/rbac";
import { siteFilterForModel } from "@/lib/site-scope";

// ------------------------------------------------------------
// GET /api/cahier-de-texte/[id]
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

    const entry = await prisma.cahierTexte.findFirst({
      where: { id, tenantId: session.user.tenantId, ...siteFilter },
      include: {
        classe: { select: { nom: true, niveau: true } },
        matiere: { select: { nom: true, code: true } },
        enseignant: { select: { id: true, specialite: true, user: { select: { name: true } } } },
        saisiePar: { select: { name: true } },
        commentaires: {
          include: { auteur: { select: { name: true, role: true } } },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!entry) {
      return NextResponse.json({ error: "Entrée introuvable" }, { status: 404 });
    }

    return NextResponse.json(entry);
  } catch (error) {
    console.error("[API/cahier-de-texte/[id]] GET", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

// ------------------------------------------------------------
// PATCH /api/cahier-de-texte/[id]
// ------------------------------------------------------------
const UpdateSchema = z.object({
  contenu: z.string().min(1).optional(),
  devoirs: z.string().nullable().optional(),
  prochainCours: z.string().nullable().optional(),
  commentaire: z.string().nullable().optional(),
  heureDebut: z.string().nullable().optional(),
  heureFin: z.string().nullable().optional(),
  date: z.string().transform((str) => new Date(str)).optional(),
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
    const denied = checkPermission(session.user.role, "cahier-texte:write");
    if (denied) return denied;

    const { id } = await params;
    const siteFilter = siteFilterForModel("cahierTexte", session.user);

    const existing = await prisma.cahierTexte.findFirst({
      where: { id, tenantId: session.user.tenantId, ...siteFilter },
    });
    if (!existing) {
      return NextResponse.json({ error: "Entrée introuvable" }, { status: 404 });
    }

    const body = await req.json();
    const parsed = UpdateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Données invalides", details: parsed.error },
        { status: 400 }
      );
    }

    const data = parsed.data;
    const entry = await prisma.cahierTexte.update({
      where: { id },
      data: {
        ...(data.contenu !== undefined ? { contenu: data.contenu } : {}),
        ...(data.devoirs !== undefined ? { devoirs: data.devoirs } : {}),
        ...(data.prochainCours !== undefined ? { prochainCours: data.prochainCours } : {}),
        ...(data.commentaire !== undefined ? { commentaire: data.commentaire } : {}),
        ...(data.heureDebut !== undefined ? { heureDebut: data.heureDebut } : {}),
        ...(data.heureFin !== undefined ? { heureFin: data.heureFin } : {}),
        ...(data.date !== undefined ? { date: data.date } : {}),
        ...(data.fichiers !== undefined
          ? { fichiers: data.fichiers === null ? undefined : data.fichiers }
          : {}),
      },
      include: {
        classe: { select: { nom: true, niveau: true } },
        matiere: { select: { nom: true, code: true } },
      },
    });

    return NextResponse.json(entry);
  } catch (error) {
    console.error("[API/cahier-de-texte/[id]] PATCH", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

// ------------------------------------------------------------
// DELETE /api/cahier-de-texte/[id]
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
    const denied = checkPermission(session.user.role, "cahier-texte:delete");
    if (denied) return denied;

    const { id } = await params;
    const siteFilter = siteFilterForModel("cahierTexte", session.user);

    const existing = await prisma.cahierTexte.findFirst({
      where: { id, tenantId: session.user.tenantId, ...siteFilter },
    });
    if (!existing) {
      return NextResponse.json({ error: "Entrée introuvable" }, { status: 404 });
    }

    await prisma.cahierTexte.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[API/cahier-de-texte/[id]] DELETE", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
