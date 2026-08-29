import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { z } from "zod";
import { checkPermission } from "@/lib/rbac";
import { siteFilterForModel, mergeFilters } from "@/lib/site-scope";
import { anneeFilterForModel } from "@/lib/annee-scope";
import { getAnneeCouranteLibelle } from "@/lib/annee-scolaire";
import type { Role } from "@prisma/client";

// ------------------------------------------------------------
// GET /api/devoirs
// Liste des devoirs (filtrée par site, tenant, classe, statut, échéance)
// ------------------------------------------------------------
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }
    const denied = checkPermission(session.user.role as Role, "cahier-texte:read");
    if (denied) return denied;

    const { searchParams } = new URL(req.url);
    const classeId = searchParams.get("classeId");
    const seanceId = searchParams.get("seanceId");
    const statut = searchParams.get("statut");
    const from = searchParams.get("from");
    const to = searchParams.get("to");

    const siteFilter = siteFilterForModel("devoir", session.user);

    const devoirs = await prisma.devoir.findMany({
      where: mergeFilters(
        {
          tenantId: session.user.tenantId,
          ...(classeId ? { classeId } : {}),
          ...(seanceId ? { seanceId } : {}),
          ...(statut ? { statut: statut as never } : {}),
          ...(from || to
            ? {
                dateRemise: {
                  ...(from ? { gte: new Date(from) } : {}),
                  ...(to ? { lte: new Date(to) } : {}),
                },
              }
            : {}),
        },
        siteFilter,
        anneeFilterForModel(
          "devoir",
          await getAnneeCouranteLibelle(session.user.tenantId),
        ),
      ),
      include: {
        seance: {
          select: {
            id: true,
            date: true,
            contenu: true,
            classe: { select: { nom: true } },
            matiere: { select: { nom: true } },
          },
        },
        classe: { select: { nom: true, niveau: true } },
        matiere: { select: { nom: true, code: true } },
        evaluation: { select: { id: true, titre: true } },
        donnePar: { select: { name: true } },
      },
      orderBy: { dateRemise: "asc" },
    });

    return NextResponse.json(devoirs);
  } catch (error) {
    console.error("[API/devoirs] GET", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

// ------------------------------------------------------------
// POST /api/devoirs
// Créer un devoir lié à une séance
// ------------------------------------------------------------
const CreateDevoirSchema = z.object({
  seanceId: z.string().min(1),
  description: z.string().min(1),
  type: z.enum(["EXERCICE", "LECTURE", "RECHERCHE", "REVISION", "PROJET", "DISSERTATION", "AUTRE"]).default("EXERCICE"),
  dateRemise: z.string().transform((str) => new Date(str)),
  fichiers: z.array(z.object({
    nom: z.string(),
    type: z.string(),
    taille: z.number(),
    dataUrl: z.string(),
  })).optional().default([]),
});

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }
    const denied = checkPermission(session.user.role as Role, "cahier-texte:write");
    if (denied) return denied;

    const body = await req.json();
    const parsed = CreateDevoirSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Données invalides", details: parsed.error }, { status: 400 });
    }

    const data = parsed.data;

    // Récupérer la séance pour hériter classeId, matiereId, siteId
    // eslint-disable-next-line ecolemiriam/require-site-filter, ecolemiriam/require-annee-filter -- lookup par id : la séance porte son année via sa classe
    const seance = await prisma.cahierTexte.findFirst({
      where: { id: data.seanceId, tenantId: session.user.tenantId },
      select: { classeId: true, matiereId: true, siteId: true },
    });
    if (!seance) {
      return NextResponse.json({ error: "Séance introuvable" }, { status: 404 });
    }

    const devoir = await prisma.devoir.create({
      data: {
        tenantId: session.user.tenantId,
        siteId: seance.siteId,
        seanceId: data.seanceId,
        classeId: seance.classeId,
        matiereId: seance.matiereId,
        description: data.description,
        type: data.type,
        dateRemise: data.dateRemise,
        fichiers: data.fichiers.length > 0 ? data.fichiers : undefined,
        donneParId: session.user.id,
      },
      include: {
        classe: { select: { nom: true, niveau: true } },
        matiere: { select: { nom: true, code: true } },
      },
    });

    return NextResponse.json(devoir, { status: 201 });
  } catch (error) {
    console.error("[API/devoirs] POST", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
