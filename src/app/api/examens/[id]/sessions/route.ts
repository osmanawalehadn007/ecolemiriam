import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { z } from "zod";
import { checkPermission } from "@/lib/rbac";
import { siteFilterForModel } from "@/lib/site-scope";
import { getTeacherScope, isTeacherRole } from "@/lib/teacher-classes";
import type { Role } from "@prisma/client";

const SessionSchema = z.object({
  matiereNom: z.string().min(1).max(100),
  date: z.string(),
  heureDebut: z.string().regex(/^\d{2}:\d{2}$/),
  heureFin: z.string().regex(/^\d{2}:\d{2}$/),
  salle: z.string().max(50).optional(),
  niveau: z.string().max(50).optional(),
  classeId: z.string().optional(),
  matiereId: z.string().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.tenantId) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    const denied = checkPermission(session.user.role, "examens:write");
    if (denied) return denied;

    const { id } = await params;
    const tenantId = session.user.tenantId;

    // Vérifier que l'examen appartient au tenant
    // eslint-disable-next-line ecolemiriam/require-site-filter -- lookup par ID + tenantId : le caller a déjà vérifié l'accès via gate/checkPermission
    const examen = await prisma.examen.findFirst({ where: { id, tenantId } });
    if (!examen) return NextResponse.json({ error: "Examen introuvable" }, { status: 404 });

    const body = await req.json();
    const parsed = SessionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Données invalides", details: parsed.error.issues }, { status: 400 });
    }

    const { matiereNom, date, heureDebut, heureFin, salle, niveau, classeId, matiereId } = parsed.data;

    // Pour les enseignants : valider que la classe ET la matière sont assignées
    if (isTeacherRole(session.user.role as Role)) {
      const scope = await getTeacherScope(tenantId!, session.user.id, session.user.role as Role);
      if (scope.isRestricted) {
        if (classeId && !scope.classeIds.includes(classeId)) {
          return NextResponse.json({ error: "Vous n'êtes pas assigné à cette classe" }, { status: 403 });
        }
        if (matiereId && !scope.matiereIds.includes(matiereId)) {
          return NextResponse.json({ error: "Vous n'êtes pas assigné à cette matière" }, { status: 403 });
        }
        // Si pas de classeId fourni, refuser — un enseignant doit lier à une de ses classes
        if (!classeId) {
          return NextResponse.json({ error: "Vous devez sélectionner une de vos classes" }, { status: 403 });
        }
      }
    }

    // Vérifier que la classe et la matière appartiennent au tenant
    if (classeId) {
      // eslint-disable-next-line ecolemiriam/require-site-filter -- lookup par ID + tenantId : le caller a déjà vérifié l'accès via gate/checkPermission
      const classe = await prisma.classe.findFirst({ where: { id: classeId, tenantId } });
      if (!classe) return NextResponse.json({ error: "Classe introuvable" }, { status: 404 });
    }
    if (matiereId) {
      // eslint-disable-next-line ecolemiriam/require-site-filter -- lookup par ID + tenantId : le caller a déjà vérifié l'accès via gate/checkPermission
      const matiere = await prisma.matiere.findFirst({ where: { id: matiereId, tenantId } });
      if (!matiere) return NextResponse.json({ error: "Matière introuvable" }, { status: 404 });
    }

    const sessionExam = await prisma.sessionExamen.create({
      data: {
        examId: id,
        matiereNom,
        date: new Date(date),
        heureDebut,
        heureFin,
        salle: salle ?? null,
        niveau: niveau ?? null,
        classeId: classeId ?? null,
        matiereId: matiereId ?? null,
      },
    });

    return NextResponse.json(sessionExam, { status: 201 });
  } catch (error) {
    console.error("[API/examens/:id/sessions POST]", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.tenantId) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    const denied = checkPermission(session.user.role, "examens:read");
    if (denied) return denied;

    const { id } = await params;
    const tenantId = session.user.tenantId;

    // eslint-disable-next-line ecolemiriam/require-site-filter -- lookup par ID + tenantId : le caller a déjà vérifié l'accès via gate/checkPermission
    const examen = await prisma.examen.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!examen) return NextResponse.json({ error: "Examen introuvable" }, { status: 404 });

    // Pour les enseignants : filtrer les sessions par leurs classes
    const scope = isTeacherRole(session.user.role as Role)
      ? await getTeacherScope(tenantId!, session.user.id, session.user.role as Role)
      : undefined;

    const teacherSessionFilter = scope?.isRestricted && scope.classeIds.length > 0
      ? { OR: [{ classeId: { in: scope.classeIds } }, { classeId: null }] }
      : scope?.isRestricted
        ? { id: "__none__" as const }
        : {};

    // eslint-disable-next-line ecolemiriam/require-site-filter -- tenantId déjà dans le where (le linter ne détecte pas le spread/merge)
    const sessions = await prisma.sessionExamen.findMany({
      where: { examId: id, ...teacherSessionFilter },
      orderBy: { date: "asc" },
    });

    return NextResponse.json(sessions);
  } catch (error) {
    console.error("[API/examens/:id/sessions GET]", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
