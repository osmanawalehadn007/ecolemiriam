import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { z } from "zod";
import { checkPermission } from "@/lib/rbac";
import { siteFilterForModel } from "@/lib/site-scope";

const JourEnum = z.enum([
  "DIMANCHE", "LUNDI", "MARDI", "MERCREDI", "JEUDI", "VENDREDI", "SAMEDI",
]);

const IndispoSchema = z.object({
  enseignantId: z.string().min(1),
  jour: JourEnum,
  heureDebut: z.string().regex(/^\d{2}:\d{2}$/),
  heureFin: z.string().regex(/^\d{2}:\d{2}$/),
  note: z.string().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }
    const denied = checkPermission(session.user.role, "emploi-du-temps:read");
    if (denied) return denied;

    const { searchParams } = new URL(req.url);
    const enseignantId = searchParams.get("enseignantId");
    const tenantId = session.user.tenantId;

    const indispos = await prisma.indisponibiliteEnseignant.findMany({
      where: {
        tenantId,
        ...siteFilterForModel("indisponibiliteEnseignant", session.user),
        ...(enseignantId ? { enseignantId } : {}),
      },
      include: {
        enseignant: { include: { user: { select: { name: true } } } },
      },
      orderBy: [{ jour: "asc" }, { heureDebut: "asc" }],
    });
    return NextResponse.json(indispos);
  } catch (error) {
    console.error("[API/indisponibilites GET]", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }
    const denied = checkPermission(session.user.role, "emploi-du-temps:write");
    if (denied) return denied;

    const body = await req.json();
    const parsed = IndispoSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Données invalides", details: parsed.error.issues },
        { status: 400 }
      );
    }

    const tenantId = session.user.tenantId;

    // Vérifier que l'enseignant appartient au tenant et au site
    const ens = await prisma.enseignant.findFirst({
      where: { id: parsed.data.enseignantId, tenantId, ...siteFilterForModel("enseignant", session.user) },
      select: { id: true },
    });
    if (!ens) {
      return NextResponse.json({ error: "Enseignant introuvable" }, { status: 404 });
    }

    const siteId = (session.user as { siteId?: string | null }).siteId ?? null;

    const indispo = await prisma.indisponibiliteEnseignant.create({
      data: {
        tenantId,
        siteId,
        enseignantId: parsed.data.enseignantId,
        jour: parsed.data.jour as never,
        heureDebut: parsed.data.heureDebut,
        heureFin: parsed.data.heureFin,
        source: "MANUEL",
        note: parsed.data.note,
      },
    });
    return NextResponse.json(indispo, { status: 201 });
  } catch (error) {
    console.error("[API/indisponibilites POST]", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
