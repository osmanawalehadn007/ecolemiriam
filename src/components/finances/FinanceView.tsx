"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDate, formatDateHeure } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { CalendarDays, ChevronLeft, ChevronRight, TrendingUp, TrendingDown, FileText, LayoutGrid } from "lucide-react";
import type { SiteColor } from "@/lib/site-colors";
import { DepensesSection } from "./DepensesSection";
import { BudgetSection } from "./BudgetSection";
import { RemiseCaisseSection } from "./RemiseCaisseSection";
import { hasPermission } from "@/lib/client-permissions";
import { getPaymentMethodType, getPaymentMethodLabelKey, getPaymentMethodColor } from "@/lib/payment-methods";

type Periode = "today" | "week" | "month" | "semester" | "year";
type FinanceType = "all" | "recettes" | "depenses" | "factures";

const MOIS_NOMS = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];

function getMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-");
  const monthIdx = parseInt(month) - 1;
  if (monthIdx >= 0 && monthIdx < 12) {
    return `${MOIS_NOMS[monthIdx]} ${year}`;
  }
  return monthKey;
}

interface Paiement {
  id: string;
  montant: number;
  devise: string;
  methode: string;
  reference: string | null;
  date: string | Date;
  facture: {
    numero: string;
    site: { nom: string } | null;
    eleve: { nom: string; prenom: string | null } | null;
  };
  enregistrePar: { name: string | null } | null;
}

interface RecetteParMethode {
  methode: string;
  devise: string;
  montant: number;
  nombre: number;
}

interface FacturePeriode {
  id: string;
  numero: string;
  libelle: string;
  montant: number;
  devise: string;
  statut: string;
  createdAt: Date;
  eleve: {
    nom: string;
    prenom: string;
    matricule: string;
    classe: { nom: string } | null;
  } | null;
  site: { nom: string } | null;
  paiements: { montant: number }[];
}

interface Depense {
  id: string;
  categorie: string;
  description: string | null;
  fournisseur: string | null;
  montant: number;
  devise: string;
  date: string | Date;
  typeEngagement: string | null;
  autorisePar: { name: string | null } | null;
  payePar: { name: string | null } | null;
  createdBy: { name: string | null } | null;
  site: { nom: string } | null;
}

interface Budget {
  id: string;
  categorie: string;
  periode: string;
  montantPrevu: number;
}

interface RemiseCaisse {
  id: string;
  montantDeclare: number;
  dateDeclaration: string | Date;
  montantRecu: number | null;
  dateReception: string | Date | null;
  statut: string;
  caissier: { id: string; name: string | null };
  destinataire: { id: string; name: string | null } | null;
  recuPar: { id: string; name: string | null } | null;
  site: { nom: string } | null;
}

