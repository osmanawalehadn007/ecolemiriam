import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { z } from "zod";
import { checkPermission } from "@/lib/rbac";
import { siteFilterForModel, requireSiteIdForCreate, mergeFilters } from "@/lib/site-scope";
import { isTeacherRole } from "@/lib/teacher-classes";
import type { Prisma, Role } from "@prisma/client";

const CoursSchema = z.object({
  titre: z.string().min(1).max(200),
  description: z.string().optional(),
  niveau: z.enum(["DEBUTANT", "INTERMEDIAIRE", "AVANCE"]).default("INTERMEDIAIRE"),
  statut: z.enum(["BROUILLON", "PUBLIE", "ARCHIVE"]).default("BROUILLON"),
  matiereNom: z.string().optional(),
  classeNom: z.string().optional(),
  imageUrl: z.string().optional(),
  dureeMin: z.number().optional(),
});

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const denied = checkPermission(session.user.role, "cours:read");
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const statut = searchParams.get("statut");
  const niveau = searchParams.get("niveau");
  const requestedSiteId = searchParams.get("siteId");

  const sessionSiteId = (session.user as { siteId?: string | null }).siteId ?? null;
  let activeSiteId: string | null = sessionSiteId;
  if (requestedSiteId === "all") activeSiteId = null;
  else if (requestedSiteId) activeSiteId = requestedSiteId;

  const claims = {
    ...session.user,
    siteId: activeSiteId,
  };

  const siteFilter = siteFilterForModel("cours", claims);

  // Un BROUILLON n'est visible que par son auteur : les collègues ne doivent
  // pas lire un cours en cours de rédaction. `Cours` ne stocke que `auteurNom`
  // (pas d'`auteurId`), d'où la comparaison au nom de session — encapsulée dans
  // `AND` pour ne pas écraser le filtre de site via un `OR` de premier niveau.
  const teacherDraftFilter = isTeacherRole(session.user.role as Role)
    ? { AND: [{ OR: [{ statut: { not: "BROUILLON" } }, { auteurNom: session.user.name }] }] }
    : {};

  const cours = await prisma.cours.findMany({
    where: mergeFilters(
      {
        tenantId: session.user.tenantId,
        ...siteFilter,
        ...(statut && { statut: statut as "BROUILLON" | "PUBLIE" | "ARCHIVE" }),
        ...(niveau && { niveau: niveau as "DEBUTANT" | "INTERMEDIAIRE" | "AVANCE" }),
      },
      teacherDraftFilter
    ) as Prisma.CoursWhereInput,
    include: {
      site: { select: { nom: true } },
      _count: { select: { contenus: true, progressions: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    cours: cours.map((c) => ({
      ...c,
      siteId: c.siteId,
      siteNom: c.site?.nom ?? null,
    })),
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const denied = checkPermission(session.user.role, "cours:write");
  if (denied) return denied;

  const siteError = requireSiteIdForCreate(session.user);
  if (siteError) return NextResponse.json({ error: siteError }, { status: 400 });

  const body = await req.json();
  const data = CoursSchema.parse(body);

  const siteId = (session.user as { siteId?: string | null }).siteId ?? null;

  const cours = await prisma.cours.create({
    data: {
      tenantId: session.user.tenantId,
      siteId: siteId || null,
      ...data,
      auteurNom: session.user.name,
    },
    include: {
      _count: { select: { contenus: true, progressions: true } },
    },
  });

  return NextResponse.json({ cours }, { status: 201 });
}
