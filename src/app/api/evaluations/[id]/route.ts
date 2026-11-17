import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { checkPermission } from "@/lib/rbac";
import { siteFilterForRelation } from "@/lib/site-filter";
import { mergeFilters } from "@/lib/site-scope";

const PatchSchema = z.object({
  // null retire l'évaluation du carnet du primaire.
  moduleCarnet: z.number().int().min(1).max(4).nullable(),
  ligneCarnet: z.number().int().min(0).max(11).nullable().optional(),
});

/** Rattache une évaluation (ou un devoir) à un module du carnet du primaire, ou l'en retire. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }
    const denied = checkPermission(session.user.role, "evaluations:write");
    if (denied) return denied;

    const { id } = await params;
    const parsed = PatchSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Données invalides" }, { status: 400 });
    }
    const { moduleCarnet, ligneCarnet } = parsed.data;

    // eslint-disable-next-line ecolemiriam/require-annee-filter -- modification par identifiant : une évaluation d'une année révolue doit rester rattachable
    const evaluation = await prisma.evaluation.findFirst({
      where: mergeFilters({ id, tenantId: session.user.tenantId }, siteFilterForRelation(session.user, "classe")),
      select: { id: true },
    });
    if (!evaluation) {
      return NextResponse.json({ error: "Évaluation introuvable" }, { status: 404 });
    }

    await prisma.evaluation.update({
      where: { id: evaluation.id },
      data: { moduleCarnet, ligneCarnet: moduleCarnet === null ? null : (ligneCarnet ?? null) },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[API/evaluations/[id]] PATCH", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
