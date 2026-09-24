import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/rbac";
import prisma from "@/lib/prisma";
import { eleveScopeFilter, mergeFilters } from "@/lib/site-filter";
import { teacherEleveRelationFilter } from "@/lib/teacher-classes";

export async function GET() {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const denied = checkPermission(session.user.role, "analytics:read");
  if (denied) return denied;

  const tenantId = session.user.tenantId;
  // Périmètre personnel inclus : un parent ne voit, dans le graphique du
  // tableau de bord, que les absences de ses propres enfants.
  const eleveScope = eleveScopeFilter(session.user, "eleve");

  // Calculer la date d'il y a 8 semaines
  const now = new Date();
  const eightWeeksAgo = new Date(now);
  eightWeeksAgo.setDate(eightWeeksAgo.getDate() - 56);

  const absences = await prisma.absence.findMany({
    // Agrégat du tableau de bord : le filtre de site borne le SITE, le
    // périmètre enseignant borne les CLASSES. Sans lui, le graphique d'un
    // enseignant additionnait les absences de tout le site.
    where: mergeFilters(
      { tenantId, date: { gte: eightWeeksAgo } },
      eleveScope,
      await teacherEleveRelationFilter(session.user, "eleve")
    ),
    select: {
      date: true,
      statut: true,
      isRetard: true,
    },
  });

  // Grouper par semaine
  const semaines: Record<string, { justifiees: number; injustifiees: number; retards: number }> = {};
  for (let i = 7; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i * 7);
    const key = `S${8 - i}`;
    semaines[key] = { justifiees: 0, injustifiees: 0, retards: 0 };
  }

  absences.forEach((a) => {
    const diffDays = Math.floor((now.getTime() - a.date.getTime()) / (1000 * 60 * 60 * 24));
    const weekIndex = 7 - Math.floor(diffDays / 7);
    if (weekIndex >= 0 && weekIndex <= 7) {
      const key = `S${weekIndex + 1}`;
      if (!semaines[key]) semaines[key] = { justifiees: 0, injustifiees: 0, retards: 0 };

      if (a.isRetard) {
        semaines[key].retards++;
      } else if (a.statut === "JUSTIFIEE") {
        semaines[key].justifiees++;
      } else if (a.statut === "INJUSTIFIEE" || a.statut === "EN_ATTENTE") {
        semaines[key].injustifiees++;
      }
    }
  });

  const data = Object.entries(semaines).map(([semaine, vals]) => ({
    semaine,
    ...vals,
  }));

  return NextResponse.json({ data });
}
