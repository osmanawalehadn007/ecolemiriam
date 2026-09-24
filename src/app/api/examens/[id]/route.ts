import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { z } from "zod";
import { checkPermission } from "@/lib/rbac";
import { siteFilterForModel } from "@/lib/site-scope";
import { getTeacherScope, isTeacherRole } from "@/lib/teacher-classes";
import type { Role } from "@prisma/client";
import { revalidateTag } from "next/cache";

const PatchSchema = z.object({
  intitule: z.string().min(2).max(200).optional(),
  description: z.string().max(500).nullable().optional(),
  statut: z.enum(["PROGRAMME", "EN_COURS", "TERMINE", "ANNULE"]).optional(),
  dateDebut: z.string().optional(),
  dateFin: z.string().optional(),
});

// Vérifie qu'un enseignant a accès à au moins une session de l'examen
async function checkTeacherExamenAccess(
  examenId: string,
  tenantId: string,
  userId: string,
  role: Role
): Promise<boolean> {
  const scope = await getTeacherScope(tenantId, userId, role);
  if (!scope.isRestricted) return true;
  if (scope.classeIds.length === 0) return false;
  // L'enseignant a accès si au moins une session est liée à une de ses classes
  // eslint-disable-next-line ecolemiriam/require-site-filter -- tenantId déjà dans le where (le linter ne détecte pas le spread/merge)
  const session = await prisma.sessionExamen.findFirst({
    where: { examId: examenId, classeId: { in: scope.classeIds } },
    select: { id: true },
  });
  return !!session;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.tenantId) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    const denied = checkPermission(session.user.role, "examens:write");
    if (denied) return denied;

    const { id } = await params;
    const body = await req.json();
    const parsed = PatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Données invalides" }, { status: 400 });
    }

    const tenantId = session.user.tenantId;
    // `Examen` porte une colonne `siteId` : sans ce filtre, un examen d'un
    // autre site du même établissement restait modifiable par identifiant.
    const examenFilter = siteFilterForModel("examen", session.user);

    // eslint-disable-next-line ecolemiriam/require-site-filter -- lookup par ID + tenantId : le caller a déjà vérifié l'accès via gate/checkPermission
    const existing = await prisma.examen.findFirst({ where: { id, tenantId } });
    const existing = await prisma.examen.findFirst({ where: { id, tenantId, ...examenFilter } });
    if (!existing) return NextResponse.json({ error: "Examen introuvable" }, { status: 404 });

    // Pour les enseignants : vérifier l'accès à l'examen via ses classes
    if (isTeacherRole(session.user.role as Role)) {
      const hasAccess = await checkTeacherExamenAccess(id, tenantId!, session.user.id, session.user.role as Role);
      if (!hasAccess) {
        return NextResponse.json({ error: "Vous n'avez pas accès à cet examen" }, { status: 403 });
      }
    }

    const { intitule, description, statut, dateDebut, dateFin } = parsed.data;

    const updated = await prisma.examen.update({
      where: { id },
      data: {
        ...(intitule && { intitule }),
        ...(description !== undefined && { description }),
        ...(statut && { statut }),
        ...(dateDebut && { dateDebut: new Date(dateDebut) }),
        ...(dateFin && { dateFin: new Date(dateFin) }),
      },
      include: { sessions: true },
    });

    revalidateTag("dashboard-data", "max");

    return NextResponse.json(updated);
  } catch (error) {
    console.error("[API/examens/:id PATCH]", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.tenantId) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    const denied = checkPermission(session.user.role, "examens:delete");
    if (denied) return denied;

    const { id } = await params;
    const tenantId = session.user.tenantId;

    // eslint-disable-next-line ecolemiriam/require-site-filter -- lookup par ID + tenantId : le caller a déjà vérifié l'accès via gate/checkPermission
    const existing = await prisma.examen.findFirst({ where: { id, tenantId } });
    const existing = await prisma.examen.findFirst({
      where: { id, tenantId, ...siteFilterForModel("examen", session.user) },
    });
    if (!existing) return NextResponse.json({ error: "Examen introuvable" }, { status: 404 });

    // Pour les enseignants : vérifier l'accès à l'examen via ses classes
    if (isTeacherRole(session.user.role as Role)) {
      const hasAccess = await checkTeacherExamenAccess(id, tenantId!, session.user.id, session.user.role as Role);
      if (!hasAccess) {
        return NextResponse.json({ error: "Vous n'avez pas accès à cet examen" }, { status: 403 });
      }
    }

    await prisma.examen.delete({ where: { id } });

    revalidateTag("dashboard-data", "max");

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[API/examens/:id DELETE]", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
