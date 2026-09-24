import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { checkPermission } from "@/lib/rbac";
import { siteFilterForRelation } from "@/lib/site-filter";

// GET — liste des enseignants avec fiche RH
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const denied = checkPermission(session.user.role, "rh:read");
  if (denied) return denied;

  const siteFilter = siteFilterForRelation(session.user, "user");

  const enseignants = await prisma.enseignant.findMany({
    where: { tenantId: session.user.tenantId, ...siteFilter },
    include: {
      user: {
        select: {
          id: true, name: true, email: true, avatarUrl: true,
          phone: true, isActive: true, lastLoginAt: true,
        },
      },
      ficheRH: {
        include: {
          // eslint-disable-next-line ecolemiriam/require-site-filter -- include filtré par le where parent (tenantId sur la table racine)
          // Enfants d'une fiche RH elle-même rattachée à un enseignant déjà
          // borné au périmètre par le `where` racine : aucun chemin de site
          // propre (`BulletinPaie` → `FicheRH` → `Enseignant` → sites).
          // eslint-disable-next-line ecolpro/require-site-filter
          bulletinsPaie: {
            orderBy: [{ annee: "desc" }, { mois: "desc" }],
            take: 3,
          },
        },
      },
      // eslint-disable-next-line ecolemiriam/require-site-filter -- include filtré par le where parent (tenantId sur la table racine)
      // Même raisonnement : créneaux et classes de CET enseignant, déjà filtré.
      // eslint-disable-next-line ecolpro/require-site-filter
      emploiTemps: {
        select: {
          jour: true, heureDebut: true, heureFin: true,
          matiere: { select: { nom: true, couleur: true } },
          classe: { select: { nom: true } },
        },
      },
      // eslint-disable-next-line ecolemiriam/require-site-filter -- include filtré par le where parent (tenantId sur la table racine)
      // eslint-disable-next-line ecolpro/require-site-filter
      classesPrincipales: {
        select: { id: true, nom: true, niveau: true },
      },
    },
    orderBy: { user: { name: "asc" } },
  });

  return NextResponse.json({ enseignants });
}
