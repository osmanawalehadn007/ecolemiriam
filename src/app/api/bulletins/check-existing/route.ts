import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/rbac";
import prisma from "@/lib/prisma";
import { siteFilterForModel } from "@/lib/site-scope";
import { eleveScopeFilter, isRelationScopedRole } from "@/lib/site-scope";
import { isClasseInTeacherScope } from "@/lib/teacher-classes";
import { checkPermission } from "@/lib/rbac";

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }
    const denied = checkPermission(session.user.role, "bulletins:read");
    if (denied) return denied;
    // Route agrégée par classe — refuser l'accès aux PARENT/STUDENT
    if (session.user.role === "PARENT" || session.user.role === "STUDENT") {

    // Outil de personnel (état de publication d'une classe) : pas d'usage
    // borné à un élève.
    if (isRelationScopedRole(session.user.role)) {
      return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const classeId = searchParams.get("classeId");
    const periodeId = searchParams.get("periodeId");

    if (!classeId || !periodeId) {
      return NextResponse.json({ error: "Paramètres manquants" }, { status: 400 });
    }

    const siteFilter = siteFilterForModel("bulletin", session.user);
    // Garde serveur : on n'indique l'existence de bulletins que pour ses classes.
    if (!(await isClasseInTeacherScope(session.user, classeId))) {
      return NextResponse.json(
        { error: "Cette classe ne fait pas partie de votre périmètre" },
        { status: 403 }
      );
    }

    // Site **et** périmètre personnel : PARENT / STUDENT portent
    // `bulletins:read` et obtenaient, sans ce filtre, l'état de publication de
    // n'importe quelle classe.
    const eleveScope = eleveScopeFilter(session.user, "eleve");

    const count = await prisma.bulletin.count({
      where: {
        eleve: { classeId },
        periodeId,
        tenantId: session.user.tenantId,
        ...siteFilter,
        ...eleveScope,
      },
    });

    if (count === 0) {
      return NextResponse.json({ exists: false, published: false });
    }

    const publishedCount = await prisma.bulletin.count({
      where: {
        eleve: { classeId },
        periodeId,
        tenantId: session.user.tenantId,
        isPublie: true,
        ...siteFilter,
        ...eleveScope,
      },
    });

    return NextResponse.json({
      exists: true,
      published: publishedCount > 0,
      count,
    });
  } catch (error) {
    console.error("[API/bulletins/check-existing]", error);
    return NextResponse.json({ exists: false, published: false });
  }
}
