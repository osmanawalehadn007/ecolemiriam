import { guardPage } from "@/lib/guard-page";
import { auth } from "@/lib/auth";
import { guardPage } from "@/lib/guard-page";
import { redirect } from "next/navigation";
import prisma, { runWithTenant } from "@/lib/prisma";
import { Header } from "@/components/layout/Header";
import { ExamensManager } from "@/components/examens/ExamensManager";
import { SiteTabs } from "@/components/sites/SiteTabs";
import { siteFilterForModel, type SessionSiteClaims, mergeFilters } from "@/lib/site-scope";
import { getSitesForUser } from "@/lib/actions/eleve";
import { getSiteColorMap } from "@/lib/site-colors";
import { getTeacherScope, isTeacherRole } from "@/lib/teacher-classes";
import { anneeFilterForModel } from "@/lib/annee-scope";
import { getAnneeCouranteLibelle } from "@/lib/annee-scolaire";
import type { Role } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { unstable_cache } from "next/cache";

// Cache des examens — sans ce cache, chaque navigation ré-exécute
// getTeacherScope + getAnneeCouranteLibelle + 3 requêtes findMany en parallèle.
// Les fragments d'isolation sont construits ici, au plus près des requêtes :
// passés en paramètres, ils n'étaient plus rattachables à leur origine, ni par
// un relecteur ni par l'analyse statique.
const getExamensData = unstable_cache(
  async (tenantId: string, claimsHash: string, scopeHash: string) => {
    const claims = JSON.parse(claimsHash) as SessionSiteClaims;
    const scope = scopeHash
      ? (JSON.parse(scopeHash) as { classeIds: string[]; matiereIds: string[]; isRestricted: boolean })
      : undefined;
    const siteId = claims.siteId ?? null;

    return runWithTenant(tenantId, siteId, async () => {
      // Pour les enseignants : filtrer les classes, matières ET examens par classeId
      const teacherClasseFilter =
        scope?.isRestricted && scope.classeIds.length > 0
          ? { id: { in: scope.classeIds } }
          : scope?.isRestricted
            ? { id: "__none__" as const }
            : {};

      // Filtrer les examens : un enseignant ne voit que les examens qui ont
      // au moins une session liée à une de ses classes
      const teacherExamenFilter =
        scope?.isRestricted && scope.classeIds.length > 0
          ? { sessions: { some: { classeId: { in: scope.classeIds } } } }
          : scope?.isRestricted
            ? { id: "__none__" as const }
            : {};

      const [examens, classes, matieres] = await Promise.all([
        prisma.examen.findMany({
          where: { tenantId, ...siteFilterForModel("examen", claims), ...teacherExamenFilter },
          include: {
            sessions: {
              where: {
                ...siteFilterForModel("sessionExamen", claims),
                ...(scope?.isRestricted && scope.classeIds.length > 0
                  ? { OR: [{ classeId: { in: scope.classeIds } }, { classeId: null }] }
                  : {}),
              },
              orderBy: { date: "asc" },
            },
          },
          orderBy: { dateDebut: "desc" },
        }),
        prisma.classe.findMany({
          where: mergeFilters(
            { tenantId, ...teacherClasseFilter },
            siteFilterForModel("classe", claims),
            anneeFilterForModel("classe", await getAnneeCouranteLibelle(tenantId)),
          ),
          select: { id: true, nom: true, niveau: true, siteId: true, site: { select: { nom: true } } },
          orderBy: { nom: "asc" },
        }),
        prisma.matiere.findMany({
          where: {
            tenantId,
            ...siteFilterForModel("matiere", claims),
            ...(scope?.isRestricted && scope.matiereIds.length > 0
              ? { id: { in: scope.matiereIds } }
              : scope?.isRestricted
                ? { id: "__none__" }
                : {}),
          },
          select: { id: true, nom: true, code: true, coefficient: true },
          orderBy: { nom: "asc" },
        }),
      ]);
      return { examens, classes, matieres };
    });
  },
  ["examens-data"],
  { revalidate: 30, tags: ["examens-data"] }
);

