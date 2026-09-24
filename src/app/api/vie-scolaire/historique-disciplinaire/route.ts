import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/rbac";
import prisma from "@/lib/prisma";
import { siteFilterForModel } from "@/lib/site-scope";

/**
 * GET /api/vie-scolaire/historique-disciplinaire?eleveId=...
 *
 * Historique disciplinaire complet d'un élève :
 * - Timeline des incidents + sanctions
 * - Statistiques (nb incidents, nb sanctions, par type, par gravité)
 * - Évolution mensuelle
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const denied = checkPermission(session.user.role, "vie-scolaire:read");
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const eleveId = searchParams.get("eleveId");

  if (!eleveId) {
    return NextResponse.json({ error: "eleveId requis" }, { status: 400 });
  }

  const tenantId = session.user.tenantId;
  const siteFilter = siteFilterForModel("incident", session.user);

  const incidents = await prisma.incident.findMany({
    where: { tenantId, eleveId, ...siteFilter },
    include: {
      sanctions: true,
      rapportePar: { select: { name: true } },
    },
    orderBy: { date: "desc" },
  });

  const eleve = await prisma.eleve.findFirst({
    where: { id: eleveId, tenantId, ...siteFilterForModel("eleve", session.user) },
    select: { id: true, nom: true, prenom: true, matricule: true, classe: { select: { nom: true } } },
  });

  if (!eleve) {
    return NextResponse.json({ error: "Élève introuvable" }, { status: 404 });
  }

  // Timeline combinée (incidents + sanctions triés par date)
  const timeline: Array<{
    date: string;
    type: "INCIDENT" | "SANCTION";
    titre: string;
    description: string;
    gravite?: number;
    statut?: string;
    sanctionType?: string;
    rapportePar?: string | null;
  }> = [];

  for (const inc of incidents) {
    timeline.push({
      date: inc.date.toISOString(),
      type: "INCIDENT",
      titre: `Incident (${inc.gravite === 3 ? "grave" : inc.gravite === 2 ? "moyen" : "léger"})`,
      description: inc.description,
      gravite: inc.gravite,
      statut: inc.statut,
      rapportePar: inc.rapportePar?.name ?? null,
    });
    for (const san of inc.sanctions) {
      timeline.push({
        date: san.dateDebut.toISOString(),
        type: "SANCTION",
        titre: san.type,
        description: san.description ?? "",
        sanctionType: san.type,
      });
    }
  }

  timeline.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // Statistiques
  const totalIncidents = incidents.length;
  const totalSanctions = incidents.reduce((sum, i) => sum + i.sanctions.length, 0);

  const parGravite = {
    leger: incidents.filter((i) => i.gravite === 1).length,
    moyen: incidents.filter((i) => i.gravite === 2).length,
    grave: incidents.filter((i) => i.gravite === 3).length,
  };

  const parTypeSanction: Record<string, number> = {};
  for (const inc of incidents) {
    for (const san of inc.sanctions) {
      parTypeSanction[san.type] = (parTypeSanction[san.type] ?? 0) + 1;
    }
  }

  const parStatut = {
    OUVERT: incidents.filter((i) => i.statut === "OUVERT").length,
    EN_TRAITEMENT: incidents.filter((i) => i.statut === "EN_TRAITEMENT").length,
    RESOLU: incidents.filter((i) => i.statut === "RESOLU").length,
    CLASSE: incidents.filter((i) => i.statut === "CLASSE").length,
  };

  // Évolution mensuelle (6 derniers mois)
  const now = new Date();
  const evolution: Array<{ mois: string; incidents: number; sanctions: number }> = [];
  for (let i = 5; i >= 0; i--) {
    const mStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const mEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);
    const mIncidents = incidents.filter(
      (inc) => inc.date >= mStart && inc.date <= mEnd
    ).length;
    const mSanctions = incidents.reduce((sum, inc) => {
      return sum + inc.sanctions.filter((s) => s.dateDebut >= mStart && s.dateDebut <= mEnd).length;
    }, 0);
    evolution.push({
      mois: mStart.toLocaleDateString("fr-FR", { month: "short", year: "2-digit" }),
      incidents: mIncidents,
      sanctions: mSanctions,
    });
  }

  return NextResponse.json({
    eleve: {
      id: eleve.id,
      nom: `${eleve.prenom} ${eleve.nom}`,
      matricule: eleve.matricule,
      classe: eleve.classe?.nom ?? "—",
    },
    totalIncidents,
    totalSanctions,
    parGravite,
    parTypeSanction,
    parStatut,
    evolution,
    timeline,
  });
}
