import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { z } from "zod";
import { checkPermission } from "@/lib/rbac";
import { siteFilterForModel, requireSiteIdForCreate, mergeFilters } from "@/lib/site-scope";
import { getAnneeCouranteLibelle } from "@/lib/annee-scolaire";
import { anneeFilterForModel } from "@/lib/annee-scope";
import { getTeacherScope, isTeacherRole } from "@/lib/teacher-classes";
import type { Role } from "@prisma/client";

// ------------------------------------------------------------
// GET /api/cahier-de-texte
// Liste des entrées du cahier de texte (filtrée par site & tenant)
// ------------------------------------------------------------
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }
    const denied = checkPermission(session.user.role, "cahier-texte:read");
    if (denied) return denied;

    const { searchParams } = new URL(req.url);
    const classeId = searchParams.get("classeId");
    const matiereId = searchParams.get("matiereId");
    const enseignantId = searchParams.get("enseignantId");
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const statut = searchParams.get("statut");

    const siteFilter = siteFilterForModel("cahierTexte", session.user);

    // Filtrer par classes de l'enseignant si applicable
    const scope = isTeacherRole(session.user.role as Role)
      ? await getTeacherScope(session.user.tenantId, session.user.id, session.user.role as Role)
      : undefined;

    const teacherClasseFilter = scope?.isRestricted && scope.classeIds.length > 0
      ? { classeId: { in: scope.classeIds } }
      : scope?.isRestricted
        ? { id: "__none__" as const }
        : {};

    const entries = await prisma.cahierTexte.findMany({
      // mergeFilters : les fragments de site et d'année encapsulent leur
      // prédicat dans `AND` ; étalés dans le même objet, le second écraserait
      // le premier.
      where: mergeFilters(
        {
          tenantId: session.user.tenantId,
          ...teacherClasseFilter,
          ...(classeId ? { classeId } : {}),
          ...(matiereId ? { matiereId } : {}),
          ...(enseignantId ? { enseignantId } : {}),
          ...(statut ? { statut: statut as never } : {}),
          ...(from || to
            ? {
                date: {
                  ...(from ? { gte: new Date(from) } : {}),
                  ...(to ? { lte: new Date(to) } : {}),
                },
              }
            : {}),
        },
        siteFilter,
        anneeFilterForModel(
          "cahierTexte",
          await getAnneeCouranteLibelle(session.user.tenantId),
        ),
      ),
      include: {
        classe: { select: { nom: true, niveau: true } },
        matiere: { select: { nom: true, code: true } },
        enseignant: { select: { id: true, specialite: true, user: { select: { name: true } } } },
        saisiePar: { select: { name: true } },
        commentaires: {
          include: { auteur: { select: { name: true, role: true } } },
          orderBy: { createdAt: "asc" },
        },
        devoirsLiees: {
          select: {
            id: true,
            description: true,
            dateRemise: true,
            statut: true,
            type: true,
          },
          orderBy: { dateRemise: "asc" },
        },
      },
      orderBy: { date: "desc" },
    });

    return NextResponse.json(entries);
  } catch (error) {
    console.error("[API/cahier-de-texte] GET", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

// ------------------------------------------------------------
// POST /api/cahier-de-texte
// Créer une entrée du cahier de texte
// ------------------------------------------------------------
const CreateSchema = z.object({
  classeId: z.string().min(1),
  matiereId: z.string().min(1),
  enseignantId: z.string().optional().nullable(),
  date: z.string().transform((str) => new Date(str)),
  heureDebut: z.string().optional().nullable(),
  heureFin: z.string().optional().nullable(),
  contenu: z.string().min(1),
  devoirs: z.string().optional().nullable(),
  prochainCours: z.string().optional().nullable(),
  commentaire: z.string().optional().nullable(),
  fichiers: z.array(z.object({
    nom: z.string(),
    type: z.string(),
    taille: z.number(),
    dataUrl: z.string(),
  })).optional().default([]),
  // Nouveaux champs structurés
  statut: z.enum(["PLANIFIEE", "EFFECTUEE", "CLOTUREE", "ANNULEE", "REMPLACEE"]).default("EFFECTUEE"),
  emploiTempsId: z.string().optional().nullable(),
  chapitreId: z.string().optional().nullable(),
  contenuStructure: z.object({
    objectifs: z.array(z.string()).optional().default([]),
    activites: z.array(z.object({
      type: z.enum(["COURS", "EXERCICE", "TP", "EVALUATION", "PROJET"]),
      description: z.string(),
      dureeMin: z.number().optional(),
    })).optional(),
    supports: z.array(z.object({
      type: z.enum(["DOCUMENT", "VIDEO", "LIEN", "COURS_EN_LIGNE"]),
      url: z.string(),
      coursId: z.string().optional(),
    })).optional(),
    differentiation: z.string().optional(),
  }).optional().nullable(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }
    const denied = checkPermission(session.user.role, "cahier-texte:write");
    if (denied) return denied;

    const siteError = requireSiteIdForCreate(session.user);
    if (siteError) return NextResponse.json({ error: siteError }, { status: 400 });

    const body = await req.json();
    const parsed = CreateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Données invalides", details: parsed.error },
        { status: 400 }
      );
    }

    const data = parsed.data;

    // Récupérer le siteId depuis la classe
    // eslint-disable-next-line ecolemiriam/require-site-filter -- lookup par ID + tenantId : le caller a déjà vérifié l'accès via gate/checkPermission
    const classe = await prisma.classe.findFirst({
      where: mergeFilters(
        { id: data.classeId, tenantId: session.user.tenantId },
        // On ne saisit pas une séance dans une classe d'une année révolue.
        anneeFilterForModel(
          "classe",
          await getAnneeCouranteLibelle(session.user.tenantId),
        ),
      ),
      select: { siteId: true },
    });
    if (!classe) {
      return NextResponse.json({ error: "Classe introuvable pour l'année en cours" }, { status: 404 });
    }

    const entry = await prisma.cahierTexte.create({
      data: {
        tenantId: session.user.tenantId,
        siteId: classe.siteId,
        classeId: data.classeId,
        matiereId: data.matiereId,
        enseignantId: data.enseignantId ?? null,
        date: data.date,
        heureDebut: data.heureDebut ?? null,
        heureFin: data.heureFin ?? null,
        contenu: data.contenu,
        devoirs: data.devoirs ?? null,
        prochainCours: data.prochainCours ?? null,
        commentaire: data.commentaire ?? null,
        fichiers: data.fichiers.length > 0 ? data.fichiers : undefined,
        saisieParId: session.user.id,
        // Nouveaux champs
        statut: data.statut,
        emploiTempsId: data.emploiTempsId ?? null,
        chapitreId: data.chapitreId ?? null,
        contenuStructure: data.contenuStructure ?? undefined,
        effectueeAt: data.statut === "EFFECTUEE" ? new Date() : null,
      },
      include: {
        classe: { select: { nom: true, niveau: true } },
        matiere: { select: { nom: true, code: true } },
      },
    });

    return NextResponse.json(entry, { status: 201 });
  } catch (error) {
    console.error("[API/cahier-de-texte] POST", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
