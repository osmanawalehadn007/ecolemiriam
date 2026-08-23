import { auth } from "@/lib/auth";
import { guardPage } from "@/lib/guard-page";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { Header } from "@/components/layout/Header";
import { FinanceView } from "@/components/finances/FinanceView";
import { SiteTabs } from "@/components/sites/SiteTabs";
import { getTranslations } from "next-intl/server";
import { siteFilterForModel, type SessionSiteClaims } from "@/lib/site-scope";
import { getSitesForUser } from "@/lib/actions/eleve";
import { getSiteColorMap } from "@/lib/site-colors";
import { getRemisesCaisse } from "@/lib/actions/finances";
import {
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  startOfYear,
  endOfYear,
} from "date-fns";

type Periode = "today" | "week" | "month" | "semester" | "year";

function getPeriodRange(periode: Periode) {
  const today = new Date();
  switch (periode) {
    case "today":
      return { start: startOfDay(today), end: endOfDay(today) };
    case "week":
      return { start: startOfWeek(today, { weekStartsOn: 1 }), end: endOfWeek(today, { weekStartsOn: 1 }) };
    case "month":
      return { start: startOfMonth(today), end: endOfMonth(today) };
    case "semester":
      if (today.getMonth() < 6) {
        return { start: startOfYear(today), end: new Date(today.getFullYear(), 5, 30, 23, 59, 59, 999) };
      }
      return {
        start: new Date(today.getFullYear(), 6, 1),
        end: endOfYear(today),
      };
    case "year":
    default:
      return { start: startOfYear(today), end: endOfYear(today) };
  }
}

