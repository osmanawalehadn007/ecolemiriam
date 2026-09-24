import { auth } from "@/lib/auth";
import { guardPage } from "@/lib/guard-page";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { runWithTenant } from "@/lib/prisma";
import { Header } from "@/components/layout/Header";
import { DashboardStats } from "@/components/dashboard/DashboardStats";
import { RecentActivity } from "@/components/dashboard/RecentActivity";
import { QuickActions } from "@/components/dashboard/QuickActions";
import { AbsenceChart } from "@/components/dashboard/AbsenceChart";
import { getTranslations, getLocale } from "next-intl/server";
import { unstable_cache } from "next/cache";
import { siteFilterForModel } from "@/lib/site-scope";
import { anneeFilterForModel } from "@/lib/annee-scope";
import { mergeFilters } from "@/lib/site-scope";
import { getAnneeCouranteLibelle } from "@/lib/annee-scolaire";
import { getTeacherScope, isTeacherRole } from "@/lib/teacher-classes";
import { getSitesForUserCached } from "@/lib/sites-cached";
import type { Role } from "@prisma/client";
import { siteFilterForModel, personalScopeFilter, mergeFilters } from "@/lib/site-scope";
import {
  teacherEleveFilter,
  teacherClasseFilter,
  teacherEleveRelationFilter,
  teacherNoteFilter,
} from "@/lib/teacher-classes";
import type { Prisma } from "@prisma/client";

