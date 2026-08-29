import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { runWithTenant } from "@/lib/prisma";
import { Header } from "@/components/layout/Header";
import { CommunicationView } from "@/components/communication/CommunicationView";
import { getTranslations } from "next-intl/server";
import { guardPage } from "@/lib/guard-page";
import { siteFilterForModel, mergeFilters, type SessionSiteClaims } from "@/lib/site-scope";
import { getTeacherScope, isTeacherRole } from "@/lib/teacher-classes";
import { anneeFilterForModel } from "@/lib/annee-scope";
import { getAnneeCouranteLibelle } from "@/lib/annee-scolaire";
import { unstable_cache } from "next/cache";
import type { Role } from "@prisma/client";

// Cache des données communication — sans ce cache, chaque navigation ré-exécute
// getTeacherScope + getAnneeCouranteLibelle + 2 requêtes prisma en parallèle.
const getCommunicationData = unstable_cache(
  async (
    tenantId: string,
    siteId: string | null,
    userId: string,
    role: Role,
    scopeHash: string,
  ) => {
    const sessionUser = { tenantId, siteId, role, id: userId } as SessionSiteClaims;
    const scope = scopeHash ? JSON.parse(scopeHash) as { classeIds: string[]; isRestricted: boolean } : undefined;
    const isScoped = scope?.isRestricted && scope.classeIds.length > 0;
    const scopeDenyAll = scope?.isRestricted && scope.classeIds.length === 0;

    return runWithTenant(tenantId, siteId, async () => {
      const notifFilter = siteFilterForModel("notification", sessionUser);
      const classeFilter = siteFilterForModel("classe", sessionUser);
      // Une annonce s'adresse aux classes de l'année en cours.
      const anneeFilter = anneeFilterForModel(
        "classe",
        await getAnneeCouranteLibelle(tenantId),
      );
      const [notifications, classes] = await Promise.all([
        prisma.notification.findMany({
          where: { tenantId, ...notifFilter },
          include: { envoyePar: { select: { name: true, avatarUrl: true } } },
          orderBy: { createdAt: "desc" },
          take: 50,
        }),
        prisma.classe.findMany({
          where: mergeFilters(
            { tenantId },
            classeFilter,
            anneeFilter,
            isScoped
              ? { id: { in: scope.classeIds } }
              : scopeDenyAll
                ? { id: "__none__" }
                : {},
          ),
          select: { id: true, nom: true, niveau: true },
          orderBy: { nom: "asc" },
        }),
      ]);

      return { notifications, classes };
    });
  },
  ["communication-data"],
  { revalidate: 30, tags: ["communication-data"] }
);

export default async function CommunicationPage() {
  const [session, t] = await Promise.all([
    auth(),
    getTranslations("communication"),
  ]);
  guardPage(session, "communication:read");

  const { tenantId, id: userId, role } = session!.user;
  // Filtrer par classes de l'enseignant si applicable
  const scope = isTeacherRole(role as Role)
    ? await getTeacherScope(tenantId!, userId, role as Role)
    : undefined;

  const scopeHash = scope ? JSON.stringify(scope) : "";
  const { notifications, classes } = await getCommunicationData(
    tenantId!,
    session!.user.siteId ?? null,
    userId,
    role as Role,
    scopeHash,
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
        <CommunicationView notifications={notifications} classes={classes} userRole={session!.user.role} />
      </div>
    </div>
  );
}