async function getFinanceData(tenantId: string, claims: SessionSiteClaims, periode: Periode, activeSite: string) {
  const siteFilter = siteFilterForModel("facture", claims);
  const depenseFilter = siteFilterForModel("depense", claims);
  const budgetFilter = siteFilterForModel("budget", claims);
  const { start, end } = getPeriodRange(periode);

  const [
    totalAgg,
    paiements,
    totalFacturesAgg,
    cashPendingAgg,
    cashPending,
    totalDepensesAgg,
    depenses,
    budgets,
    remisesCaisse,
  ] = await Promise.all([
    // eslint-disable-next-line ecolemiriam/require-site-filter -- lookup par ID + tenantId : le caller (server component) a déjà vérifié l'accès via getServerSession + checkPermission
    prisma.paiement.aggregate({
      _sum: { montant: true },
      where: {
        date: { gte: start, lte: end },
        facture: { tenantId, ...siteFilter },
      },
    }),
    // eslint-disable-next-line ecolemiriam/require-site-filter -- lookup par ID + tenantId : le caller (server component) a déjà vérifié l'accès via getServerSession + checkPermission
    prisma.paiement.findMany({
      where: {
        date: { gte: start, lte: end },
        facture: { tenantId, ...siteFilter },
      },
      include: {
        facture: {
          select: {
            numero: true,
            site: { select: { nom: true } },
            eleve: { select: { nom: true, prenom: true } },
          },
        },
        enregistrePar: { select: { name: true } },
      },
      orderBy: { date: "desc" },
      take: 200,
    }),
    prisma.facture.aggregate({
      _sum: { montant: true },
      where: { tenantId, ...siteFilter },
    }),
    // eslint-disable-next-line ecolemiriam/require-site-filter -- lookup par ID + tenantId : le caller (server component) a déjà vérifié l'accès via getServerSession + checkPermission
    prisma.paiement.aggregate({
      _sum: { montant: true },
      where: {
        methode: "espèces",
        depotBanque: null,
        directorRecu: false,
        facture: { tenantId, ...siteFilter },
      },
    }),
    // eslint-disable-next-line ecolemiriam/require-site-filter -- lookup par ID + tenantId : le caller (server component) a déjà vérifié l'accès via getServerSession + checkPermission
    prisma.paiement.findMany({
      where: {
        methode: "espèces",
        depotBanque: null,
        directorRecu: false,
        facture: { tenantId, ...siteFilter },
      },
      include: {
        facture: {
          select: {
            numero: true,
            site: { select: { nom: true } },
            eleve: { select: { nom: true, prenom: true } },
          },
        },
        enregistrePar: { select: { name: true } },
      },
      orderBy: { date: "desc" },
      take: 100,
    }),
    prisma.depense.aggregate({
      _sum: { montant: true },
      where: { tenantId, ...depenseFilter, date: { gte: start, lte: end } },
    }),
    prisma.depense.findMany({
      where: { tenantId, ...depenseFilter, date: { gte: start, lte: end } },
      include: { createdBy: { select: { name: true } }, autorisePar: { select: { name: true } }, payePar: { select: { name: true } }, site: { select: { nom: true } } },
      orderBy: { date: "desc" },
      take: 100,
    }),
    prisma.budget.findMany({
      where: { tenantId, ...budgetFilter },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    getRemisesCaisse(activeSite === "all" ? null : activeSite),
  ]);

  return {
    totalEncaisse: totalAgg._sum.montant ?? 0,
    totalFactures: totalFacturesAgg._sum.montant ?? 0,
    totalRestant: (totalFacturesAgg._sum.montant ?? 0) - (totalAgg._sum.montant ?? 0),
    cashPendingTotal: cashPendingAgg._sum.montant ?? 0,
    cashPending,
    totalDepenses: totalDepensesAgg._sum.montant ?? 0,
    depenses,
    budgets,
    remisesCaisse,
    paiements,
    periode,
  };
}

export default async function FinancesPage({
  searchParams,
}: {
  searchParams: Promise<{ siteId?: string; periode?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.tenantId) redirect("/select-tenant");
  guardPage(session, "finance:read");

  const [t, tCommon, sites, siteColors, sp] = await Promise.all([
    getTranslations("finances"),
    getTranslations("common"),
    getSitesForUser(),
    getSiteColorMap(session.user.tenantId),
    searchParams,
  ]);

  const sessionSiteId = (session.user as { siteId?: string | null }).siteId ?? null;
  const { siteId, periode } = sp;

  const activeSite = (() => {
    if (!siteId) return sessionSiteId ? sessionSiteId : "all";
    if (siteId === "all") {
      if (sessionSiteId) return sessionSiteId;
      return session.user.role === "TENANT_ADMIN" || session.user.role === "SUPER_ADMIN" ? "all" : sessionSiteId ?? "all";
    }
    return sites.some((s) => s.id === siteId) ? siteId : (sessionSiteId ?? "all");
  })();

  const validPeriodes: Periode[] = ["today", "week", "month", "semester", "year"];
  const activePeriode = validPeriodes.includes(periode as Periode) ? (periode as Periode) : "month";

  const financeClaims: SessionSiteClaims = {
    role: session.user.role,
    siteId: activeSite === "all" ? null : activeSite,
    siteIds: (session.user as { siteIds?: string[] | null }).siteIds ?? null,
    tenantHasSites: (session.user as { tenantHasSites?: boolean }).tenantHasSites ?? false,
  };

  const { totalEncaisse, totalFactures, totalRestant, cashPendingTotal, cashPending, totalDepenses, depenses, budgets, remisesCaisse, paiements } = await getFinanceData(
    session.user.tenantId,
    financeClaims,
    activePeriode,
    activeSite
  );

  const currentSiteName = activeSite === "all"
    ? tCommon("allSites")
    : (sites.find((s) => s.id === activeSite)?.nom ?? "Site inconnu");
  const currentSiteColor = activeSite === "all" ? undefined : siteColors[activeSite];

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
        <FinanceView
          totalEncaisse={totalEncaisse}
          totalFactures={totalFactures}
          totalRestant={totalRestant}
          totalDepenses={totalDepenses}
          cashPendingTotal={cashPendingTotal}
          cashPending={cashPending}
          depenses={depenses}
          budgets={budgets}
          paiements={paiements}
          remisesCaisse={remisesCaisse}
          activeSite={activeSite}
          activePeriode={activePeriode}
          siteColors={siteColors}
          currentUser={session.user}
          currentSiteName={currentSiteName}
          sites={sites.map((s) => ({ id: s.id, nom: s.nom }))}
        />
      </div>
    </div>
  );
}