function formatCurrency(value: number, devise: string) {
  try {
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: devise,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${value.toLocaleString("fr-FR")} ${devise}`;
  }
}

function todayInputValue() {
  return new Date().toISOString().split("T")[0];
}

export function FinanceView({
  totalEncaisse,
  totalFactures,
  resteAEncaisser,
  soldeCaisse,
  totalDepenses,
  cashPendingTotal,
  cashPending,
  depenses,
  budgets,
  recettesParMethode,
  facturesPeriode,
  paiementsListe,
  activeMethode,
  activeTri,
  remisesCaisse,
  activeSite,
  activePeriode,
  activeMonth,
  activeJour,
  activeType,
  availableMonths,
  siteColors,
  currentSiteName,
  currentUser,
  sites,
}: {
  totalEncaisse: number;
  totalFactures: number;
  resteAEncaisser: number;
  soldeCaisse: number;
  totalDepenses: number;
  cashPendingTotal: number;
  cashPending: Paiement[];
  depenses: Depense[];
  budgets: Budget[];
  recettesParMethode: RecetteParMethode[];
  facturesPeriode: FacturePeriode[];
  paiementsListe: Paiement[];
  activeMethode: string | null;
  activeTri: "date" | "montant" | "methode";
  remisesCaisse: RemiseCaisse[];
  activeSite: string;
  activePeriode: Periode;
  activeMonth: string | null;
  activeJour: string | null;
  activeType: FinanceType;
  availableMonths: string[];
  siteColors: Record<string, SiteColor>;
  currentSiteName: string;
  currentUser: { id: string; name?: string | null; role: string };
  sites: { id: string; nom: string }[];
}) {
  const t = useTranslations("finances");
  const tCommon = useTranslations("common");
  const tMoyen = useTranslations("facturation"); // libellés des moyens de paiement
  const router = useRouter();
  const searchParams = useSearchParams();
  const canWriteFinance = hasPermission(currentUser.role, "finance:write");
  const currency = recettesParMethode[0]?.devise ?? facturesPeriode[0]?.devise ?? "DJF";
  const siteColor = activeSite === "all" ? undefined : siteColors[activeSite];

  const [depotId, setDepotId] = useState<string | null>(null);
  const [depotBanque, setDepotBanque] = useState("");
  const [depotDate, setDepotDate] = useState(todayInputValue());
  const [isPending, setIsPending] = useState(false);

  const periodes: { key: Periode; label: string }[] = [
    { key: "today", label: t("periodToday") },
    { key: "week", label: t("periodWeek") },
    { key: "month", label: t("periodMonth") },
    { key: "semester", label: t("periodSemester") },
    { key: "year", label: t("periodYear") },
  ];

  const typeFilters: { key: FinanceType; label: string; icon: React.ReactNode }[] = [
    { key: "all", label: t("typeAll"), icon: <LayoutGrid className="h-3.5 w-3.5" /> },
    { key: "recettes", label: t("typeRecettes"), icon: <TrendingUp className="h-3.5 w-3.5" /> },
    { key: "depenses", label: t("typeDepenses"), icon: <TrendingDown className="h-3.5 w-3.5" /> },
    { key: "factures", label: t("typeFactures"), icon: <FileText className="h-3.5 w-3.5" /> },
  ];

  function setPeriode(periode: Periode) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("periode", periode);
    params.delete("month");
    params.delete("jour");
    router.push(`/finances?${params.toString()}`);
  }

  function setJour(jour: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (jour) {
      params.set("jour", jour);
      params.delete("month");
      params.delete("periode");
    } else {
      params.delete("jour");
    }
    router.push(`/finances?${params.toString()}`);
  }

  function setMonth(monthKey: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("jour");
    if (monthKey) {
      params.set("month", monthKey);
      params.delete("periode");
    } else {
      params.delete("month");
    }
    router.push(`/finances?${params.toString()}`);
  }

  function setType(type: FinanceType) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("type", type);
    router.push(`/finances?${params.toString()}`);
  }

  function setMethode(valeur: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (valeur) params.set("methode", valeur);
    else params.delete("methode");
    router.push(`/finances?${params.toString()}`);
  }

  function setTri(tri: "date" | "montant" | "methode") {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tri", tri);
    router.push(`/finances?${params.toString()}`);
  }

  function navigateMonth(direction: "prev" | "next") {
    if (!activeMonth || availableMonths.length === 0) return;
    const idx = availableMonths.indexOf(activeMonth);
    if (idx === -1) return;
    const newIdx = direction === "prev" ? idx + 1 : idx - 1;
    if (newIdx >= 0 && newIdx < availableMonths.length) {
      setMonth(availableMonths[newIdx]);
    }
  }

  async function deposer() {
    if (!depotId || !depotBanque.trim()) return;
    setIsPending(true);
    try {
      const res = await fetch(`/api/finances/paiements/${depotId}/depot`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ banque: depotBanque.trim(), date: depotDate }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success(t("depositSaved"));
      setDepotId(null);
      setDepotBanque("");
      router.refresh();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setIsPending(false);
    }
  }

  async function recuperer(id: string) {
    if (!window.confirm(t("confirmRecover"))) return;
    try {
      const res = await fetch(`/api/finances/paiements/${id}/recuperer`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success(t("recoverSaved"));
      router.refresh();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  }

  const nombrePaiements = recettesParMethode.reduce((n, r) => n + r.nombre, 0);
  const recettesParType = (["CASH", "MOBILE_MONEY", "BANK", "CARD", "OTHER"] as const)
    .map((type) => {
      const lignes = recettesParMethode.filter((r) => (getPaymentMethodType(r.methode) ?? "OTHER") === type);
      return {
        type,
        montant: lignes.reduce((m, r) => m + r.montant, 0),
        nombre: lignes.reduce((n, r) => n + r.nombre, 0),
      };
    })
    .filter((r) => r.nombre > 0);

  // Détail par moyen précis (Waffi, Saba Pay…), toutes devises confondues.
  const recettesParMoyen = Array.from(
    recettesParMethode.reduce((acc, r) => {
      const cur = acc.get(r.methode) ?? { methode: r.methode, montant: 0, nombre: 0 };
      cur.montant += r.montant;
      cur.nombre += r.nombre;
      return acc.set(r.methode, cur);
    }, new Map<string, { methode: string; montant: number; nombre: number }>()).values(),
  ).sort((a, b) => b.montant - a.montant);
  const libelleMoyen = (id: string) => {
    const cle = getPaymentMethodLabelKey(id);
    return cle === "method" ? id : tMoyen(cle);
  };
  const moyenCorrespond = (id: string) =>
    !activeMethode || id === activeMethode || getPaymentMethodType(id) === activeMethode;
  const totalFiltre = recettesParMethode.filter((r) => moyenCorrespond(r.methode)).reduce((n, r) => ({ montant: n.montant + r.montant, nombre: n.nombre + r.nombre }), { montant: 0, nombre: 0 });

  const facturesPayees = facturesPeriode.filter((f) => f.statut === "PAYEE").length;
  const facturesEnAttente = facturesPeriode.filter((f) => f.statut === "EN_ATTENTE").length;
  const facturesEnRetard = facturesPeriode.filter((f) => f.statut === "EN_RETARD").length;

  type Stat = { label: string; value: number; color: string; siteColor?: SiteColor };
  const statFacture: Stat = { label: t("totalInvoiced"), value: totalFactures, color: "text-blue-600" };
  const statEncaisse: Stat = { label: t("totalCollected"), value: totalEncaisse, color: "text-green-600", siteColor };
  const statDepenses: Stat = { label: t("totalExpenses"), value: totalDepenses, color: "text-red-600" };
  // Reste à encaisser = facturé − encaissé. Négatif quand la période a
  // encaissé des factures plus anciennes : on l'affiche en positif sous un
  // autre libellé plutôt qu'un « reste » négatif.
  const statReste: Stat =
    resteAEncaisser >= 0
      ? { label: t("totalRemaining"), value: resteAEncaisser, color: "text-orange-600" }
      : { label: t("collectedExtra"), value: -resteAEncaisser, color: "text-green-600" };
  // Solde en caisse = encaissé − dépenses, affiché avec son signe.
  const statSolde: Stat = {
    label: t("cashBalance"),
    value: soldeCaisse,
    color: soldeCaisse >= 0 ? "text-green-600" : "text-red-600",
  };
  const stats = [statFacture, statEncaisse, statReste, statDepenses, statSolde];

  const exportHref = activeJour
    ? `/api/finances/export?siteId=${activeSite}&jour=${activeJour}&type=${activeType}`
    : activeMonth
    ? `/api/finances/export?siteId=${activeSite}&month=${activeMonth}&type=${activeType}`
    : `/api/finances/export?siteId=${activeSite}&periode=${activePeriode}&type=${activeType}`;

  const showAll = activeType === "all";
  const showRecettes = showAll || activeType === "recettes";
  const showDepenses = showAll || activeType === "depenses";
  const showFactures = showAll || activeType === "factures";

  const filteredStats =
    activeType === "recettes"
      ? [statEncaisse, statReste]
      : activeType === "depenses"
        ? [statDepenses, statSolde]
        : activeType === "factures"
          ? [statFacture, statReste]
          : stats;

  return (
    <div className="space-y-6">
      {/* ── Barre de filtres : période + export ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {periodes.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriode(p.key)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                activePeriode === p.key && !activeMonth && !activeJour
                  ? "bg-primary text-white"
                  : "bg-gray-100 dark:bg-gray-800 text-gray-600 hover:bg-gray-200 dark:hover:bg-gray-700"
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        <a
          href={exportHref}
          download
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-900 dark:text-emerald-200"
        >
          {t("exportExcel")}
        </a>
        {/* Rapport des impayés à ce jour : le PDF est généré puis téléchargé au clic. */}
        <a
          href={`/api/finances/impayes-pdf?siteId=${activeSite}`}
          download
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900 dark:text-red-200"
        >
          <FileText className="h-3.5 w-3.5" />
          {t("unpaidReportPdf")}
        </a>
      </div>

      {/* ── Sélecteur de mois spécifique ── */}
      <div className="flex flex-wrap items-center gap-3 p-3 rounded-lg border bg-muted/30">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <CalendarDays className="h-4 w-4" />
          {t("historyByMonth")}
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => navigateMonth("prev")}
            disabled={!activeMonth || availableMonths.indexOf(activeMonth) >= availableMonths.length - 1}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>

          <select
            className="flex h-8 rounded-md border border-input bg-background px-2 py-1 text-sm ring-offset-background"
            value={activeMonth ?? ""}
            onChange={(e) => setMonth(e.target.value || null)}
          >
            <option value="">{t("selectMonth")}</option>
            {availableMonths.map((m) => (
              <option key={m} value={m}>{getMonthLabel(m)}</option>
            ))}
          </select>

          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => navigateMonth("next")}
            disabled={!activeMonth || availableMonths.indexOf(activeMonth) <= 0}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex items-center gap-2 border-l pl-3">
          <label htmlFor="jour-precis" className="text-sm font-medium text-muted-foreground">{t("preciseDay")}</label>
          <Input
            id="jour-precis"
            type="date"
            className="h-8 w-40 text-sm"
            value={activeJour ?? ""}
            max={todayInputValue()}
            onChange={(e) => setJour(e.target.value || null)}
          />
          {activeJour && (
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setJour(null)}>
              {t("resetDay")}
            </Button>
          )}
        </div>

        {activeMonth && (
          <Badge variant="secondary" className="text-xs">
            {getMonthLabel(activeMonth)}
          </Badge>
        )}

        {activeMonth && (
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setMonth(null)}>
            {t("resetMonth")}
          </Button>
        )}
      </div>

      {/* ── Filtres par type ── */}
      <div className="flex flex-wrap gap-2">
        {typeFilters.map((f) => (
          <button
            key={f.key}
            onClick={() => setType(f.key)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all",
              activeType === f.key
                ? "border-primary bg-primary/10 text-primary"
                : "border-input bg-background hover:bg-muted/50"
            )}
          >
            {f.icon}
            {f.label}
          </button>
        ))}
      </div>

      {/* ── Stats cards (filtrées par type) ── */}
      {/* Les cinq cartes tiennent sur une seule ligne dès la tablette ; en dessous, deux colonnes. */}
      <div className={cn("grid", filteredStats.length === 1 ? "grid-cols-1 gap-4" : filteredStats.length === 2 ? "grid-cols-1 gap-4 sm:grid-cols-2" : "grid-cols-2 gap-2 md:grid-cols-5 xl:gap-4")}>
        {filteredStats.map((s) => (
          <Card
            key={s.label}
            className="border-l-4"
            style={{ borderLeftColor: s.siteColor?.base ?? "#6b7280" }}
          >
            <CardContent className={filteredStats.length > 2 ? "p-3 xl:p-4" : "p-4"}>
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className={cn("font-bold", filteredStats.length > 2 ? "text-base lg:text-lg xl:text-2xl" : "text-2xl", s.color)}>
                {formatCurrency(s.value, currency)}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {showAll && cashPendingTotal > 0 && (
        <Card className="border-l-4 border-l-red-500">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">{t("cashPending")}</p>
            <p className="text-2xl font-bold text-red-600">{formatCurrency(cashPendingTotal, currency)}</p>
            <p className="text-xs text-red-500/80 mt-1">{t("cashPendingHint")}</p>
          </CardContent>
        </Card>
      )}

      {/* ── Montants perçus : un indicateur, pas la liste des paiements ── */}
      {showRecettes && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-green-600" />
              {t("amountsReceivedForSite", { site: currentSiteName })}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {nombrePaiements === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">{t("noPayments")}</p>
            ) : (
              <div className="space-y-4">
                <div>
                  <p className="text-3xl font-bold text-green-600">{formatCurrency(totalEncaisse, currency)}</p>
                  <p className="text-xs text-muted-foreground">{t("paymentsCount", { count: nombrePaiements })}</p>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {recettesParType.map((r) => (
                    <button
                      key={r.type}
                      type="button"
                      onClick={() => setMethode(activeMethode === r.type ? null : r.type)}
                      className={cn(
                        "rounded-xl border bg-muted/30 px-3 py-2 text-left transition-colors hover:bg-muted/60",
                        activeMethode === r.type && "border-primary ring-1 ring-primary",
                      )}
                    >
                      <p className="text-xs text-muted-foreground">{t(`methodType_${r.type}`)}</p>
                      <p className="text-lg font-bold">{formatCurrency(r.montant, currency)}</p>
                      <p className="text-xs text-muted-foreground">{t("paymentsCount", { count: r.nombre })}</p>
                    </button>
                  ))}
                </div>

                {/* Détail par moyen précis, cliquable pour filtrer la liste */}
                <div>
                  <p className="mb-2 text-xs font-medium text-muted-foreground">{t("filterByMethod")}</p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setMethode(null)}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                        !activeMethode ? "bg-primary text-white border-primary" : "hover:bg-muted",
                      )}
                    >
                      {t("allMethods")} · {nombrePaiements}
                    </button>
                    {recettesParMoyen.map((m) => (
                      <button
                        key={m.methode}
                        type="button"
                        onClick={() => setMethode(activeMethode === m.methode ? null : m.methode)}
                        className={cn(
                          "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                          activeMethode === m.methode ? "bg-primary text-white border-primary" : "hover:bg-muted",
                        )}
                      >
                        {libelleMoyen(m.methode)} · {formatCurrency(m.montant, currency)} ({m.nombre})
                      </button>
                    ))}
                  </div>
                </div>

                {/* Liste des paiements, filtrée et triable */}
                <div>
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-medium text-muted-foreground">{t("sortBy")}</span>
                    {([["date", t("date")], ["montant", t("amount")], ["methode", t("method")]] as const).map(([cle, label]) => (
                      <button
                        key={cle}
                        type="button"
                        onClick={() => setTri(cle)}
                        className={cn(
                          "rounded-md px-2 py-1 font-medium transition-colors",
                          activeTri === cle ? "bg-primary text-white" : "bg-muted hover:bg-muted/70",
                        )}
                      >
                        {label}
                      </button>
                    ))}
                    <span className="ml-auto text-muted-foreground">
                      {formatCurrency(totalFiltre.montant, currency)} · {t("paymentsCount", { count: totalFiltre.nombre })}
                      {paiementsListe.length < totalFiltre.nombre && ` — ${t("paymentsShown", { shown: paiementsListe.length, total: totalFiltre.nombre })}`}
                    </span>
                  </div>
                  <div className="overflow-x-auto rounded-lg border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 text-xs text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium">{t("date")}</th>
                          <th className="px-3 py-2 text-left font-medium">{t("student")}</th>
                          <th className="px-3 py-2 text-left font-medium">{t("invoice")}</th>
                          <th className="px-3 py-2 text-left font-medium">{t("method")} / {t("reference")}</th>
                          <th className="px-3 py-2 text-right font-medium">{t("amount")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paiementsListe.map((p) => (
                          <tr key={p.id} className="border-t">
                            <td className="px-3 py-2 whitespace-nowrap">{formatDateHeure(p.date)}</td>
                            <td className="px-3 py-2">{p.facture.eleve ? `${p.facture.eleve.prenom ?? ""} ${p.facture.eleve.nom}`.trim() : "—"}</td>
                            <td className="px-3 py-2 text-muted-foreground">{p.facture.numero}</td>
                            <td className="px-3 py-2">
                              <Badge variant="secondary" className="text-xs" data-color={getPaymentMethodColor(p.methode)}>
                                {libelleMoyen(p.methode)}
                              </Badge>
                              {p.reference && <span className="ml-2 font-mono text-xs text-muted-foreground">{p.reference}</span>}
                            </td>
                            <td className={cn("px-3 py-2 text-right font-medium whitespace-nowrap", p.montant < 0 && "text-red-600")}>
                              {formatCurrency(p.montant, p.devise)}
                            </td>
                          </tr>
                        ))}
                        {paiementsListe.length === 0 && (
                          <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">{t("noPayments")}</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Factures émises : synthèse seulement, la liste est dans /facturation ── */}
      {showFactures && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4 text-blue-600" />
              {t("invoicesForPeriod")}
              {facturesPeriode.length > 0 && (
                <Badge variant="secondary" className="text-xs ml-1">{facturesPeriode.length}</Badge>
              )}
              <span className="ml-auto text-xs font-normal text-muted-foreground">{t("cashOnlyHint")}</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {facturesPeriode.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">{t("noInvoicesPeriod")}</p>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex flex-wrap gap-6 text-sm">
                  <div>
                    <p className="text-2xl font-bold text-green-600">{facturesPayees}</p>
                    <p className="text-xs text-muted-foreground">{t("statusPaid")}</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-yellow-600">{facturesEnAttente}</p>
                    <p className="text-xs text-muted-foreground">{t("statusPending")}</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-red-600">{facturesEnRetard}</p>
                    <p className="text-xs text-muted-foreground">{t("statusOverdue")}</p>
                  </div>
                </div>
                <Button asChild variant="outline" size="sm" className="gap-2">
                  <Link href="/facturation">
                    <FileText className="h-4 w-4" />
                    {t("seeInvoicesDetail")}
                  </Link>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Espèces en attente ── */}
      {showRecettes && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t("cashPendingTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            {cashPending.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">{t("noCashPending")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground text-xs">
                      <th className="text-left py-2 pr-2">{t("date")}</th>
                      <th className="text-left py-2 pr-2">{t("student")}</th>
                      <th className="text-left py-2 pr-2">{t("invoice")}</th>
                      <th className="text-right py-2 pr-2">{t("amount")}</th>
                      <th className="text-left py-2 pr-2">{t("recordedBy")}</th>
                      <th className="text-right py-2">{tCommon("actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cashPending.map((p) => (
                      <tr key={p.id} className="border-b last:border-0">
                        <td className="py-2 pr-2 whitespace-nowrap">{formatDateHeure(p.date)}</td>
                        <td className="py-2 pr-2">{p.facture.eleve ? `${p.facture.eleve.prenom ? `${p.facture.eleve.prenom} ` : ""}${p.facture.eleve.nom}` : "—"}</td>
                        <td className="py-2 pr-2">{p.facture.numero}</td>
                        <td className="py-2 pr-2 text-right font-medium">{formatCurrency(p.montant, p.devise)}</td>
                        <td className="py-2 pr-2 text-muted-foreground">{p.enregistrePar?.name ?? "—"}</td>
                        <td className="py-2 text-right">
                          <div className="flex justify-end gap-2">
                            {canWriteFinance && (
                              <Button size="sm" variant="outline" onClick={() => { setDepotId(p.id); setDepotDate(todayInputValue()); }}>
                                {t("depositAction")}
                              </Button>
                            )}
                            {canWriteFinance && (
                              <Button size="sm" variant="secondary" onClick={() => recuperer(p.id)}>
                                {t("recoverAction")}
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Remises de caisse ── */}
      {showRecettes && (
        <RemiseCaisseSection remises={remisesCaisse} activeSite={activeSite} sites={sites} currency={currency} cashPendingTotal={cashPendingTotal} currentUser={currentUser} />
      )}

      {/* ── Dépenses ── */}
      {showDepenses && (
        <DepensesSection depenses={depenses} activeSite={activeSite} sites={sites} currency={currency} />
      )}

      {/* ── Budget ── */}
      {showDepenses && (
        <BudgetSection budgets={budgets} activeSite={activeSite} sites={sites} currency={currency} depensesTotal={totalDepenses} />
      )}

      <Dialog open={!!depotId} onOpenChange={(open) => { if (!open) setDepotId(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("depositDialogTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium">{t("bankName")}</label>
              <Input value={depotBanque} onChange={(e) => setDepotBanque(e.target.value)} placeholder="CAC Bank" />
            </div>
            <div>
              <label className="text-sm font-medium">{t("depositDate")}</label>
              <Input type="date" value={depotDate} onChange={(e) => setDepotDate(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDepotId(null)}>{tCommon("cancel")}</Button>
            <Button onClick={deposer} disabled={!depotBanque.trim() || isPending}>
              {isPending ? "…" : tCommon("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
