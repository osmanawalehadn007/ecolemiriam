import { auth } from "@/lib/auth";
import { guardPage } from "@/lib/guard-page";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { runWithTenant, rlsBatch } from "@/lib/prisma";
import { Header } from "@/components/layout/Header";
import { FinanceView } from "@/components/finances/FinanceView";
import { SiteTabs } from "@/components/sites/SiteTabs";
import { getTranslations } from "next-intl/server";
import { siteFilterForModel, type SessionSiteClaims } from "@/lib/site-scope";
import { getSitesForUser } from "@/lib/actions/eleve";
import { getSiteColorMap } from "@/lib/site-colors";
import { getRemisesCaisse } from "@/lib/actions/finances";
import { PAYMENT_METHODS, type PaymentMethodType } from "@/lib/payment-methods";
import { unstable_cache } from "next/cache";
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

export type TriPaiements = "date" | "montant" | "methode";

/**
 * Filtre « moyen de paiement » : soit un moyen précis (waffi, saba_pay…), soit
 * une famille entière (CASH, MOBILE_MONEY, BANK, CARD). Renvoie la liste des
 * identifiants de moyens retenus, ou null pour ne rien filtrer.
 */
function methodesPourFiltre(filtre: string | null): string[] | null {
  if (!filtre) return null;
  const parType = PAYMENT_METHODS.filter((m) => m.type === (filtre as PaymentMethodType)).map((m) => m.id);
  if (parType.length > 0) return parType;
  return PAYMENT_METHODS.some((m) => m.id === filtre) ? [filtre] : null;
}

type Periode = "today" | "week" | "month" | "semester" | "year";
export type FinanceType = "all" | "recettes" | "depenses" | "factures";

/** Plage pour une période relative (aujourd'hui, cette semaine, etc.) */
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

/** Plage pour un mois spécifique (format "YYYY-MM") */
function getMonthRange(monthParam: string) {
  const [yearStr, monthStr] = monthParam.split("-");
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10) - 1; // 0-indexed
  if (isNaN(year) || isNaN(month) || month < 0 || month > 11) return null;
  return {
    start: new Date(year, month, 1, 0, 0, 0, 0),
    end: endOfMonth(new Date(year, month, 1)),
  };
}

/** Plage pour un jour précis (format "YYYY-MM-DD") ; null si la date n'existe pas. */
function getDayRange(jourParam: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(jourParam)) return null;
  const [y, m, d] = jourParam.split("-").map((n) => parseInt(n, 10));
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return { start: startOfDay(date), end: endOfDay(date) };
}

/** Moyens de paiement en espèces (type CASH dans PAYMENT_METHODS). */
const METHODES_ESPECES = PAYMENT_METHODS.filter((m) => m.type === "CASH").map((m) => m.id);

