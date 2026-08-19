import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/rbac";
import prisma from "@/lib/prisma";
import { z } from "zod";
import { siteFilterForModel } from "@/lib/site-scope";

/**
 * POST /api/vie-scolaire/workflow-sanction
 *
 * Workflow automatique de sanctions escaladées :
 * - Gravité 1 (léger) → AVERTISSEMENT verbal
 * - Gravité 2 (moyen) → BLAME + convocation parents si 2+ incidents
 * - Gravité 3 (grave) → EXCLUSION_TEMP + CONVOCATION_PARENTS
 *
 * L'API suggère les sanctions et peut les appliquer automatiquement.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const denied = checkPermission(session.user.role, "vie-scolaire:write");
  if (denied) return denied;

  const body = await req.json();
  const schema = z.object({
    incidentId: z.string().min(1),
    autoApply: z.boolean().default(false),
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Données invalides", details: parsed.error.issues }, { status: 400 });
  }

  const { incidentId, autoApply } = parsed.data;
  const tenantId = session.user.tenantId;

  const incident = await prisma.incident.findFirst({
    where: { id: incidentId, tenantId, ...siteFilterForModel("incident", session.user) },
    include: {
      eleve: { select: { id: true, nom: true, prenom: true } },
      sanctions: true,
    },
  });

  if (!incident) {
    return NextResponse.json({ error: "Incident introuvable" }, { status: 404 });
  }

  // Compter les incidents précédents de l'élève
  const incidentsCount = await prisma.incident.count({
    where: {
      tenantId,
      eleveId: incident.eleveId,
      statut: { in: ["OUVERT", "EN_TRAITEMENT", "RESOLU"] },
    },
  });

  // Déterminer les sanctions suggérées selon la gravité et l'historique
  const suggestions: Array<{
    type: string;
    description: string;
    dateDebut: string;
    dateFin: string | null;
    reason: string;
  }> = [];

  const now = new Date();

  if (incident.gravite === 1) {
    suggestions.push({
      type: "AVERTISSEMENT",
      description: `Avertissement verbal pour: ${incident.description}`,
      dateDebut: now.toISOString(),
      dateFin: null,
      reason: "Gravité légère (niveau 1)",
    });
  } else if (incident.gravite === 2) {
    suggestions.push({
      type: "BLAME",
      description: `Blâme officiel pour: ${incident.description}`,
      dateDebut: now.toISOString(),
      dateFin: null,
      reason: "Gravité moyenne (niveau 2)",
    });
    if (incidentsCount >= 2) {
      suggestions.push({
        type: "CONVOCATION_PARENTS",
        description: `Convocation des parents de ${incident.eleve.prenom} ${incident.eleve.nom} suite à ${incidentsCount} incidents`,
        dateDebut: now.toISOString(),
        dateFin: null,
        reason: `${incidentsCount} incidents cumulés`,
      });
    }
  } else if (incident.gravite === 3) {
    const finExclusion = new Date(now);
    finExclusion.setDate(finExclusion.getDate() + 3);
    suggestions.push({
      type: "EXCLUSION_TEMP",
      description: `Exclusion temporaire de 3 jours pour: ${incident.description}`,
      dateDebut: now.toISOString(),
      dateFin: finExclusion.toISOString(),
      reason: "Gravité grave (niveau 3)",
    });
    suggestions.push({
      type: "CONVOCATION_PARENTS",
      description: `Convocation urgente des parents de ${incident.eleve.prenom} ${incident.eleve.nom}`,
      dateDebut: now.toISOString(),
      dateFin: null,
      reason: "Incident grave nécessitant rencontre parents",
    });
  }

  // Appliquer automatiquement si demandé
  let applied = 0;
  if (autoApply && suggestions.length > 0) {
    for (const s of suggestions) {
      // Vérifier si cette sanction existe déjà
      const exists = incident.sanctions.some(
        (san) => san.type === s.type
      );
      if (exists) continue;

      await prisma.sanction.create({
        data: {
          incidentId: incident.id,
          type: s.type as never,
          description: s.description,
          dateDebut: new Date(s.dateDebut),
          dateFin: s.dateFin ? new Date(s.dateFin) : null,
          parentNotifie: false,
        },
      });
      applied++;
    }

    // Mettre à jour le statut de l'incident
    if (applied > 0) {
      await prisma.incident.update({
        where: { id: incident.id },
        data: { statut: "EN_TRAITEMENT" },
      });
    }
  }

  return NextResponse.json({
    incident: {
      id: incident.id,
      eleve: `${incident.eleve.prenom} ${incident.eleve.nom}`,
      gravite: incident.gravite,
      description: incident.description,
      incidentsCount,
    },
    suggestions,
    applied: autoApply ? applied : 0,
    autoApplied: autoApply,
  });
}
