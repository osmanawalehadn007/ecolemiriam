import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { z } from "zod";
import { checkPermission } from "@/lib/rbac";
import { siteFilterForModel, mergeFilters } from "@/lib/site-scope";
import { getAnneeCouranteLibelle } from "@/lib/annee-scolaire";
import { anneeFilterForModel } from "@/lib/annee-scope";
import type { Role } from "@prisma/client";
import type { Jour } from "@prisma/client";

// ------------------------------------------------------------
// POST /api/cahier-de-texte/generate
// Génère les séances du cahier de texte pour une semaine donnée
// à partir de l'emploi du temps récurrent.
//
// Body : { weekStart: "2026-08-25" }  (lundi de la semaine)
// → pour chaque créneau EmploiTemps, calcule la date réelle
//   (jour de la semaine + heure) et crée une séance PLANIFIEE
//   si elle n'existe pas déjà (anti-doublon via emploiTempsId + date).
// ------------------------------------------------------------

const JOUR_TO_OFFSET: Record<Jour, number> = {
  DIMANCHE: 0,
  LUNDI: 1,
  MARDI: 2,
  MERCREDI: 3,
  JEUDI: 4,
  VENDREDI: 5,
  SAMEDI: 6,
};

const GenerateSchema = z.object({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }
    const denied = checkPermission(session.user.role as Role, "cahier-texte:write");
    if (denied) return denied;

    const body = await req.json();
    const parsed = GenerateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Date invalide", details: parsed.error }, { status: 400 });
    }

    const weekStart = new Date(parsed.data.weekStart + "T00:00:00.000Z");
    // weekStart doit être un lundi — si ce n'est pas le cas, reculer au lundi précédent
    const dayOfWeek = weekStart.getUTCDay(); // 0 = dimanche
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(weekStart);
    monday.setUTCDate(weekStart.getUTCDate() + mondayOffset);

    const siteFilter = siteFilterForModel("emploiTemps", session.user);

    // Récupérer les créneaux de l'emploi du temps de l'année en cours.
    // Sans cette borne, la génération repartait aussi des créneaux des
    // années révolues et fabriquait des séances hors cursus.
    const creneaux = await prisma.emploiTemps.findMany({
      where: mergeFilters(
        { tenantId: session.user.tenantId },
        siteFilter,
        anneeFilterForModel(
          "emploiTemps",
          await getAnneeCouranteLibelle(session.user.tenantId),
        ),
      ),
    });

    if (creneaux.length === 0) {
      return NextResponse.json({
        message: "Aucun créneau dans l'emploi du temps",
        created: 0,
        seances: [],
      });
    }

    // Calculer les dates réelles pour chaque créneau
    const seancesToCreate: {
      tenantId: string;
      siteId: string | null;
      classeId: string;
      matiereId: string;
      enseignantId: string | null;
      emploiTempsId: string;
      date: Date;
      heureDebut: string;
      heureFin: string;
      statut: "PLANIFIEE";
      contenu: string;
      saisieParId: string;
    }[] = [];

    for (const creneau of creneaux) {
      const offset = JOUR_TO_OFFSET[creneau.jour];
      const seanceDate = new Date(monday);
      seanceDate.setUTCDate(monday.getUTCDate() + offset);
      // Normaliser à minuit UTC pour la comparaison
      seanceDate.setUTCHours(0, 0, 0, 0);

      // Anti-doublon : vérifier si une séance existe déjà pour ce créneau + cette date
      // eslint-disable-next-line ecolemiriam/require-annee-filter -- anti-doublon ciblé sur un créneau précis : l'année est celle du créneau
      const existing = await prisma.cahierTexte.findFirst({
        where: {
          tenantId: session.user.tenantId,
          emploiTempsId: creneau.id,
          date: seanceDate,
        },
        select: { id: true },
      });

      if (existing) continue;

      // Récupérer le siteId depuis la classe
      // eslint-disable-next-line ecolemiriam/require-site-filter, ecolemiriam/require-annee-filter -- lookup par ID + tenantId ; lookup par id, la classe est celle du créneau déjà borné à l'année
      const classe = await prisma.classe.findFirst({
        where: { id: creneau.classeId, tenantId: session.user.tenantId },
        select: { siteId: true },
      });

      seancesToCreate.push({
        tenantId: session.user.tenantId,
        siteId: classe?.siteId ?? null,
        classeId: creneau.classeId,
        matiereId: creneau.matiereId,
        enseignantId: creneau.enseignantId,
        emploiTempsId: creneau.id,
        date: seanceDate,
        heureDebut: creneau.heureDebut,
        heureFin: creneau.heureFin,
        statut: "PLANIFIEE",
        contenu: "", // sera rempli par l'enseignant
        saisieParId: session.user.id,
      });
    }

    if (seancesToCreate.length === 0) {
      return NextResponse.json({
        message: "Toutes les séances de cette semaine existent déjà",
        created: 0,
        seances: [],
      });
    }

    // Créer les séances en lot
    const created = await prisma.cahierTexte.createMany({
      data: seancesToCreate,
    });

    // Récupérer les séances créées avec leurs relations pour l'UI
    // eslint-disable-next-line ecolemiriam/require-annee-filter -- relecture des séances qui viennent d'être créées, bornées par emploiTempsId
    const seances = await prisma.cahierTexte.findMany({
      where: {
        tenantId: session.user.tenantId,
        emploiTempsId: { in: creneaux.map((c) => c.id) },
        date: {
          gte: monday,
          lte: new Date(monday.getTime() + 7 * 24 * 60 * 60 * 1000),
        },
      },
      include: {
        classe: { select: { nom: true, niveau: true } },
        matiere: { select: { nom: true, code: true } },
        enseignant: { select: { id: true, specialite: true, user: { select: { name: true } } } },
      },
      orderBy: { date: "asc" },
    });

    return NextResponse.json({
      message: `${created.count} séance(s) générée(s)`,
      created: created.count,
      seances,
    }, { status: 201 });
  } catch (error) {
    console.error("[API/cahier-de-texte/generate] POST", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