// Cache des données financières — la clé inclut tenantId, siteId, periode,
// month et activeSite pour que chaque combinaison ait son propre cache.
// Avant: 14.2s ; avec cache: ~2s (hit suivant).
const getFinanceDataCached = unstable_cache(
  async (
    tenantId: string,
    siteId: string | null,
    role: string,
    siteIdsJson: string,
    tenantHasSites: boolean,
    periode: Periode,
    activeSite: string,
    monthParam: string | null,
    jourParam: string | null,
    methodeFiltre: string | null,
    tri: TriPaiements,
  ) => {
    const claims: SessionSiteClaims = {
      role: role as SessionSiteClaims["role"],
      siteId: activeSite === "all" ? null : activeSite,
      siteIds: siteIdsJson ? JSON.parse(siteIdsJson) : null,
      tenantHasSites,
    };

    const monthRange = monthParam ? getMonthRange(monthParam) : null;
    const dayRange = jourParam ? getDayRange(jourParam) : null;

    return runWithTenant(tenantId, siteId, async () => {
      const siteFilter = siteFilterForModel("facture", claims);
      const depenseFilter = siteFilterForModel("depense", claims);
      const budgetFilter = siteFilterForModel("budget", claims);

      // Priorité : jour précis > mois précis > période relative
      const { start, end } = dayRange ?? monthRange ?? getPeriodRange(periode);

      // Une seule transaction RLS pour les 13 requêtes (au lieu d'une par
      // requête) ; `getRemisesCaisse` a ses propres requêtes et part en parallèle.
      const [[factureDates, paiementDates, depenseDates, totalAgg, paiementsParMethodeAgg, totalFacturesAgg, cashPendingAgg, cashPending, totalDepensesAgg, depenses, budgets, facturesPeriode, paiementsListe], remisesCaisse, paiementsJour] = await Promise.all([
        rlsBatch((db) => [
        // Mois disponibles
        db.facture.findMany({
          where: { tenantId, ...siteFilter },
          select: { createdAt: true },
          orderBy: { createdAt: "desc" },
          take: 500,
        }),
        // eslint-disable-next-line ecolemiriam/require-site-filter -- lookup par ID + tenantId
        db.paiement.findMany({
          where: { facture: { tenantId, ...siteFilter } },
          select: { date: true },
          orderBy: { date: "desc" },
          take: 500,
        }),
        db.depense.findMany({
          where: { tenantId, ...depenseFilter },
          select: { date: true },
          orderBy: { date: "desc" },
          take: 500,
        }),
        // eslint-disable-next-line ecolemiriam/require-site-filter -- lookup par ID + tenantId
        db.paiement.aggregate({
          _sum: { montant: true },
          where: { date: { gte: start, lte: end }, facture: { tenantId, ...siteFilter } },
        }),
        // Montants perçus par moyen de paiement : un agrégat exact, là où la liste
        // des paiements était tronquée à 200 lignes.
        // eslint-disable-next-line ecolemiriam/require-site-filter -- lookup par ID + tenantId
        db.paiement.groupBy({
          by: ["methode", "devise"],
          _sum: { montant: true },
          _count: { _all: true },
          where: { date: { gte: start, lte: end }, facture: { tenantId, ...siteFilter } },
        }),
        db.facture.aggregate({
          _sum: { montant: true },
          where: { tenantId, ...siteFilter, createdAt: { gte: start, lte: end } },
        }),
        // eslint-disable-next-line ecolemiriam/require-site-filter -- lookup par ID + tenantId
        db.paiement.aggregate({
          _sum: { montant: true },
          where: { methode: "espèces", depotBanque: null, directorRecu: false, date: { gte: start, lte: end }, facture: { tenantId, ...siteFilter } },
        }),
        // eslint-disable-next-line ecolemiriam/require-site-filter -- lookup par ID + tenantId
        db.paiement.findMany({
          where: { methode: "espèces", depotBanque: null, directorRecu: false, date: { gte: start, lte: end }, facture: { tenantId, ...siteFilter } },
          include: {
            facture: { select: { numero: true, site: { select: { nom: true } }, eleve: { select: { nom: true, prenom: true, classe: { select: { nom: true } } } } } },
            enregistrePar: { select: { name: true } },
          },
          orderBy: { date: "desc" },
          take: 100,
        }),
        db.depense.aggregate({
          _sum: { montant: true },
          where: { tenantId, ...depenseFilter, date: { gte: start, lte: end } },
        }),
        db.depense.findMany({
          where: { tenantId, ...depenseFilter, date: { gte: start, lte: end } },
          include: { createdBy: { select: { name: true } }, autorisePar: { select: { name: true } }, payePar: { select: { name: true } }, site: { select: { nom: true } } },
          orderBy: { date: "desc" },
          take: 100,
        }),
        db.budget.findMany({
          where: { tenantId, ...budgetFilter },
          orderBy: { createdAt: "desc" },
          take: 100,
        }),
        // Factures émises : on ne garde que les impayées et celles réglées au
        // moins en partie en espèces ; celles payées uniquement par Waafi,
        // CAC Pay, virement ou carte sont exclues de la page Finances.
        db.facture.findMany({
          where: {
            tenantId,
            ...siteFilter,
            createdAt: { gte: start, lte: end },
            OR: [
              { paiements: { none: {} } },
              { paiements: { some: { methode: { in: METHODES_ESPECES } } } },
            ],
          },
          include: {
            eleve: { select: { nom: true, prenom: true, matricule: true, classe: { select: { nom: true } } } },
            site: { select: { nom: true } },
            // eslint-disable-next-line ecolemiriam/require-site-filter -- include filtré par le where parent
            paiements: { select: { montant: true } },
          },
          orderBy: { createdAt: "desc" },
          take: 200,
        }),
        // Paiements encaissés sur la période, filtrables par moyen de paiement.
        // Les totaux par moyen viennent de l'agrégat exact (`groupBy`) : cette
        // liste est tronquée à 200 lignes.
        // eslint-disable-next-line ecolemiriam/require-site-filter -- lookup par ID + tenantId
        db.paiement.findMany({
          where: {
            date: { gte: start, lte: end },
            ...(methodesPourFiltre(methodeFiltre) ? { methode: { in: methodesPourFiltre(methodeFiltre)! } } : {}),
            facture: { tenantId, ...siteFilter },
          },
          include: {
            facture: { select: { numero: true, site: { select: { nom: true } }, eleve: { select: { nom: true, prenom: true, classe: { select: { nom: true } } } } } },
            enregistrePar: { select: { name: true } },
          },
          orderBy:
            tri === "montant"
              ? [{ montant: "desc" }, { date: "desc" }]
              : tri === "methode"
                ? [{ methode: "asc" }, { date: "desc" }]
                : [{ date: "desc" }],
          take: 200,
        }),
        ]),
        getRemisesCaisse(activeSite === "all" ? null : activeSite),
        // Vue « jour précis » : tous les encaissements du jour, SANS le filtre de
        // moyen de paiement, pour que les soldes matin / après-midi restent exacts.
        dayRange
          ? rlsBatch((db) => [
              // eslint-disable-next-line ecolemiriam/require-site-filter -- lookup par ID + tenantId
              db.paiement.findMany({
                where: { date: { gte: start, lte: end }, facture: { tenantId, ...siteFilter } },
                include: {
                  facture: { select: { numero: true, site: { select: { nom: true } }, eleve: { select: { nom: true, prenom: true, classe: { select: { nom: true } } } } } },
                  enregistrePar: { select: { name: true } },
                },
                orderBy: { date: "asc" },
                take: 500,
              }),
            ]).then(([rows]) => rows)
          : Promise.resolve(null),
      ]);

      const months = new Set<string>();
      for (const f of factureDates) {
        const d = new Date(f.createdAt);
        months.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
      }
      for (const p of paiementDates) {
        const d = new Date(p.date);
        months.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
      }
      for (const d of depenseDates) {
        const dt = new Date(d.date);
        months.add(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`);
      }
      const now = new Date();
      months.add(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
      const availableMonths = Array.from(months).sort((a, b) => b.localeCompare(a));

      return {
        availableMonths,
        totalEncaisse: totalAgg._sum.montant ?? 0,
        totalFactures: totalFacturesAgg._sum.montant ?? 0,
        // Deux restes distincts, à ne pas fusionner : ce que les familles
        // doivent encore, et ce qu'il reste de l'argent reçu après dépenses.
        resteAEncaisser: (totalFacturesAgg._sum.montant ?? 0) - (totalAgg._sum.montant ?? 0),
        soldeCaisse: (totalAgg._sum.montant ?? 0) - (totalDepensesAgg._sum.montant ?? 0),
        cashPendingTotal: cashPendingAgg._sum.montant ?? 0,
        cashPending,
        totalDepenses: totalDepensesAgg._sum.montant ?? 0,
        depenses,
        budgets,
        remisesCaisse,
        recettesParMethode: paiementsParMethodeAgg.map((g) => ({
          methode: g.methode,
          devise: g.devise,
          montant: g._sum.montant ?? 0,
          nombre: g._count._all,
        })),
        facturesPeriode,
        paiementsListe,
        paiementsJour,
      };
    });
  },
  ["finances-data-v8"],
  { revalidate: 30, tags: ["finances-data"] }
);

export default async function FinancesPage(
  props: {
    searchParams: Promise<{ siteId?: string; periode?: string; month?: string; type?: string; methode?: string; tri?: string; jour?: string }>;
  }
) {
  const searchParams = await props.searchParams;
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
  const { siteId, periode, month, type, methode, tri, jour } = sp;

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

  // Mode "mois spécifique" : si month=YYYY-MM est fourni, il override la période
  const monthRange = month ? getMonthRange(month) : null;
  const activeMonth: string | null = monthRange ? (month ?? null) : null;

  // Mode « jour précis » : jour=YYYY-MM-DD l'emporte sur le mois et la période
  const activeJour: string | null = jour && getDayRange(jour) ? jour : null;

  // Filtre par type
  const validTypes: FinanceType[] = ["all", "recettes", "depenses", "factures"];
  const activeType: FinanceType = validTypes.includes(type as FinanceType) ? (type as FinanceType) : "all";

  // Filtre par moyen de paiement et tri de la liste (valeurs inconnues ignorées)
  const activeMethode = methode && methodesPourFiltre(methode) ? methode : null;
  const activeTri: TriPaiements = tri === "montant" || tri === "methode" ? tri : "date";

  const siteIdsJson = JSON.stringify((session.user as { siteIds?: string[] | null }).siteIds ?? null);
  const tenantHasSites = (session.user as { tenantHasSites?: boolean }).tenantHasSites ?? false;

  // Récupérer les données financières (cache inclut tous les paramètres)
  const cached = await getFinanceDataCached(
    session.user.tenantId,
    session.user.siteId ?? null,
    session.user.role,
    siteIdsJson,
    tenantHasSites,
    activePeriode,
    activeSite,
    activeMonth,
    activeJour,
    activeMethode,
    activeTri,
  );

  const { availableMonths, totalEncaisse, totalFactures, resteAEncaisser, soldeCaisse, cashPendingTotal, cashPending, totalDepenses, depenses, budgets, remisesCaisse, recettesParMethode, facturesPeriode, paiementsListe, paiementsJour } = cached;

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
          resteAEncaisser={resteAEncaisser}
          soldeCaisse={soldeCaisse}
          totalDepenses={totalDepenses}
          cashPendingTotal={cashPendingTotal}
          cashPending={cashPending}
          depenses={depenses}
          budgets={budgets}
          recettesParMethode={recettesParMethode}
          facturesPeriode={facturesPeriode}
          paiementsListe={paiementsListe}
          paiementsJour={paiementsJour}
          activeMethode={activeMethode}
          activeTri={activeTri}
          remisesCaisse={remisesCaisse}
          activeSite={activeSite}
          activePeriode={activePeriode}
          activeMonth={activeMonth}
          activeJour={activeJour}
          activeType={activeType}
          availableMonths={availableMonths}
          siteColors={siteColors}
          currentUser={session.user}
          currentSiteName={currentSiteName}
          sites={sites.map((s) => ({ id: s.id, nom: s.nom }))}
        />
      </div>
    </div>
  );
}