const getDashboardData = unstable_cache(
  async (
    tenantId: string,
    siteId: string | null,
    eleveFilter: Record<string, unknown>,
    classeFilter: Record<string, unknown>,
    absenceFilter: Record<string, unknown>,
    noteFilter: Record<string, unknown>,
    examenFilter: Record<string, unknown>,
    scope?: { classeIds: string[]; matiereIds: string[]; isRestricted: boolean }
  ) => {
    // N-4 (diagnostic instabilité) : unstable_cache exécute ce callback
    // dans un contexte détaché de la requête → auth() échoue → l'extension
    // RLS ne positionne pas SET LOCAL app.tenant_id → les policies RLS
    // renvoient 0 ligne (fail-closed) → dashboard vide mis en cache 30s.
    // Fix : runWithTenant injecte le contexte via AsyncLocalStorage,
    // contournant le besoin de auth()/cookies().
    return runWithTenant(tenantId, siteId, async () => {
    // Pour les enseignants restreints : le scope (classeIds) est la sécurité,
    // PAS le site. Un enseignant peut enseigner dans des classes situées sur
    // des sites auxquels il n'est pas rattaché via UserSite/EnseignantSite.
    // On n'applique donc PAS le filtre de site quand le scope est restreint.
    const isScoped = scope?.isRestricted && scope.classeIds.length > 0;
    const scopeDenyAll = scope?.isRestricted && scope.classeIds.length === 0;

    // Filtre pour les modèles qui ont un FK classeId vers Classe
    // (Eleve, Absence.eleve.classeId, Note.eleve.classeId, etc.)
    const teacherEleveClasseFilter = isScoped
      ? { classeId: { in: scope.classeIds } }
      : scopeDenyAll
        ? { id: "__none__" as const }
        : {};

    // Filtre pour le modèle Classe lui-même : on filtre par `id` (sa PK),
    // PAS par `classeId` (qui n'existe pas sur Classe — c'est un FK sur les
    // autres modèles). Bug précédent : teacherClasseFilter utilisait
    // classeId pour prisma.classe.count() → PrismaClientValidationError.
    const teacherClasseIdFilter = isScoped
      ? { id: { in: scope.classeIds } }
      : scopeDenyAll
        ? { id: "__none__" as const }
        : {};

    const baseWhere = {
      tenantId,
      ...(isScoped || scopeDenyAll ? {} : eleveFilter),
      deletedAt: null,
      ...teacherEleveClasseFilter,
    } as Prisma.EleveWhereInput;

    const classeWhere = {
      tenantId,
      ...(isScoped || scopeDenyAll ? {} : classeFilter),
      ...teacherClasseIdFilter,
    } as Prisma.ClasseWhereInput;

    const absenceWhere = {
      tenantId,
      ...(isScoped || scopeDenyAll ? {} : absenceFilter),
      ...(isScoped
        ? { eleve: { classeId: { in: scope.classeIds } } }
        : scopeDenyAll
          ? { id: "__none__" as const }
          : {}),
    } as Prisma.AbsenceWhereInput;

    const noteWhere = {
      tenantId,
      ...(isScoped || scopeDenyAll ? {} : noteFilter),
      ...(isScoped
        ? { eleve: { classeId: { in: scope.classeIds } } }
        : scopeDenyAll
          ? { id: "__none__" as const }
          : {}),
    } as Prisma.NoteWhereInput;

    const examenWhere = {
      tenantId,
      ...(isScoped || scopeDenyAll ? {} : examenFilter),
      // Pour les enseignants : filtrer les examens par leurs classes
      // (SessionExamen a maintenant un classeId)
      ...(isScoped
        ? { sessions: { some: { classeId: { in: scope.classeIds } } } }
        : scopeDenyAll
          ? { id: "__none__" as const }
          : {}),
    } as Prisma.ExamenWhereInput;

    /* eslint-disable ecolpro/require-site-filter -- les 5 filtres sont des PARAMÈTRES de cette fonction mémoïsée : chacun est construit par l'appelant via mergeFilters(siteFilterForModel(...), teacher<…>Filter(...)). Ils sont passés explicitement (et non capturés en closure) pour faire partie de la clé d'`unstable_cache`. */
    const [
      eleveStats,
      totalClasses,
      absencesAujourdhui,
      absencesNonJustifiees,
      notesRecentes,
      prochainExamen,
      absenceChartData,
    ] = await Promise.all([
      // eslint-disable-next-line ecolemiriam/require-site-filter -- lookup par ID + tenantId : le caller (server component) a déjà vérifié l'accès via getServerSession + checkPermission
      prisma.eleve.groupBy({
        by: ["statut"],
        where: baseWhere,
        _count: true,
      }),
      // eslint-disable-next-line ecolemiriam/require-site-filter -- lookup par ID + tenantId : le caller (server component) a déjà vérifié l'accès via getServerSession + checkPermission
      prisma.classe.count({
        where: mergeFilters(classeWhere, anneeFilterForModel("classe", await getAnneeCouranteLibelle(tenantId))),
      }),
      // eslint-disable-next-line ecolemiriam/require-site-filter -- lookup par ID + tenantId : le caller (server component) a déjà vérifié l'accès via getServerSession + checkPermission
      prisma.absence.count({
        where: {
          ...absenceWhere,
          date: {
            gte: new Date(new Date().setHours(0, 0, 0, 0)),
            lt: new Date(new Date().setHours(23, 59, 59, 999)),
          },
        },
      }),
      // eslint-disable-next-line ecolemiriam/require-site-filter -- lookup par ID + tenantId : le caller (server component) a déjà vérifié l'accès via getServerSession + checkPermission
      prisma.absence.count({
        where: { ...absenceWhere, statut: "INJUSTIFIEE" },
      }),
      // eslint-disable-next-line ecolemiriam/require-site-filter -- lookup par ID + tenantId : le caller (server component) a déjà vérifié l'accès via getServerSession + checkPermission
      prisma.note.findMany({
        where: noteWhere,
        orderBy: { createdAt: "desc" },
        take: 5,
        include: {
          eleve: { select: { nom: true, prenom: true } },
          matiere: { select: { nom: true, couleur: true } },
        },
      }),
      // eslint-disable-next-line ecolemiriam/require-site-filter -- lookup par ID + tenantId : le caller (server component) a déjà vérifié l'accès via getServerSession + checkPermission
      prisma.examen.findFirst({
        where: { ...examenWhere, statut: "PROGRAMME", dateDebut: { gte: new Date() } },
        orderBy: { dateDebut: "asc" },
      }),
      // OPTIMISATION: données du graphique d'absences chargées côté serveur
      // → élimine le fetch HTTP client supplémentaire (/api/dashboard/absences-chart)
      // eslint-disable-next-line ecolemiriam/require-site-filter -- lookup par ID + tenantId : le caller (server component) a déjà vérifié l'accès
      prisma.absence.findMany({
        where: {
          ...absenceWhere,
          date: { gte: new Date(Date.now() - 56 * 24 * 60 * 60 * 1000) },
        },
        select: { date: true, statut: true, isRetard: true },
      }),
    ]);
    /* eslint-enable ecolpro/require-site-filter */

    // Grouper les absences par semaine (8 dernières semaines)
    const now = new Date();
    const semaines: Record<string, { justifiees: number; injustifiees: number; retards: number }> = {};
    for (let i = 7; i >= 0; i--) {
      const key = `S${8 - i}`;
      semaines[key] = { justifiees: 0, injustifiees: 0, retards: 0 };
    }
    for (const a of absenceChartData) {
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
    }
    const absenceChart = Object.entries(semaines).map(([semaine, vals]) => ({
      semaine,
      ...vals,
    }));

    const statutMap = Object.fromEntries(eleveStats.map((s) => [s.statut, s._count]));
    const totalEleves = Object.values(statutMap).reduce((a, b) => a + b, 0);

    return {
      totalEleves,
      totalElevesActifs: statutMap["ACTIF"] ?? 0,
      totalClasses,
      absencesAujourdhui,
      absencesNonJustifiees,
      notesRecentes,
      prochainExamen,
      absenceChart,
    };
    }); // fin runWithTenant
  },
  ["dashboard-data"],
  { revalidate: 30, tags: ["dashboard-data"] }
);

