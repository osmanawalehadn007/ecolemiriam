import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { checkPermission } from "@/lib/rbac";
import { siteFilterForModel, eleveScopeFilter } from "@/lib/site-scope";
import { siteFilterForModel, mergeFilters } from "@/lib/site-scope";
import { teacherEleveFilter, resolveTeacherScope } from "@/lib/teacher-classes";

// GET — liste des élèves avec leur parcours et recommandation
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const denied = checkPermission(session.user.role, "orientation:read");
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const eleveId = searchParams.get("eleveId");
  const niveau = searchParams.get("niveau");

  // eleveScopeFilter restreint aux enfants du parent / à soi-même pour STUDENT
  const siteFilter = eleveScopeFilter(session.user, null);
  const siteFilter = siteFilterForModel("eleve", session.user);
  // Périmètre enseignant : un professeur principal n'instruit l'orientation que
  // des élèves de ses classes. `eleveId` venant de la requête HTTP, sans ce
  // fragment le parcours complet d'un élève hors périmètre restait lisible.
  const teacherFilter = await teacherEleveFilter(session.user);
  if (eleveId) {
    // Parcours complet d'un élève
    const [eleve, parcours, notes, absences, incidents] = await Promise.all([
      prisma.eleve.findFirst({
        where: mergeFilters(
          { id: eleveId, tenantId: session.user.tenantId, ...siteFilter },
          teacherFilter
        ) as Prisma.EleveWhereInput,
        include: {
          classe: { select: { nom: true, niveau: true, filiere: true } },
          // Les liens parent-élève sont des enfants de l'élève retourné, lui-même
          // déjà borné au tenant et au périmètre de sites par le `where` ci-dessus :
          // l'isolation est portée par la relation.
          // eslint-disable-next-line ecolemiriam/require-site-filter
          // eslint-disable-next-line ecolpro/require-site-filter
          parents: { include: { parent: { select: { nom: true, prenom: true, phone: true } } } },
        },
      }),
      // `eleveId` vient de la requête HTTP et n'est vérifié nulle part : sans filtre
      // de site, ces quatre agrégats livraient le parcours, les notes, les absences
      // et les incidents d'un élève d'un autre site du même établissement.
      prisma.parcoursScolaire.findMany({
        where: {
          eleveId,
          tenantId: session.user.tenantId,
          ...siteFilterForModel("parcoursScolaire", session.user),
        },
        orderBy: { annee: "desc" },
      }),
      prisma.note.findMany({
        where: {
          eleveId,
          tenantId: session.user.tenantId,
          isPubliee: true,
          ...siteFilterForModel("note", session.user),
        },
        select: { valeur: true, noteMax: true, coefficient: true, matiere: { select: { nom: true, code: true } }, createdAt: true },
        select: { valeur: true, noteMax: true, coefficient: true, matiere: { select: { nom: true } }, createdAt: true },
        orderBy: { createdAt: "desc" },
      }),
      prisma.absence.count({
        where: {
          eleveId,
          tenantId: session.user.tenantId,
          statut: "INJUSTIFIEE",
          ...siteFilterForModel("absence", session.user),
        },
      }),
      prisma.incident.count({
        where: {
          eleveId,
          tenantId: session.user.tenantId,
          ...siteFilterForModel("incident", session.user),
        },
      }),
    ]);

    // Fail-closed : si l'élève n'est pas dans le périmètre (site OU classes de
    // l'enseignant), on ne renvoie AUCUN de ses agrégats — ils sont tous
    // construits à partir du `eleveId` reçu, non vérifié par ailleurs.
    if (!eleve) {
      return NextResponse.json({ error: "Élève introuvable" }, { status: 404 });
    }

    return NextResponse.json({ eleve, parcours, notes, absencesInjust: absences, incidents });
  }

  // Liste élèves avec résumé parcours (par défaut niveau Seconde pour l'orientation)
  const niveauFilter = niveau ? { classe: { niveau } } : { classe: { niveau: "Seconde" } };
  const eleves = await prisma.eleve.findMany({
    where: { tenantId: session.user.tenantId, ...siteFilter, statut: "ACTIF", ...niveauFilter },
    where: mergeFilters(
      { tenantId: session.user.tenantId, ...siteFilter, statut: "ACTIF" },
      teacherFilter
    ) as Prisma.EleveWhereInput,
    include: {
      classe: { select: { nom: true, niveau: true } },
      // Parcours, notes et absences sont des enfants des élèves retournés, eux-mêmes
      // déjà bornés au tenant et au périmètre de sites par le `where` ci-dessus :
      // l'isolation est portée par la relation, la répéter n'ajouterait qu'une
      // jointure vers le même élève.
      // eslint-disable-next-line ecolemiriam/require-site-filter
      parcours: { orderBy: { annee: "desc" }, take: 1 },
      // eslint-disable-next-line ecolemiriam/require-site-filter
      notes: { where: { isPubliee: true }, select: { valeur: true, noteMax: true, coefficient: true, matiere: { select: { nom: true, code: true } } } },
      // eslint-disable-next-line ecolemiriam/require-site-filter
      // eslint-disable-next-line ecolpro/require-site-filter
      // eslint-disable-next-line ecolpro/require-site-filter
      notes: { where: { isPubliee: true }, select: { valeur: true, noteMax: true, coefficient: true } },
      // eslint-disable-next-line ecolpro/require-site-filter
      absences: { where: { statut: "INJUSTIFIEE" }, select: { id: true } },
    },
    orderBy: [{ nom: "asc" }, { prenom: "asc" }],
  });

  return NextResponse.json({ eleves });
}

// POST — créer / mettre à jour un parcours scolaire
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const denied = checkPermission(session.user.role, "orientation:write");
  if (denied) return denied;

  const body = await req.json();
  const Schema = z.object({
    eleveId: z.string(),
    annee: z.string(),
    classe: z.string(),
    niveau: z.string(),
    moyenneAnnuelle: z.number().optional(),
    rang: z.number().optional(),
    effectif: z.number().optional(),
    decision: z.string().optional(),
    mention: z.string().optional(),
    recommandation: z.enum([
      "FILIERE_SCIENTIFIQUE", "FILIERE_LITTERAIRE", "FILIERE_TECHNIQUE",
      "FILIERE_PROFESSIONNELLE", "REDOUBLEMENT", "SOUTIEN_RENFORCE", "EXCELLENTE_VOIE",
    ]).optional(),
    commentaire: z.string().optional(),
  });

  const data = Schema.parse(body);

  // Garde serveur : on ne crée / met à jour un parcours que pour un élève de
  // son périmètre (site + classes de l'enseignant).
  const teacherFilter = await teacherEleveFilter(session.user);
  const eleveAutorise = await prisma.eleve.findFirst({
    where: mergeFilters(
      { id: data.eleveId, tenantId: session.user.tenantId, ...siteFilterForModel("eleve", session.user) },
      teacherFilter
    ) as Prisma.EleveWhereInput,
    select: { id: true },
  });
  if (!eleveAutorise) {
    return NextResponse.json(
      { error: "Vous ne pouvez pas modifier l'orientation d'un élève hors de vos classes" },
      { status: 403 }
    );
  }

  const parcours = await prisma.parcoursScolaire.upsert({
    where: { eleveId_annee: { eleveId: data.eleveId, annee: data.annee } },
    create: { ...data, tenantId: session.user.tenantId },
    update: data,
  });

  return NextResponse.json({ parcours }, { status: 201 });
}
