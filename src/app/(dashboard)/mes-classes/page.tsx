import { auth } from "@/lib/auth";
import { guardPage } from "@/lib/guard-page";
import { redirect } from "next/navigation";
import { runWithRlsBatch } from "@/lib/prisma";
import { Header } from "@/components/layout/Header";
import { MesClassesView } from "@/components/classes/MesClassesView";
import { getSitesForUserCached } from "@/lib/sites-cached";
import { getSiteColorMap } from "@/lib/site-colors";
import { getTeacherScope, isTeacherRole } from "@/lib/teacher-classes";
import { siteFilterForModel } from "@/lib/site-scope";
import type { Role } from "@prisma/client";

export const metadata = { title: "Mes classes — École Miriam" };

export default async function MesClassesPage({
  searchParams,
}: {
  searchParams: Promise<{ siteId?: string }>;
}) {
  const [session, sp] = await Promise.all([auth(), searchParams]);
  if (!session?.user?.tenantId) redirect("/select-tenant");
  guardPage(session, "classes:read");

  const { tenantId, id: userId, role } = session.user;
  const { siteId: qSiteId } = sp;

  const scope = isTeacherRole(role as Role)
    ? await getTeacherScope(tenantId, userId, role as Role)
    : undefined;

  const sessionSiteId = (session.user as { siteId?: string | null }).siteId ?? null;
  const activeSite = qSiteId ?? sessionSiteId ?? "all";

  const [sites, siteColors, { classesWithCount, matieresByClasse }] = await Promise.all([
    getSitesForUserCached(
      tenantId,
      userId,
      role === "TENANT_ADMIN" || role === "SUPER_ADMIN"
    ),
    getSiteColorMap(tenantId),
    runWithRlsBatch(tenantId, sessionSiteId, async (tx) => {
      const enseignant = await tx.enseignant.findFirst({
        where: { userId, tenantId },
        select: { id: true },
      });

      const isScoped = scope?.isRestricted && scope.classeIds.length > 0;
      const scopeDenyAll = scope?.isRestricted && scope.classeIds.length === 0;

      const scopeFilter = isScoped
        ? { id: { in: scope.classeIds } }
        : scopeDenyAll
          ? { id: "__none__" }
          : {};

      const [classes, matieresByClasse] = await Promise.all([
        tx.classe.findMany({
          where: {
            tenantId,
            ...(isScoped || scopeDenyAll ? {} : siteFilterForModel("classe", session.user)),
            ...scopeFilter,
          },
          include: {
            site: { select: { nom: true } },
          },
          orderBy: { nom: "asc" },
        }),
        (async (): Promise<Record<string, string[]>> => {
          const record: Record<string, string[]> = {};
          if (!enseignant) return record;
          const classIds = isScoped ? scope.classeIds : undefined;
          const [affectations, emplois] = await Promise.all([
            tx.enseignantAffectation.findMany({
              where: {
                enseignantId: enseignant.id,
                tenantId,
                ...(classIds ? { classeId: { in: classIds } } : {}),
              },
              select: {
                classeId: true,
                matiere: { select: { nom: true } },
              },
            }),
            tx.emploiTemps.findMany({
              where: {
                enseignantId: enseignant.id,
                tenantId,
                ...(classIds ? { classeId: { in: classIds } } : {}),
              },
              select: {
                classeId: true,
                matiere: { select: { nom: true } },
              },
            }),
          ]);
          for (const item of [...affectations, ...emplois]) {
            if (!record[item.classeId]) record[item.classeId] = [];
            if (item.matiere?.nom) record[item.classeId].push(item.matiere.nom);
          }
          for (const k of Object.keys(record)) {
            record[k] = [...new Set(record[k])];
          }
          return record;
        })(),
      ]);

      const classIds = classes.map((c) => c.id);
      const eleveCounts =
        classIds.length > 0
          ? await tx.eleve.groupBy({
              by: ["classeId"],
              where: { statut: "ACTIF", classeId: { in: classIds } },
              _count: { _all: true },
            })
          : [];
      const eleveCountMap = new Map(eleveCounts.map((e) => [e.classeId, e._count._all]));
      const classesWithCount = classes.map((c) => ({
        ...c,
        _count: { eleves: eleveCountMap.get(c.id) ?? 0 },
      }));

      return { classesWithCount, matieresByClasse };
    }),
  ]);

  const displayedClasses =
    activeSite === "all"
      ? classesWithCount
      : classesWithCount.filter(
          (c) => c.siteId === activeSite || (!c.siteId && activeSite === "all")
        );

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <Header
        title="Mes classes"
        subtitle="Classes et groupes dont vous avez la charge"
        userName={session.user.name}
        userAvatar={session.user.image ?? undefined}
      />
      <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin">
        <MesClassesView
          classes={displayedClasses}
          siteColors={siteColors}
          matieresByClasse={matieresByClasse}
          activeSite={activeSite}
          sites={sites.map((s) => ({ id: s.id, nom: s.nom }))}
        />
      </div>
    </div>
  );
}
