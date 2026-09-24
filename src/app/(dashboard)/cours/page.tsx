import { guardPage } from "@/lib/guard-page";
import { auth } from "@/lib/auth";
import { guardPage } from "@/lib/guard-page";
import { redirect } from "next/navigation";
import { Header } from "@/components/layout/Header";
import { CoursView } from "@/components/cours/CoursView";
import { getTranslations } from "next-intl/server";
import { getSitesForUser } from "@/lib/actions/eleve";
import { getSiteColorMap } from "@/lib/site-colors";
import { SiteTabs } from "@/components/sites/SiteTabs";
import prisma from "@/lib/prisma";
import { getTeacherScope, isTeacherRole } from "@/lib/teacher-classes";
import type { Role } from "@prisma/client";
import { siteFilterForModel } from "@/lib/site-scope";

export const metadata = { title: "Cours en ligne — LMS | École Miriam" };

export default async function CoursPage(
  props: {
    searchParams: Promise<{ siteId?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const session = await auth();
  if (!session?.user?.tenantId) redirect("/select-tenant");
export default async function CoursPage({
  searchParams,
}: {
}) {
  if (!session?.user?.tenantId) redirect("/login");
  guardPage(session, "cours:read");

  const [t, tCommon, sites, siteColors, sp] = await Promise.all([
    getTranslations("cours"),
    getTranslations("common"),
    getSitesForUser(),
    getSiteColorMap(session.user.tenantId),
    searchParams,
  ]);

  const sessionSiteId = (session.user as { siteId?: string | null }).siteId ?? null;
  const { siteId } = sp;

  const activeSite = (() => {
    if (!siteId) return sessionSiteId ? sessionSiteId : "all";
    if (siteId === "all") {
      if (sessionSiteId) return sessionSiteId;
      return session.user.role === "TENANT_ADMIN" || session.user.role === "SUPER_ADMIN" ? "all" : sessionSiteId ?? "all";
    }
    return sites.some((s) => s.id === siteId) ? siteId : (sessionSiteId ?? "all");
  })();

  const currentSiteName = activeSite === "all"
    ? tCommon("allSites")
    : (sites.find((s) => s.id === activeSite)?.nom ?? "Site inconnu");
  const currentSiteColor = activeSite === "all" ? undefined : siteColors[activeSite];

  // Récupérer le périmètre de l'enseignant connecté (classes + matières assignées)
  // afin de pré-remplir automatiquement la modale de création de cours.
  const role = session.user.role as Role;
  const teacherScope = isTeacherRole(role)
    ? await getTeacherScope(session.user.tenantId, session.user.id, role)
    : { classeIds: [], matiereIds: [], isRestricted: false };

  // Pour un enseignant restreint : uniquement SES classes et SES matières.
  // Pour les autres rôles (admin, etc.) : toutes les classes/matières du site actif.
  const siteFilter = { tenantId: session.user.tenantId, ...siteFilterForModel("classe", session.user) };
  const matiereSiteFilter = { tenantId: session.user.tenantId, ...siteFilterForModel("matiere", session.user) };
  const [classes, matieres] = teacherScope.isRestricted
    ? await Promise.all([
        // Le périmètre enseignant S'AJOUTE au filtre de site : il ne le remplace pas.
        prisma.classe.findMany({
          where: {
            ...siteFilter,
            id: { in: teacherScope.classeIds.length > 0 ? teacherScope.classeIds : ["__none__"] },
          },
          select: { id: true, nom: true },
          orderBy: { nom: "asc" },
        }),
        prisma.matiere.findMany({
          where: {
            ...matiereSiteFilter,
            id: { in: teacherScope.matiereIds.length > 0 ? teacherScope.matiereIds : ["__none__"] },
          },
          select: { id: true, nom: true },
          orderBy: { nom: "asc" },
        }),
      ])
    : await Promise.all([
        prisma.classe.findMany({
          where: siteFilter,
          select: { id: true, nom: true },
          orderBy: { nom: "asc" },
        }),
        prisma.matiere.findMany({
          where: matiereSiteFilter,
          select: { id: true, nom: true },
          orderBy: { nom: "asc" },
        }),
      ]);

  const enseignant = isTeacherRole(role)
    // eslint-disable-next-line ecolpro/require-site-filter -- fiche de l'utilisateur connecté lui-même (userId = soi), le site est déjà validé par la session
    ? await prisma.enseignant.findFirst({
        where: { userId: session.user.id, tenantId: session.user.tenantId },
        select: { id: true, matricule: true, user: { select: { name: true } } },
      })
    : null;

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <Header
        title={t("title")}
        subtitle={t("subtitle")}
        site={currentSiteName}
        siteColor={currentSiteColor}
        userName={session.user.name}
        userAvatar={session.user.image ?? undefined}
      />
      <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin">
        <SiteTabs
          sites={sites.map((s) => ({ id: s.id, nom: s.nom }))}
          siteColors={siteColors}
          activeSiteId={activeSite}
          className="mb-2"
        />
        <CoursView siteColors={siteColors} activeSite={activeSite} userRole={session.user.role} />
        <CoursView
          siteColors={siteColors}
          activeSite={activeSite}
          classes={classes}
          matieres={matieres}
          enseignantNom={enseignant?.user?.name ?? session.user.name ?? null}
        />
      </div>
    </div>
  );
}
