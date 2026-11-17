import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { z } from "zod";
import { checkPermission } from "@/lib/rbac";
import { siteFilterForRelation, requireSiteIdForCreate } from "@/lib/site-filter";
import { anneeFilterForModel } from "@/lib/annee-scope";
import { getAnneeCouranteLibelle } from "@/lib/annee-scolaire";
import { mergeFilters } from "@/lib/site-scope";

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }
    const denied = checkPermission(session.user.role, "evaluations:read");
    if (denied) return denied;

    const { searchParams } = new URL(req.url);
    const classeId = searchParams.get("classeId");

    const siteFilter = siteFilterForRelation(session.user, "classe");

    const evaluations = await prisma.evaluation.findMany({
      where: mergeFilters(
        {
          tenantId: session.user.tenantId,
          ...(classeId ? { classeId } : {}),
        },
        siteFilter,
        anneeFilterForModel(
          "evaluation",
          await getAnneeCouranteLibelle(session.user.tenantId),
        ),
      ),
      include: {
        classe: { select: { nom: true, niveau: true } },
        matiere: { select: { nom: true, code: true, coefficient: true } },
        periode: { select: { nom: true } },
        _count: { select: { notes: true } }, // Nombre de notes déjà saisies
      },
      orderBy: { date: "desc" },
    });

    return NextResponse.json(evaluations);
  } catch (error) {
    console.error("[API/evaluations] GET", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

const CreateSchema = z.object({
  titre: z.string().min(1),
  type: z.enum(["CONTROLE", "DEVOIR", "EXAMEN", "INTERROGATION", "PROJET", "ORAL", "TP"]),
  classeId: z.string().min(1),
  matiereId: z.string().min(1),
  periodeId: z.string().min(1),
  date: z.string().transform((str) => new Date(str)),
  duree: z.number().min(1),
  coefficient: z.number().min(0),
  description: z.string().optional(),
  // Carnet du primaire : module (1 à 4) et ligne de compétence visée (null = tout le domaine).
  moduleCarnet: z.number().int().min(1).max(4).nullable().optional(),
  ligneCarnet: z.number().int().min(0).max(11).nullable().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }
    const denied = checkPermission(session.user.role, "evaluations:write");
    if (denied) return denied;

    const siteError = requireSiteIdForCreate(session.user);
    if (siteError) return NextResponse.json({ error: siteError }, { status: 400 });

    const body = await req.json();
    const parsed = CreateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: "Données invalides", details: parsed.error }, { status: 400 });
    }

    const data = parsed.data;
    if (data.ligneCarnet != null && data.moduleCarnet == null) {
      return NextResponse.json({ error: "Une compétence visée suppose un module du carnet" }, { status: 400 });
    }

    const evaluation = await prisma.evaluation.create({
      data: {
        tenantId: session.user.tenantId,
        titre: data.titre,
        type: data.type,
        classeId: data.classeId,
        matiereId: data.matiereId,
        periodeId: data.periodeId,
        date: data.date,
        duree: data.duree,
        coefficient: data.coefficient,
        description: data.description,
        moduleCarnet: data.moduleCarnet ?? null,
        ligneCarnet: data.moduleCarnet == null ? null : (data.ligneCarnet ?? null),
        statut: "PLANIFIE",
      },
      include: {
        classe: true,
        matiere: true,
      }
    });

    return NextResponse.json(evaluation);
  } catch (error) {
    console.error("[API/evaluations] POST", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
