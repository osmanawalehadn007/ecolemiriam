import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { Header } from "@/components/layout/Header";
import { VieScolaireView } from "@/components/vie-scolaire/VieScolaireView";
import { getTranslations } from "next-intl/server";
import { guardPage } from "@/lib/guard-page";
import { siteFilterForModel } from "@/lib/site-scope";
import { getTeacherScope, isTeacherRole } from "@/lib/teacher-classes";
import type { Role } from "@prisma/client";

async function getVieScolaireData(
  tenantId: string,
  incFilter: Record<string, unknown>,
  eleveFilter: Record<string, unknown>,
  classeFilter: Record<string, unknown>,
  scope?: { classeIds: string[]; isRestricted: boolean }
) {
  const teacherClasseFilter = scope?.isRestricted && scope.classeIds.length > 0
    ? { id: { in: scope.classeIds } }
    : scope?.isRestricted
      ? { id: "__none__" as const }
      : {};

  const [incidents, eleves, classes] = await Promise.all([
    prisma.incident.findMany({
      where: {
        tenantId, ...incFilter,
        ...(scope?.isRestricted && scope.classeIds.length > 0
          ? { eleve: { classeId: { in: scope.classeIds } } }
          : scope?.isRestricted
            ? { id: "__none__" as const }
            : {}),
      },
      include: {
        eleve: { select: { id: true, nom: true, prenom: true, matricule: true, classe: { select: { nom: true } } } },
        rapportePar: { select: { name: true } },
        sanctions: true,
      },
      orderBy: { date: "desc" },
      take: 100,
    }),
    prisma.eleve.findMany({
      where: {
        tenantId, statut: "ACTIF", ...eleveFilter,
        ...(scope?.isRestricted && scope.classeIds.length > 0
          ? { classeId: { in: scope.classeIds } }
          : scope?.isRestricted
            ? { id: "__none__" as const }
            : {}),
      },
      select: { id: true, nom: true, prenom: true, matricule: true, classe: { select: { nom: true } } },
      orderBy: [{ nom: "asc" }, { prenom: "asc" }],
    }),
    prisma.classe.findMany({
      where: { tenantId, ...classeFilter, ...teacherClasseFilter },
      select: { id: true, nom: true },
      orderBy: { nom: "asc" },
    }),
  ]);

  return { incidents, eleves, classes };
}

export default async function VieScolairePage() {
  const [session, t] = await Promise.all([
    auth(),
    getTranslations("vieScolaire"),
  ]);
  guardPage(session, "vie-scolaire:read");

  const incFilter = siteFilterForModel("incident", session!.user);
  const eleveFilter = siteFilterForModel("eleve", session!.user);
  const classeFilter = siteFilterForModel("classe", session!.user);

  // Filtrer par classes de l'enseignant si applicable
  const scope = isTeacherRole(session!.user.role as Role)
    ? await getTeacherScope(session!.user.tenantId!, session!.user.id, session!.user.role as Role)
    : undefined;

  const { incidents, eleves, classes } = await getVieScolaireData(session!.user.tenantId!, incFilter, eleveFilter, classeFilter, scope);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <Header
        title={t("title")}
        subtitle={t("subtitle")}
        userName={session!.user.name}
        userAvatar={session!.user.image ?? undefined}
      />
      <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
        <VieScolaireView
          incidents={incidents}
          eleves={eleves}
          classes={classes}
          currentUserId={session!.user.id}
          tenantId={session!.user.tenantId!}
        />
      </div>
    </div>
  );
}
