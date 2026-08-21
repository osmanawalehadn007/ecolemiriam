import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { z } from "zod";
import { checkPermission } from "@/lib/rbac";
import { siteFilterForModel } from "@/lib/site-scope";

// ------------------------------------------------------------
// Helpers : détection du cycle (primaire / collège / lycée)
// ------------------------------------------------------------
// Primaire : niveaux 1-5
// Collège  : niveaux 6-9
// Lycée    : niveaux 10-12 OU libellés "Seconde", "Première", "Terminale"
function isPrimaire(niveau: string): boolean {
  const n = parseInt(niveau, 10);
  if (!isNaN(n)) return n >= 1 && n <= 5;
  return false;
}

function isLycee(niveau: string): boolean {
  const n = parseInt(niveau, 10);
  if (!isNaN(n)) return n >= 10 && n <= 12;
  const lower = niveau.toLowerCase();
  return ["seconde", "première", "premiere", "terminale"].some((l) =>
    lower.includes(l)
  );
}

function isLangueMatiere(nom: string): boolean {
  const lower = nom.toLowerCase();
  return ["anglais", "arabe", "français", "francais", "angl", "arab"].some(
    (l) => lower.includes(l)
  );
}

// ------------------------------------------------------------
// GET /api/enseignants/[id]/affectations
// Récupère les affectations (classes + matières) d'un enseignant
// ------------------------------------------------------------
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }
    const denied = checkPermission(session.user.role, "rh:read");
    if (denied) return denied;

    const { id } = await params;
    const siteFilter = siteFilterForModel("enseignant", session.user);

    // Vérifier que l'enseignant existe et appartient au tenant
    const enseignant = await prisma.enseignant.findFirst({
      where: { id, tenantId: session.user.tenantId, ...siteFilter },
      select: { id: true, userId: true },
    });
    if (!enseignant) {
      return NextResponse.json({ error: "Enseignant introuvable" }, { status: 404 });
    }

    const [affectations, matieres] = await Promise.all([
      prisma.enseignantAffectation.findMany({
        where: { enseignantId: id, tenantId: session.user.tenantId },
        include: {
          classe: { select: { id: true, nom: true, niveau: true } },
          matiere: { select: { id: true, nom: true, code: true } },
        },
      }),
      prisma.enseignantMatiere.findMany({
        where: { enseignantId: id, tenantId: session.user.tenantId },
        include: {
          matiere: { select: { id: true, nom: true, code: true } },
        },
      }),
    ]);

    return NextResponse.json({ affectations, matieres });
  } catch (error) {
    console.error("[API/enseignants/[id]/affectations] GET", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

// ------------------------------------------------------------
// PUT /api/enseignants/[id]/affectations
// Remplace toutes les affectations d'un enseignant
// ------------------------------------------------------------
const AffectationSchema = z.object({
  affectations: z.array(
    z.object({
      classeId: z.string().min(1),
      matiereId: z.string().nullable().optional(),
    })
  ),
  matieres: z.array(z.string()).optional().default([]),
});

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }
    const denied = checkPermission(session.user.role, "rh:write");
    if (denied) return denied;

    const { id } = await params;
    const siteFilter = siteFilterForModel("enseignant", session.user);

    const enseignant = await prisma.enseignant.findFirst({
      where: { id, tenantId: session.user.tenantId, ...siteFilter },
      select: { id: true },
    });
    if (!enseignant) {
      return NextResponse.json({ error: "Enseignant introuvable" }, { status: 404 });
    }

    const body = await req.json();
    const parsed = AffectationSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Données invalides", details: parsed.error },
        { status: 400 }
      );
    }

    const { affectations, matieres } = parsed.data;

    // Validation des règles :
    // - Primaire : 1 classe max, sauf prof de langue → plusieurs classes
    // - Collège/Lycée : plusieurs classes, matiereId obligatoire
    if (affectations.length > 0) {
      // Récupérer les classes pour vérifier les niveaux
      const classeIds = [...new Set(affectations.map((a) => a.classeId))];
      const classes = await prisma.classe.findMany({
        where: { id: { in: classeIds }, tenantId: session.user.tenantId },
        select: { id: true, niveau: true },
      });

      const classeMap = new Map(classes.map((c) => [c.id, c.niveau]));

      // Vérifier si toutes les classes sont au primaire
      const allPrimaire = affectations.every(
        (a) => {
          const niveau = classeMap.get(a.classeId);
          return niveau ? isPrimaire(niveau) : false;
        }
      );

      if (allPrimaire && classeIds.length > 1) {
        // Au primaire, plusieurs classes → vérifier que c'est un prof de langue
        const matiereIds = [...new Set(affectations.map((a) => a.matiereId).filter(Boolean) as string[])];
        if (matiereIds.length > 0) {
          const matieresDb = await prisma.matiere.findMany({
            where: { id: { in: matiereIds }, tenantId: session.user.tenantId },
            select: { id: true, nom: true },
          });
          const allLangues = matieresDb.every((m) => isLangueMatiere(m.nom));
          if (!allLangues) {
            return NextResponse.json(
              {
                error:
                  "Au primaire, un enseignant ne peut avoir qu'une seule classe, sauf les professeurs de langue (anglais, arabe).",
              },
              { status: 400 }
            );
          }
        } else {
          return NextResponse.json(
            {
              error:
                "Au primaire, un enseignant ne peut avoir qu'une seule classe, sauf les professeurs de langue (anglais, arabe).",
            },
            { status: 400 }
          );
        }
      }

      // Collège/Lycée : matiereId obligatoire
      const collegeLyceeAffectations = affectations.filter(
        (a) => {
          const niveau = classeMap.get(a.classeId);
          return niveau && !isPrimaire(niveau);
        }
      );
      const missingMatiere = collegeLyceeAffectations.find((a) => !a.matiereId);
      if (missingMatiere) {
        return NextResponse.json(
          { error: "Au collège et au lycée, une matière est obligatoire pour chaque affectation." },
          { status: 400 }
        );
      }
    }

    // Transaction : supprimer les anciennes affectations + créer les nouvelles
    await prisma.$transaction(async (tx) => {
      // Supprimer les anciennes affectations
      await tx.enseignantAffectation.deleteMany({
        where: { enseignantId: id, tenantId: session.user.tenantId! },
      });
      await tx.enseignantMatiere.deleteMany({
        where: { enseignantId: id, tenantId: session.user.tenantId! },
      });

      // Créer les nouvelles affectations
      if (affectations.length > 0) {
        await tx.enseignantAffectation.createMany({
          data: affectations.map((a) => ({
            tenantId: session.user.tenantId!,
            enseignantId: id,
            classeId: a.classeId,
            matiereId: a.matiereId ?? null,
          })),
          skipDuplicates: true,
        });
      }

      // Créer les liaisons matières (pour collège/lycée)
      if (matieres.length > 0) {
        await tx.enseignantMatiere.createMany({
          data: matieres.map((mId) => ({
            tenantId: session.user.tenantId!,
            enseignantId: id,
            matiereId: mId,
          })),
          skipDuplicates: true,
        });
      }
    });

    // Récupérer le résultat
    const [newAffectations, newMatieres] = await Promise.all([
      prisma.enseignantAffectation.findMany({
        where: { enseignantId: id, tenantId: session.user.tenantId },
        include: {
          classe: { select: { id: true, nom: true, niveau: true } },
          matiere: { select: { id: true, nom: true, code: true } },
        },
      }),
      prisma.enseignantMatiere.findMany({
        where: { enseignantId: id, tenantId: session.user.tenantId },
        include: {
          matiere: { select: { id: true, nom: true, code: true } },
        },
      }),
    ]);

    return NextResponse.json({ affectations: newAffectations, matieres: newMatieres });
  } catch (error) {
    console.error("[API/enseignants/[id]/affectations] PUT", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
