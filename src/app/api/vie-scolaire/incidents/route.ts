import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { z } from "zod";
import { checkPermission } from "@/lib/rbac";
import { siteFilterForModel, requireSiteIdForCreate, mergeFilters } from "@/lib/site-scope";
import { isEleveInTeacherScope, teacherEleveRelationFilter } from "@/lib/teacher-classes";

const CreateSchema = z.object({
  eleveId: z.string().min(1),
  type: z.enum(["RETARD", "BAVARDAGE", "INSOLENCE", "BAGARRE", "TRICHE", "VANDALISM", "ABSENTEISME", "AUTRE"]),
  gravite: z.number().int().min(1).max(3),
  description: z.string().min(5).max(2000),
  lieu: z.string().max(100).optional(),
  date: z.string(),
  notes: z.string().max(1000).optional(),
});

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.tenantId) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    const denied = checkPermission(session.user.role, "vie-scolaire:read");
    if (denied) return denied;

    const { searchParams } = new URL(req.url);
    const eleveId = searchParams.get("eleveId");
    const statut = searchParams.get("statut");
    const tenantId = session.user.tenantId;

    const incidents = await prisma.incident.findMany({
      // Le filtre de site borne le SITE ; le périmètre enseignant borne les
      // CLASSES. Les deux sont cumulatifs : un enseignant ne doit voir que les
      // incidents de ses propres élèves, pas ceux du site entier.
      where: mergeFilters(
        {
          tenantId,
          ...(eleveId ? { eleveId } : {}),
          ...(statut ? { statut: statut as never } : {}),
        },
        siteFilterForModel("incident", session.user),
        await teacherEleveRelationFilter(session.user, "eleve")
      ),
      include: {
        eleve: { select: { id: true, nom: true, prenom: true, matricule: true, classe: { select: { nom: true } } } },
        rapportePar: { select: { name: true } },
        sanctions: true,
      },
      orderBy: { date: "desc" },
    });

    return NextResponse.json(incidents);
  } catch (error) {
    console.error("[API/vie-scolaire/incidents GET]", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.tenantId) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    const denied = checkPermission(session.user.role, "vie-scolaire:write");
    if (denied) return denied;

    const siteError = requireSiteIdForCreate(session.user);
    if (siteError) return NextResponse.json({ error: siteError }, { status: 400 });

    const body = await req.json();
    const parsed = CreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Données invalides", details: parsed.error.issues }, { status: 400 });
    }

    const { eleveId, type, gravite, description, lieu, date, notes } = parsed.data;
    const tenantId = session.user.tenantId;

    // Vérifier que l'élève appartient au tenant
    // eslint-disable-next-line ecolemiriam/require-site-filter -- lookup par ID + tenantId : le caller a déjà vérifié l'accès via gate/checkPermission
    const eleve = await prisma.eleve.findFirst({ where: { id: eleveId, tenantId } });
    // `eleveId` vient du corps : pour un enseignant, seule une classe de son
    // périmètre est recevable. Refus AVANT la lecture de la fiche élève — un
    // 404 confirmerait l'organisation des classes d'un collègue.
    if (!(await isEleveInTeacherScope(session.user, eleveId))) {
      return NextResponse.json({ error: "Élève hors de votre périmètre" }, { status: 403 });
    }

    // Vérifier que l'élève appartient au tenant ET au périmètre de sites
    const eleve = await prisma.eleve.findFirst({
      where: { id: eleveId, tenantId, ...siteFilterForModel("eleve", session.user) },
    });
    if (!eleve) return NextResponse.json({ error: "Élève introuvable" }, { status: 404 });

    const incident = await prisma.incident.create({
      data: {
        tenantId,
        eleveId,
        rapporteParId: session.user.id,
        type,
        gravite,
        description,
        lieu: lieu ?? null,
        date: new Date(date),
        notes: notes ?? null,
        statut: "OUVERT",
      },
      include: {
        eleve: { select: { id: true, nom: true, prenom: true, matricule: true, classe: { select: { nom: true } } } },
        rapportePar: { select: { name: true } },
        sanctions: true,
      },
    });

    return NextResponse.json(incident, { status: 201 });
  } catch (error) {
    console.error("[API/vie-scolaire/incidents POST]", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
