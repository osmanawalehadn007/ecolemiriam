import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { z } from "zod";
import { checkPermission } from "@/lib/rbac";
import { siteFilterForModel } from "@/lib/site-scope";
import { areElevesInTeacherScope, isClasseInTeacherScope } from "@/lib/teacher-classes";

const Schema = z.object({
  classeId: z.string().min(1),
  periodeId: z.string().min(1),
  decisions: z.array(
    z.object({
      eleveId: z.string().min(1),
      decision: z.enum(["PASSAGE", "REDOUBLEMENT", "FELICITATIONS", "ENCOURAGEMENTS", "AVERTISSEMENT"]).nullable(),
      appreciation: z.string().max(500).optional(),
    })
  ),
});

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }
    const denied = checkPermission(session.user.role, "bulletins:write");
    if (denied) return denied;

    const body = await req.json();
    const parsed = Schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Données invalides", details: parsed.error.issues }, { status: 400 });
    }

    const { periodeId, decisions, classeId } = parsed.data;
    const tenantId = session.user.tenantId;

    // Garde serveur : le conseil de classe consigne des décisions (passage,
    // redoublement…) sur des élèves nommés. Un professeur principal ne peut
    // statuer que sur les élèves de ses classes — et sur la classe concernée.
    if (!(await isClasseInTeacherScope(session.user, classeId))) {
      return NextResponse.json(
        { error: "Cette classe ne fait pas partie de votre périmètre" },
        { status: 403 }
      );
    }
    if (!(await areElevesInTeacherScope(session.user, decisions.map((d) => d.eleveId)))) {
      return NextResponse.json(
        { error: "Un ou plusieurs élèves sont hors de votre périmètre" },
        { status: 403 }
      );
    }

    await Promise.all(
      decisions.map(({ eleveId, decision, appreciation }) =>
        prisma.bulletin.upsert({
          where: { eleveId_periodeId: { eleveId, periodeId } },
          update: {
            decision: decision ?? null,
            ...(appreciation !== undefined && { appreciation }),
          },
          create: {
            tenantId,
            eleveId,
            periodeId,
            decision: decision ?? null,
            appreciation: appreciation ?? null,
          },
        })
      )
    );

    return NextResponse.json({
      success: true,
      message: `${decisions.length} décisions enregistrées`,
    });
  } catch (error) {
    console.error("[API/bulletins/conseil]", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
