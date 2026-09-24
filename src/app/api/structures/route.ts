import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/rbac";
import prisma from "@/lib/prisma";
import { z } from "zod";
import type { StructureType } from "@prisma/client";
import { siteFilterForModel, siteIdForCreate, requireSiteIdForCreate } from "@/lib/site-scope";

const STRUCTURE_TYPES: StructureType[] = ["MATERNELLE", "PRIMAIRE", "COLLEGE", "LYCEE"];

const CreateSchema = z.object({
  types: z.array(z.enum(["MATERNELLE", "PRIMAIRE", "COLLEGE", "LYCEE"])).min(1),
});

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }
    const denied = checkPermission(session.user.role, "structures:read");
    if (denied) return denied;

    const structures = await prisma.structure.findMany({
      where: { tenantId: session.user.tenantId, ...siteFilterForModel("structure", session.user) },
      include: {
        _count: { select: { classes: true } },
      },
      orderBy: [{ type: "asc" }],
    });

    return NextResponse.json(structures);
  } catch (error) {
    console.error("[API/structures] GET", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }

    const denied = checkPermission(session.user.role, "structures:write");
    if (denied) return denied;

    // Un site doit être sélectionné pour créer une structure : la structure
    // sera rattachée à ce site spécifique (siteId non-null).
    const siteError = requireSiteIdForCreate(session.user);
    if (siteError) return NextResponse.json({ error: siteError }, { status: 400 });

    const json = await req.json();
    const { types } = CreateSchema.parse(json);

    const tenantId = session.user.tenantId;
    const siteId = siteIdForCreate(session.user); // non-null grâce au check ci-dessus

    // Récupérer les structures déjà existantes pour ce site (ou partagées)
    // pour ne pas les recréer.
    const existing = await prisma.structure.findMany({
      where: { tenantId, ...siteFilterForModel("structure", session.user) },
      select: { type: true },
    });
    const existingTypes = new Set(existing.map((s) => s.type));

    const toCreate = types
      .filter((type) => !existingTypes.has(type))
      .map((type) => ({
        tenantId,
        siteId,
        type,
        nom: typeLabel(type),
        actif: true,
      }));

    if (toCreate.length > 0) {
      await prisma.structure.createMany({ data: toCreate });
    }

    const all = await prisma.structure.findMany({
      where: { tenantId, ...siteFilterForModel("structure", session.user) },
      include: { _count: { select: { classes: true } } },
      orderBy: [{ type: "asc" }],
    });

    return NextResponse.json(all, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    console.error("[API/structures] POST", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }

    const denied = checkPermission(session.user.role, "structures:delete");
    if (denied) return denied;

    const { searchParams } = new URL(req.url);
    const structureId = searchParams.get("id");
    if (!structureId) {
      return NextResponse.json({ error: "id requis" }, { status: 400 });
    }

    // Vérifier l'appartenance de la structure au tenant et au site
    const structure = await prisma.structure.findFirst({
      where: { id: structureId, tenantId: session.user.tenantId, ...siteFilterForModel("structure", session.user) },
    });
    if (!structure) {
      return NextResponse.json({ error: "Structure introuvable" }, { status: 404 });
    }

    // Vérifier qu'il n'y a pas de classes rattachées
    // eslint-disable-next-line ecolemiriam/require-annee-filter -- toutes les années comptent : une structure conserve ses classes archivées, la supprimer les orphelinerait
    const classCount = await prisma.classe.count({
      where: { structureId, tenantId: session.user.tenantId, ...siteFilterForModel("classe", session.user) },
    });
    if (classCount > 0) {
      return NextResponse.json(
        { error: `Impossible de supprimer : ${classCount} classe(s) rattachée(s)` },
        { status: 409 }
      );
    }

    await prisma.structure.delete({
      where: { id: structureId },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[API/structures] DELETE", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

function typeLabel(type: StructureType): string {
  const labels: Record<StructureType, string> = {
    MATERNELLE: "Maternelle",
    PRIMAIRE: "Primaire",
    COLLEGE: "Collège",
    LYCEE: "Lycée",
  };
  return labels[type];
}