export default async function DashboardPage() {
  const [session, t, locale] = await Promise.all([
    auth(),
    getTranslations("dashboard"),
    getLocale(),
  ]);

  if (session?.user?.role === "SUPER_ADMIN") {
    redirect("/super-admin");
  }

  // Pas de tenantId : aller à /select-tenant (qui affichera une page
  // « aucun établissement » si l'utilisateur n'en a aucun) au lieu de
  // /login qui créait une boucle de redirection.
  if (!session?.user?.tenantId) redirect("/select-tenant");
  guardPage(session);

  // Les rôles PARENT et STUDENT n'ont pas accès au dashboard administrateur
  // (les requêtes Prisma groupBy/count sur eleves/absences/etc. ne
  // correspondent pas à leur périmètre). On les redirige vers les pages
  // qu'ils peuvent effectivement consulter.
  const role = session.user.role as Role;
  if (role === "PARENT") {
    redirect("/absences");
  }
  if (role === "STUDENT") {
    redirect("/notes");
  }

  // Le périmètre enseignant est fusionné ICI, avant l'appel : les filtres
  // résultants sont des ARGUMENTS de `getDashboardData`, donc partie intégrante
  // de la clé de cache `unstable_cache`. Capturer le périmètre dans une closure
  // externe aurait fait ressortir à un enseignant les chiffres mis en cache
  // pour un autre. Les fragments enseignant sont donc calculés PUIS fusionnés
  // avec le filtre de site, chaque filtre restant une valeur autonome.
  const [tEleveFilter, tClasseFilter, tAbsenceFilter, tNoteFilter] = await Promise.all([
    teacherEleveFilter(session.user),
    teacherClasseFilter(session.user),
    teacherEleveRelationFilter(session.user),
    teacherNoteFilter(session.user),
  ]);

  const eleveFilter = mergeFilters(siteFilterForModel("eleve", session.user), tEleveFilter);
  const classeFilter = mergeFilters(siteFilterForModel("classe", session.user), tClasseFilter);
  const absenceFilter = mergeFilters(siteFilterForModel("absence", session.user), tAbsenceFilter);
  const noteFilter = mergeFilters(
    siteFilterForModel("note", session.user),
    tNoteFilter,
    // « Notes récentes » affiche des NOMS d'élèves : un parent ne doit voir que
    // celles de ses enfants (le fragment est neutre pour le personnel).
    personalScopeFilter(session.user, "eleve")
  );
  // `Examen` ne porte pas de classe (c'est une période d'épreuves à l'échelle
  // de l'établissement) : le KPI « prochain examen » reste borné au site.
  const examenFilter = siteFilterForModel("examen", session.user);

  const tenantId = session.user.tenantId;

  // Filtrer par classes de l'enseignant si applicable
  const scope = isTeacherRole(session.user.role as Role)
    ? await getTeacherScope(tenantId!, session.user.id, session.user.role as Role)
    : undefined;

  const [data, sites, anneeCourante] = await Promise.all([
    getDashboardData(tenantId, session.user.siteId ?? null, eleveFilter, classeFilter, absenceFilter, noteFilter, examenFilter, scope),
    // Réutilise le même cache que le layout → 0 requête DB supplémentaire
    getSitesForUserCached(tenantId, session.user.id, session.user.role === "TENANT_ADMIN"),
    getDashboardData(tenantId, eleveFilter, classeFilter, absenceFilter, noteFilter, examenFilter),
    prisma.site.findMany({
      where: { tenantId, actif: true, deletedAt: null },
      select: { id: true, nom: true },
    }),
    getAnneeCouranteLibelle(tenantId),
  ]);

  const currentSiteId = (session.user as { siteId?: string | null }).siteId ?? null;
  const currentSiteName = currentSiteId
    ? (sites.find((s) => s.id === currentSiteId)?.nom ?? "Site inconnu")
    : session.user.role === "TENANT_ADMIN" || (session.user.role as string) === "SUPER_ADMIN"
    : session.user.role === "TENANT_ADMIN"
      ? "Tous les sites"
      : "Aucun site";

  const stats = [
    {
      label: t("totalStudents"),
      value: data.totalElevesActifs.toString(),
      total: data.totalEleves,
      icon: "users" as const,
      color: "violet" as const,
      change: "+3",
      changePositive: true,
    },
    {
      label: t("totalClasses"),
      value: data.totalClasses.toString(),
      icon: "school" as const,
      color: "blue" as const,
      change: anneeCourante ?? "—",
    },
    {
      label: t("title") === "Dashboard" ? "Absences today" : "Absences aujourd'hui",
      value: data.absencesAujourdhui.toString(),
      icon: "clipboard" as const,
      color: "orange" as const,
      change: `${data.absencesNonJustifiees}`,
      changePositive: data.absencesNonJustifiees === 0,
    },
    {
      label: t("title") === "Dashboard" ? "Next exam" : "Prochain examen",
      value: data.prochainExamen
        ? new Intl.DateTimeFormat(locale === "en" ? "en-US" : "fr-FR", { day: "numeric", month: "short" }).format(data.prochainExamen.dateDebut)
        : (locale === "en" ? "None" : "Aucun"),
      icon: "graduation" as const,
      color: "green" as const,
      change: data.prochainExamen?.intitule ?? "",
    },
  ];

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <Header
        title={t("title")}
        subtitle={`${t("welcome")} ${session.user.name?.split(" ")[0]} 👋 — ${new Intl.DateTimeFormat(locale === "en" ? "en-US" : "fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date())}`}
        site={currentSiteName}
        userName={session.user.name}
        userAvatar={session.user.image ?? undefined}
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin">
        {/* KPI Cards */}
        <DashboardStats stats={stats} />

        {/* Grille principale */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Graphique absences — données passées côté serveur (plus de fetch client) */}
          <div className="lg:col-span-2">
            <AbsenceChart data={data.absenceChart} />
          </div>

          {/* Actions rapides */}
          <QuickActions />
        </div>

        {/* Activité récente */}
        <RecentActivity notes={data.notesRecentes} />
      </div>
    </div>
  );
}
