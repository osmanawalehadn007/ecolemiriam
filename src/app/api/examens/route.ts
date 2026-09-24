import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { z } from "zod";
import { checkPermission } from "@/lib/rbac";
import { siteFilterForModel, requireSiteIdForCreate } from "@/lib/site-scope";
import { getTeacherScope, isTeacherRole } from "@/lib/teacher-classes";
import type { Role } from "@prisma/client";
import { revalidateTag } from "next/cache";

const CreateSchema = z.object({
  intitule: z.string().min(2).max(200),
  description: z.string().max(500).optional(),
  dateDebut: z.string(),
  dateFin: z.string(),
});

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.tenantId) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    const denied = checkPermission(session.user.role, "examens:read");
    if (denied) return denied;
    const siteFilter = siteFilterForModel("examen", session.user);

    const { searchParams } = new URL(req.url);
    const statut = searchParams.get("statut");
    const tenantId = session.user.tenantId;

    // Filtrer par classes de l'enseignant si applicable
    const scope = isTeacherRole(session.user.role as Role)
      ? await getTeacherScope(tenantId!, session.user.id, session.user.role as Role)
      : undefined;

    const teacherFilter = scope?.isRestricted && scope.classeIds.length > 0
      ? { sessions: { some: { classeId: { in: scope.classeIds } } } }
      : scope?.isRestricted
        ? { id: "__none__" as const }
        : {};
    // Restriction enseignant : ses sessions ne concernent que les matières qu'il
    // dispense et les niveaux de SES classes. Les sessions sans niveau restent
    // visibles (niveau optionnel à la création).
    let teacherSessionFilter: Record<string, unknown> = {};
    if (isTeacherRole(session.user.role)) {
      const scope = await getTeacherScope(tenantId, session.user.id, session.user.role);
      if (scope.isRestricted) {
        const [matieresAutorisees, classesAutorisees] = await Promise.all([
          scope.matiereIds.length > 0
            ? prisma.matiere.findMany({
                where: {
                  tenantId,
                  ...siteFilterForModel("matiere", session.user),
                  id: { in: scope.matiereIds },
                },
                select: { nom: true },
              })
            : [],
          scope.classeIds.length > 0
            ? prisma.classe.findMany({
                where: {
                  tenantId,
                  ...siteFilterForModel("classe", session.user),
                  id: { in: scope.classeIds },
                },
                select: { niveau: true },
                distinct: ["niveau"],
              })
            : [],
        ]);
        const niveaux = classesAutorisees.map((c) => c.niveau).filter(Boolean);
        teacherSessionFilter = {
          matiereNom: { in: matieresAutorisees.map((m) => m.nom) },
          ...(niveaux.length > 0 ? { OR: [{ niveau: { in: niveaux } }, { niveau: null }] } : {}),
        };
      }
    }

    const examens = await prisma.examen.findMany({
      where: { tenantId, ...siteFilter, ...teacherFilter,
        ...(statut ? { statut: statut as never } : {}),
      },
      // eslint-disable-next-line ecolemiriam/require-site-filter -- include filtré par le where parent (tenantId sur la table racine)
      include: { sessions: { orderBy: { date: "asc" } } },
      include: {
        sessions: {
          where: { ...siteFilterForModel("sessionExamen", session.user), ...teacherSessionFilter },
          orderBy: { date: "asc" },
        },
      },
      orderBy: { dateDebut: "desc" },
    });

    return NextResponse.json(examens);
  } catch (error) {
    console.error("[API/examens GET]", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.tenantId) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    const denied = checkPermission(session.user.role, "examens:write");
    if (denied) return denied;

    // Pour les enseignants : vérifier qu'ils ont au moins une classe assignée
    if (isTeacherRole(session.user.role as Role)) {
      const scope = await getTeacherScope(session.user.tenantId!, session.user.id, session.user.role as Role);
      if (scope.isRestricted && scope.classeIds.length === 0) {
        return NextResponse.json({ error: "Vous n'avez aucune classe assignée" }, { status: 403 });
      }
    }

    const siteError = requireSiteIdForCreate(session.user);
    if (siteError) return NextResponse.json({ error: siteError }, { status: 400 });

    const body = await req.json();
    const parsed = CreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Données invalides", details: parsed.error.issues }, { status: 400 });
    }

    const { intitule, description, dateDebut, dateFin } = parsed.data;
    const tenantId = session.user.tenantId;

    const debut = new Date(dateDebut);
    const fin = new Date(dateFin);

    if (fin < debut) {
      return NextResponse.json({ error: "La date de fin doit être après la date de début" }, { status: 400 });
    }

    const examen = await prisma.examen.create({
      data: {
        tenantId,
        intitule,
        description: description ?? null,
        dateDebut: debut,
        dateFin: fin,
        statut: "PROGRAMME",
      },
      include: { sessions: true },
    });

    revalidateTag("dashboard-data", "max");

    return NextResponse.json(examen, { status: 201 });
  } catch (error) {
    console.error("[API/examens POST]", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
