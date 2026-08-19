import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/rbac";
import prisma from "@/lib/prisma";
import { siteFilterForModel } from "@/lib/site-scope";

/**
 * GET /api/vie-scolaire/retards-stats?classeId=...&seuil=3
 *
 * Suivi des retards par élève et sanctions automatiques suggérées.
 * - Compte les retards par élève sur la période en cours
 * - Suggère des sanctions quand le seuil est atteint (défaut: 3 retards = 1 retenue)
 * - Peut créer automatiquement un incident + sanction
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const denied = checkPermission(session.user.role, "vie-scolaire:read");
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const classeId = searchParams.get("classeId");
  const seuil = parseInt(searchParams.get("seuil") ?? "3");
  const autoCreate = searchParams.get("autoCreate") === "true";

  const tenantId = session.user.tenantId;
  const siteFilter = siteFilterForModel("absence", session.user);

  // Période : 30 derniers jours
  const dateFrom = new Date();
  dateFrom.setDate(dateFrom.getDate() - 30);

  // Récupérer tous les retards (isRetard = true)
  const retards = await prisma.absence.findMany({
    where: {
      tenantId,
      ...siteFilter,
      isRetard: true,
      date: { gte: dateFrom },
      ...(classeId ? { eleve: { classeId } } : {}),
    },
    include: {
      eleve: {
        select: {
          id: true, nom: true, prenom: true, matricule: true,
          classe: { select: { nom: true } },
        },
      },
    },
    orderBy: { date: "desc" },
  });

  // Grouper par élève
  const parEleve = new Map<string, {
    eleveId: string;
    nom: string;
    prenom: string;
    matricule: string;
    classe: string;
    count: number;
    derniersRetards: Array<{ date: string; motif: string }>;
  }>();

  for (const r of retards) {
    const key = r.eleveId;
    if (!parEleve.has(key)) {
      parEleve.set(key, {
        eleveId: r.eleveId,
        nom: r.eleve.nom,
        prenom: r.eleve.prenom,
        matricule: r.eleve.matricule,
        classe: r.eleve.classe?.nom ?? "—",
        count: 0,
        derniersRetards: [],
      });
    }
    const e = parEleve.get(key)!;
    e.count++;
    if (e.derniersRetards.length < 5) {
      e.derniersRetards.push({
        date: r.date.toISOString(),
        motif: r.motif,
      });
    }
  }

  // Identifier les élèves qui dépassent le seuil
  const elevesEnSeuil = [...parEleve.values()]
    .filter((e) => e.count >= seuil)
    .sort((a, b) => b.count - a.count);

  // Créer automatiquement des incidents + sanctions si demandé
  let created = 0;
  if (autoCreate && elevesEnSeuil.length > 0) {
    for (const eleve of elevesEnSeuil) {
      // Vérifier s'il y a déjà un incident de retard récent
      const existingIncident = await prisma.incident.findFirst({
        where: {
          tenantId,
          eleveId: eleve.eleveId,
          type: "AUTRE",
          description: { contains: `Retards répétés (${eleve.count})` },
          createdAt: { gte: dateFrom },
        },
      });

      if (!existingIncident) {
        const incident = await prisma.incident.create({
          data: {
            tenantId,
            eleveId: eleve.eleveId,
            type: "AUTRE",
            statut: "EN_TRAITEMENT",
            gravite: 2,
            description: `Retards répétés (${eleve.count} retards en 30 jours)`,
            date: new Date(),
            rapporteParId: session.user.id,
          },
        });

        await prisma.sanction.create({
          data: {
            incidentId: incident.id,
            type: "TRAVAUX_INTERET_GENERAL",
            description: `Retenue pour ${eleve.count} retards cumulés`,
            dateDebut: new Date(),
            dateFin: null,
            parentNotifie: false,
          },
        });
        created++;
      }
    }
  }

  // Stats globales
  const totalRetards = retards.length;
  const elevesConcernes = parEleve.size;
  const moyenneRetards = elevesConcernes > 0 ? totalRetards / elevesConcernes : 0;

  return NextResponse.json({
    seuil,
    periode: "30 jours",
    totalRetards,
    elevesConcernes,
    moyenneRetards: Math.round(moyenneRetards * 10) / 10,
    elevesEnSeuil: elevesEnSeuil.map((e) => ({
      ...e,
      sanctionSuggeree: e.count >= seuil * 2 ? "EXCLUSION_COURS" : "TRAVAUX_INTERET_GENERAL",
    })),
    incidentsCreated: created,
  });
}
