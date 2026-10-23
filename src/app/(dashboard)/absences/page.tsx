import { auth } from "@/lib/auth";
import { rlsBatch } from "@/lib/prisma";
import { guardPage } from "@/lib/guard-page";
import { redirect } from "next/navigation";
import { Header } from "@/components/layout/Header";
import { AbsencesStats } from "@/components/absences/AbsencesStats";
import { AbsencesList } from "@/components/absences/AbsencesList";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ClipboardCheck, Plus } from "lucide-react";
import { startOfDay, endOfDay, subDays } from "date-fns";
import { getTranslations } from "next-intl/server";
import { getTeacherScope, isTeacherRole } from "@/lib/teacher-classes";
import { siteFilterForModel, eleveScopeFilter, mergeFilters } from "@/lib/site-scope";
import { roleHasPermission } from "@/lib/rbac";
import type { Role } from "@prisma/client";

async function getAbsencesData(
  tenantId: string,
  siteFilter: Record<string, unknown>,
  classeFilter?: { classeIds: string[]; isRestricted: boolean }
) {
  const today = new Date();
  const sevenDaysAgo = subDays(today, 7);

  const absenceWhere = mergeFilters(
    { tenantId },
    siteFilter,
    classeFilter?.isRestricted && classeFilter.classeIds.length > 0
      ? { eleve: { classeId: { in: classeFilter.classeIds } } }
      : classeFilter?.isRestricted
        ? { id: "__none__" }
        : {}
  );

  const [absenceStats, recentesAbsences] = await rlsBatch((db) => [
    db.absence.groupBy({
      by: ["statut"],
      where: { ...absenceWhere, date: { gte: sevenDaysAgo } },
      _count: true,
    }),
    db.absence.findMany({
      where: absenceWhere,
      orderBy: { date: "desc" },
      take: 50,
      include: {
        eleve: {
          select: {
            nom: true,
            prenom: true,
            photoUrl: true,
            classe: { select: { nom: true, niveau: true, structure: { select: { type: true } } } },
          },
        },
      },
    }),
  ]);

  const statutMap = Object.fromEntries(absenceStats.map((s) => [s.statut, s._count]));
  const absencesSemaine = Object.values(statutMap).reduce((a, b) => a + b, 0);

  const absencesAujourdhui = recentesAbsences.filter(
    (a) => a.date >= startOfDay(today) && a.date <= endOfDay(today)
  ).length;

  return {
    absencesAujourdhui,
    absencesSemaine,
    absencesNonJustifiees: statutMap["INJUSTIFIEE"] ?? 0,
    recentesAbsences,
  };
}

export default async function AbsencesPage() {
  const [session, t] = await Promise.all([
    auth(),
    getTranslations("absences"),
  ]);
  if (!session?.user?.tenantId) redirect("/select-tenant");
  guardPage(session, "absences:read");

  // eleveScopeFilter combine le filtrage par site ET le périmètre personnel
  // (lien familial pour PARENT, userId pour STUDENT). Sans cela, un parent
  // disposant de absences:read voit toutes les absences du tenant.
  const siteFilter = eleveScopeFilter(session.user, "eleve");
  const classeFilter = isTeacherRole(session.user.role)
    ? await getTeacherScope(session.user.tenantId, session.user.id, session.user.role)
    : undefined;

  const data = await getAbsencesData(session.user.tenantId, siteFilter, classeFilter);
  const canWriteAbsences = roleHasPermission(session.user.role as Role, "absences:write");

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <Header
        title={t("title")}
        subtitle={t("subtitle")}
        userName={session.user.name}
        userAvatar={session.user.image ?? undefined}
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin">
        {/* En-tête actions */}
        <div className="flex items-center justify-between">
          <AbsencesStats
            auJourdhui={data.absencesAujourdhui}
            semaine={data.absencesSemaine}
            nonJustifiees={data.absencesNonJustifiees}
          />
          <div className="flex gap-2">
            {canWriteAbsences && (
              <Button asChild size="sm" variant="outline" className="gap-2">
                <Link href="/absences/appel">
                  <ClipboardCheck className="h-4 w-4" />
                  {t("call")}
                </Link>
              </Button>
            )}
            {canWriteAbsences && (
              <Button asChild size="sm" className="gap-2">
                <Link href="/absences">
                  <Plus className="h-4 w-4" />
                  {t("addAbsence")}
                </Link>
              </Button>
            )}
          </div>
        </div>

        {/* Liste des absences */}
        <AbsencesList absences={data.recentesAbsences} />
      </div>
    </div>
  );
}