export default async function ExamensPage(
  props: {
    searchParams: Promise<{ siteId?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const session = await auth();
  if (!session?.user?.tenantId) redirect("/select-tenant");
import { siteFilterForModel, type SessionSiteClaims } from "@/lib/site-scope";
async function getExamensData(
  tenantId: string,
  claims: SessionSiteClaims,
  scope?: { isRestricted: boolean; classeNiveaux: string[]; matiereNoms: string[] }
  // Restriction enseignant : les listes de la modale de session sont limitées
  // à SON périmètre (matières + niveaux de SES classes).
    scope?.isRestricted && scope.classeNiveaux.length > 0
      ? { niveau: { in: scope.classeNiveaux } }
  const teacherMatiereFilter =
    scope?.isRestricted && scope.matiereNoms.length > 0
      ? { nom: { in: scope.matiereNoms } }
  // Restriction enseignant sur les sessions affichées : uniquement les matières
  // qu'il dispense et les niveaux de SES classes. Les sessions sans niveau
  // restent visibles (le niveau est optionnel à la création).
  const teacherSessionFilter = scope?.isRestricted
    ? {
        matiereNom: { in: scope.matiereNoms },
        ...(scope.classeNiveaux.length > 0
          ? { OR: [{ niveau: { in: scope.classeNiveaux } }, { niveau: null }] }
      where: { tenantId, ...siteFilterForModel("examen", claims) },
          where: { ...siteFilterForModel("sessionExamen", claims), ...teacherSessionFilter },
      where: { tenantId, ...siteFilterForModel("classe", claims), ...teacherClasseFilter },
      where: { tenantId, ...siteFilterForModel("matiere", claims), ...teacherMatiereFilter },
export default async function ExamensPage({
  searchParams,
}: {
}) {
  if (!session?.user?.tenantId) redirect("/login");
  guardPage(session, "examens:read");

  const [tCommon, sites, siteColors, sp] = await Promise.all([
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

  const examenClaims: SessionSiteClaims = {
    role: session.user.role,
    siteId: activeSite === "all" ? null : activeSite,
    siteIds: (session.user as { siteIds?: string[] | null }).siteIds ?? null,
    tenantHasSites: (session.user as { tenantHasSites?: boolean }).tenantHasSites ?? false,
  };

  // Filtrer par classes de l'enseignant si applicable
  const scope = isTeacherRole(session.user.role as Role)
    ? await getTeacherScope(session.user.tenantId!, session.user.id, session.user.role as Role)
    : undefined;

  const claimsHash = JSON.stringify(examenClaims);
  const scopeHash = scope ? JSON.stringify(scope) : "";
  const { examens, classes, matieres } = await getExamensData(session.user.tenantId, claimsHash, scopeHash);
  // Périmètre de l'enseignant connecté : converti en niveaux de classes et noms
  // de matières (car les sessions d'examen sont rattachées par nom, pas par ID).
  const role = session.user.role as Role;
  const rawScope = isTeacherRole(role)
    ? await getTeacherScope(session.user.tenantId, session.user.id, role)
  let teacherScope: { isRestricted: boolean; classeNiveaux: string[]; matiereNoms: string[] } | undefined;
  if (rawScope?.isRestricted) {
    // Mêmes bornes d'isolation que la liste des classes/matières de la modale :
    // le périmètre enseignant s'ajoute au filtre de site, il ne le remplace pas.
    const scopeClassesSiteFilter = siteFilterForModel("classe", examenClaims);
    const scopeMatieresSiteFilter = siteFilterForModel("matiere", examenClaims);
    const [scopeClasses, scopeMatieres] = await Promise.all([
      rawScope.classeIds.length > 0
        ? prisma.classe.findMany({
            where: {
              tenantId: session.user.tenantId,
              id: { in: rawScope.classeIds },
              ...scopeClassesSiteFilter,
            },
            select: { niveau: true },
            distinct: ["niveau"],
          })
        : [],
      rawScope.matiereIds.length > 0
        ? prisma.matiere.findMany({
            where: {
              tenantId: session.user.tenantId,
              id: { in: rawScope.matiereIds },
              ...scopeMatieresSiteFilter,
            },
            select: { nom: true },
          })
        : [],
    ]);
    teacherScope = {
      isRestricted: true,
      classeNiveaux: scopeClasses.map((c) => c.niveau).filter(Boolean),
      matiereNoms: scopeMatieres.map((m) => m.nom),
    };
  }
  const { examens, classes, matieres } = await getExamensData(
    session.user.tenantId,
    examenClaims,
    teacherScope
  );

  const currentSiteName = activeSite === "all"
    ? tCommon("allSites")
    : (sites.find((s) => s.id === activeSite)?.nom ?? "Site inconnu");
  const currentSiteColor = activeSite === "all" ? undefined : siteColors[activeSite];

  const classOptions = classes.map((c) => ({
    id: c.id,
    nom: c.nom,
    niveau: c.niveau,
    siteId: c.siteId,
    siteNom: c.site?.nom ?? null,
  }));

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <Header
        title="Examens & Délibérations"
        subtitle="Programmation, convocations, résultats et délibérations"
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
        <ExamensManager
          examens={examens}
          classes={classOptions}
          matieres={matieres}
          siteColors={siteColors}
          tenantId={session.user.tenantId}
        />
      </div>
    </div>
  );
}
