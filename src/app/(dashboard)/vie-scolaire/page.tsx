import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { Header } from "@/components/layout/Header";
import { VieScolaireView } from "@/components/vie-scolaire/VieScolaireView";
import { getTranslations } from "next-intl/server";
import { guardPage } from "@/lib/guard-page";
import { siteFilterForModel, mergeFilters } from "@/lib/site-scope";
import {
  teacherEleveRelationFilter,
  teacherEleveFilter,
  teacherClasseFilter,
} from "@/lib/teacher-classes";

async function getVieScolaireData(
  tenantId: string,
  incWhere: Record<string, unknown>,
  eleveWhere: Record<string, unknown>,
  classeWhere: Record<string, unknown>
) {
  const [incidents, eleves, classes] = await Promise.all([
    // Les trois `where` sont construits par l'appelant via
    // mergeFilters(filtre de site, filtre de périmètre enseignant).
    // eslint-disable-next-line ecolpro/require-site-filter
    prisma.incident.findMany({
      where: incWhere as Prisma.IncidentWhereInput,
      include: {
        eleve: { select: { id: true, nom: true, prenom: true, matricule: true, classe: { select: { nom: true } } } },
        rapportePar: { select: { name: true } },
        sanctions: true,
      },
      orderBy: { date: "desc" },
      take: 100,
    }),
    // eslint-disable-next-line ecolpro/require-site-filter
    prisma.eleve.findMany({
      where: eleveWhere as Prisma.EleveWhereInput,
      select: { id: true, nom: true, prenom: true, matricule: true, classe: { select: { nom: true } } },
      orderBy: [{ nom: "asc" }, { prenom: "asc" }],
    }),
    // eslint-disable-next-line ecolpro/require-site-filter
    prisma.classe.findMany({
      where: classeWhere as Prisma.ClasseWhereInput,
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
  // Périmètre enseignant / professeur principal : les incidents et les élèves
  // d'une classe qui n'est pas la sienne ne lui sont pas opposables.
  const [tIncFilter, tEleveFilter, tClasseFilter] = await Promise.all([
    teacherEleveRelationFilter(session!.user),
    teacherEleveFilter(session!.user),
    teacherClasseFilter(session!.user),
  ]);
  const incWhere = mergeFilters({ tenantId: session!.user.tenantId, ...incFilter }, tIncFilter);
  const eleveWhere = mergeFilters(
    { tenantId: session!.user.tenantId, statut: "ACTIF", ...eleveFilter },
    tEleveFilter
  );
  const classeWhere = mergeFilters({ tenantId: session!.user.tenantId, ...classeFilter }, tClasseFilter);
  const { incidents, eleves, classes } = await getVieScolaireData(
    session!.user.tenantId!,
    incWhere,
    eleveWhere,
    classeWhere
  );

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
