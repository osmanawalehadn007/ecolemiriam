import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { Header } from "@/components/layout/Header";
import { DashboardStats } from "@/components/dashboard/DashboardStats";
import { RecentActivity } from "@/components/dashboard/RecentActivity";
import { QuickActions } from "@/components/dashboard/QuickActions";
import { AbsenceChart } from "@/components/dashboard/AbsenceChart";
import { getTranslations, getLocale } from "next-intl/server";
import { unstable_cache } from "next/cache";
import { siteFilterForModel, personalScopeFilter, mergeFilters } from "@/lib/site-scope";
import {
  teacherEleveFilter,
  teacherClasseFilter,
  teacherEleveRelationFilter,
  teacherNoteFilter,
} from "@/lib/teacher-classes";
import { getAnneeCouranteLibelle } from "@/lib/annee-scolaire";
import { roleHasPermission } from "@/lib/rbac";
import { getImpayesStats } from "@/lib/factures/impayes";
import type { Prisma } from "@prisma/client";

const getDashboardData = unstable_cache(
  async (
    tenantId: string,
    eleveFilter: Record<string, unknown>,
    classeFilter: Record<string, unknown>,
    absenceFilter: Record<string, unknown>,
    noteFilter: Record<string, unknown>,
    examenFilter: Record<string, unknown>
  ) => {
    const baseWhere = { tenantId, ...eleveFilter, deletedAt: null } as Prisma.EleveWhereInput;
    const classeWhere = { tenantId, ...classeFilter } as Prisma.ClasseWhereInput;
    const absenceWhere = { tenantId, ...absenceFilter } as Prisma.AbsenceWhereInput;
    const noteWhere = { tenantId, ...noteFilter } as Prisma.NoteWhereInput;
    const examenWhere = { tenantId, ...examenFilter } as Prisma.ExamenWhereInput;

    /* eslint-disable ecolpro/require-site-filter -- les 5 filtres sont des PARAMÈTRES de cette fonction mémoïsée : chacun est construit par l'appelant via mergeFilters(siteFilterForModel(...), teacher<…>Filter(...)). Ils sont passés explicitement (et non capturés en closure) pour faire partie de la clé d'`unstable_cache`. */
    const [
      eleveStats,
      totalClasses,
      absencesAujourdhui,
      absencesNonJustifiees,
      notesRecentes,
      prochainExamen,
    ] = await Promise.all([
      prisma.eleve.groupBy({
        by: ["statut"],
        where: baseWhere,
        _count: true,
      }),
      prisma.classe.count({ where: classeWhere }),
      prisma.absence.count({
        where: {
          ...absenceWhere,
          date: {
            gte: new Date(new Date().setHours(0, 0, 0, 0)),
            lt: new Date(new Date().setHours(23, 59, 59, 999)),
          },
        },
      }),
      prisma.absence.count({
        where: { ...absenceWhere, statut: "INJUSTIFIEE" },
      }),
      prisma.note.findMany({
        where: noteWhere,
        orderBy: { createdAt: "desc" },
        take: 5,
        include: {
          eleve: { select: { nom: true, prenom: true } },
          matiere: { select: { nom: true, couleur: true } },
        },
      }),
      prisma.examen.findFirst({
        where: { ...examenWhere, statut: "PROGRAMME", dateDebut: { gte: new Date() } },
        orderBy: { dateDebut: "asc" },
      }),
    ]);
    /* eslint-enable ecolpro/require-site-filter */

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
    };
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

  if (!session?.user?.tenantId) redirect("/login");

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
  const [data, sites, anneeCourante] = await Promise.all([
    getDashboardData(tenantId, eleveFilter, classeFilter, absenceFilter, noteFilter, examenFilter),
    prisma.site.findMany({
      where: { tenantId, actif: true, deletedAt: null },
      select: { id: true, nom: true },
    }),
    getAnneeCouranteLibelle(tenantId),
  ]);

  // KPI « factures impayées » : la gestion financière n'a de sens que pour les
  // rôles disposant de `finance:read` (un enseignant ou un parent n'a pas à
  // voir les impayés de l'établissement).
  const canSeeFinance = roleHasPermission(session.user.role, "finance:read");
  const impayes = canSeeFinance
    ? await getImpayesStats({
        tenantId,
        factureWhere: siteFilterForModel("facture", session.user),
      })
    : null;

  const currentSiteId = (session.user as { siteId?: string | null }).siteId ?? null;
  const currentSiteName = currentSiteId
    ? (sites.find((s) => s.id === currentSiteId)?.nom ?? "Site inconnu")
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
    // KPI « gestion des impayés » : nombre de factures non encaissées et reste
    // à recouvrer. Absent pour les rôles sans `finance:read`.
    ...(impayes
      ? [
          {
            label: t("unpaidInvoices"),
            value: impayes.nbFactures.toString(),
            icon: "banknote" as const,
            color: (impayes.nbFactures > 0 ? "red" : "green") as "red" | "green",
            change:
              impayes.nbFactures > 0
                ? `${impayes.nbEleves} ${t("totalStudents").toLowerCase()} · ${new Intl.NumberFormat(
                    locale === "en" ? "en-US" : "fr-FR",
                    { maximumFractionDigits: 0 }
                  ).format(impayes.montantRestant)} ${impayes.devise}`
                : t("noUnpaid"),
            changePositive: impayes.nbFactures === 0,
          },
        ]
      : []),
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
          {/* Graphique absences */}
          <div className="lg:col-span-2">
            <AbsenceChart tenantId={session.user.tenantId} siteFilter={eleveFilter} />
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
