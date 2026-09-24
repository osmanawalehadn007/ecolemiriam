import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { z } from "zod";
import { checkPermission } from "@/lib/rbac";
import { siteFilterForRelation } from "@/lib/site-filter";
import { resolveTeacherScope } from "@/lib/teacher-classes";
import { revalidateTag } from "next/cache";

// GET : Récupérer la grille de notes (élèves de la classe + leurs notes actuelles pour cette évaluation)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }
    const denied = checkPermission(session.user.role, "evaluations:read");
    if (denied) return denied;

    const evaluationId = (await params).id;
    const siteFilter = siteFilterForRelation(session.user, "classe");

    // eslint-disable-next-line ecolemiriam/require-annee-filter -- lookup par id : l'évaluation porte son année via sa classe
    // Garde serveur : un enseignant ne lit la grille que d'une évaluation
    // portant sur SA classe et SA matière. `evaluationId` vient de l'URL, le
    // seul filtre de site ne l'empêchait pas de consulter celle d'un collègue.
    const teacherScope = await resolveTeacherScope(session.user);

    const evaluation = await prisma.evaluation.findFirst({
      where: {
        id: evaluationId,
        tenantId: session.user.tenantId,
        ...siteFilter,
        ...(teacherScope.isRestricted
          ? {
              classeId: { in: teacherScope.classeIds.length > 0 ? teacherScope.classeIds : ["__none__"] },
              matiereId: { in: teacherScope.matiereIds.length > 0 ? teacherScope.matiereIds : ["__none__"] },
            }
          : {}),
      },
      include: {
        // eslint-disable-next-line ecolemiriam/require-site-filter -- include filtré par le where parent (tenantId sur la table racine)
        classe: { include: { eleves: { orderBy: { prenom: 'asc' } } } },
        // La classe est déjà bornée par le `where` (classeId dans le périmètre
        // enseignant + site) : ses élèves en découlent, aucun autre chemin
        // n'existe. `Eleve` est filtré par site dans toutes les autres requêtes.
        classe: { include: {
          // eslint-disable-next-line ecolpro/require-site-filter
          eleves: { orderBy: { prenom: 'asc' } },
        } },
        notes: true,
      }
    });

    if (!evaluation) {
      return NextResponse.json({ error: "Évaluation introuvable" }, { status: 404 });
    }

    // Fusionner les élèves avec leurs notes existantes
    const grille = evaluation.classe.eleves.map(eleve => {
      const existingNote = evaluation.notes.find(n => n.eleveId === eleve.id);
      return {
        eleveId: eleve.id,
        matricule: eleve.matricule,
        nom: eleve.nom,
        prenom: eleve.prenom,
        noteId: existingNote?.id ?? null,
        valeur: existingNote?.valeur ?? null,
        commentaire: existingNote?.commentaire ?? "",
      };
    });

    return NextResponse.json({ evaluation, grille });
  } catch (error) {
    console.error("[API/evaluations/notes] GET", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

const UpdateNotesSchema = z.object({
  notes: z.array(
    z.object({
      eleveId: z.string().min(1),
      valeur: z.number().nullable(),
      commentaire: z.string().optional().nullable(),
    })
  )
});

// PUT : Sauvegarder massivement les notes
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }
    const denied = checkPermission(session.user.role, "evaluations:write");
    if (denied) return denied;

    const evaluationId = (await params).id;
    const siteFilter2 = siteFilterForRelation(session.user, "classe");

    // eslint-disable-next-line ecolemiriam/require-annee-filter -- lookup par id : l'évaluation porte son année via sa classe
    // Même garde qu'en lecture : la grille d'un AUTRE enseignant n'est ni
    // lisible ni modifiable, y compris en forgeant l'identifiant de l'évaluation.
    const teacherScope2 = await resolveTeacherScope(session.user);

    const evaluation = await prisma.evaluation.findFirst({
      where: {
        id: evaluationId,
        tenantId: session.user.tenantId,
        ...siteFilter2,
        ...(teacherScope2.isRestricted
          ? {
              classeId: { in: teacherScope2.classeIds.length > 0 ? teacherScope2.classeIds : ["__none__"] },
              matiereId: { in: teacherScope2.matiereIds.length > 0 ? teacherScope2.matiereIds : ["__none__"] },
            }
          : {}),
      }
    });

    if (!evaluation) {
      return NextResponse.json({ error: "Évaluation introuvable" }, { status: 404 });
    }

    const body = await req.json();
    const parsed = UpdateNotesSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: "Données invalides", details: parsed.error }, { status: 400 });
    }

    const updates = parsed.data.notes;

    const tenantIdStr = session.user.tenantId as string;
    const userIdStr = session.user.id as string;

    const notesToCreate = updates
      .filter(n => n.valeur !== null)
      .map(n => ({
        tenantId: tenantIdStr,
        eleveId: n.eleveId,
        classeId: evaluation.classeId,
        matiereId: evaluation.matiereId,
        periodeId: evaluation.periodeId,
        evaluationId: evaluation.id,
        valeur: n.valeur as number,
        noteMax: 20,
        coefficient: evaluation.coefficient,
        type: evaluation.type,
        intitule: evaluation.titre,
        date: evaluation.date,
        commentaire: n.commentaire ?? "",
        saisieParId: userIdStr,
      }));

    await prisma.$transaction([
      prisma.note.deleteMany({ where: { evaluationId, tenantId: tenantIdStr } }),
      prisma.note.createMany({ data: notesToCreate })
    ]);

    // Mettre à jour le statut de l'évaluation si nécessaire
    if (notesToCreate.length > 0 && evaluation.statut === "PLANIFIE") {
      await prisma.evaluation.update({
        where: { id: evaluationId },
        data: { statut: "TERMINE" }
      });
    }

    revalidateTag("dashboard-data", "max");

    return NextResponse.json({ success: true, count: notesToCreate.length });
  } catch (error) {
    console.error("[API/evaluations/notes] PUT", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
