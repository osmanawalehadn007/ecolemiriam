"use client";

import { useState } from "react";
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
import { formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { CalendarDays, ChevronLeft, ChevronRight, TrendingUp, TrendingDown, FileText, LayoutGrid } from "lucide-react";
import type { SiteColor } from "@/lib/site-colors";
import { DepensesSection } from "./DepensesSection";
import { BudgetSection } from "./BudgetSection";
import { RemiseCaisseSection } from "./RemiseCaisseSection";

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
  };
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
  totalRestant,
  totalDepenses,
  cashPendingTotal,
  cashPending,
  depenses,
  budgets,
  paiements,
  facturesPeriode,
  remisesCaisse,
  activeSite,
  activePeriode,
  activeMonth,
  activeType,
  availableMonths,
  siteColors,
  currentSiteName,
  currentUser,
  sites,
}: {
  totalEncaisse: number;
  totalFactures: number;
  totalRestant: number;
  totalDepenses: number;
  cashPendingTotal: number;
  cashPending: Paiement[];
  depenses: Depense[];
  budgets: Budget[];
  paiements: Paiement[];
  facturesPeriode: FacturePeriode[];
  remisesCaisse: RemiseCaisse[];
  activeSite: string;
  activePeriode: Periode;
  activeMonth: string | null;
  activeType: FinanceType;
  availableMonths: string[];
  siteColors: Record<string, SiteColor>;
  currentSiteName: string;
  currentUser: { id: string; name?: string | null; role: string };
  sites: { id: string; nom: string }[];
}) {
  const t = useTranslations("finances");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const searchParams = useSearchParams();
  const currency = paiements[0]?.devise ?? facturesPeriode[0]?.devise ?? "DJF";
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
    router.push(`/finances?${params.toString()}`);
  }

  function setMonth(monthKey: string | null) {
    const params = new URLSearchParams(searchParams.toString());
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

  const stats = [
    { label: t("totalInvoiced"), value: totalFactures, color: "text-blue-600" },
    { label: t("totalCollected"), value: totalEncaisse, color: "text-green-600", siteColor },
    { label: t("totalRemaining"), value: totalRestant, color: "text-orange-600" },
    { label: t("totalExpenses"), value: totalDepenses, color: "text-red-600" },
  ];

  const exportHref = activeMonth
    ? `/api/finances/export?siteId=${activeSite}&month=${activeMonth}&type=${activeType}`
    : `/api/finances/export?siteId=${activeSite}&periode=${activePeriode}&type=${activeType}`;

  const showAll = activeType === "all";
  const showRecettes = showAll || activeType === "recettes";
  const showDepenses = showAll || activeType === "depenses";
  const showFactures = showAll || activeType === "factures";

  const filteredStats = showAll
    ? stats
    : activeType === "recettes"
      ? [stats[1], stats[2]]
      : activeType === "depenses"
        ? [stats[3]]
        : activeType === "factures"
          ? [stats[0], stats[2]]
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
                activePeriode === p.key && !activeMonth
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
      <div className={cn("grid gap-4", filteredStats.length === 1 ? "grid-cols-1" : filteredStats.length === 2 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4")}>
        {filteredStats.map((s) => (
          <Card
            key={s.label}
            className="border-l-4"
            style={{ borderLeftColor: s.siteColor?.base ?? "#6b7280" }}
          >
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className={`text-2xl font-bold ${s.color}`}>{formatCurrency(s.value, currency)}</p>
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

      {/* ── Section Recettes (paiements) ── */}
      {showRecettes && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-green-600" />
              {t("paymentsForSite", { site: currentSiteName })}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {paiements.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">{t("noPayments")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground text-xs">
                      <th className="text-left py-2 pr-2">{t("date")}</th>
                      <th className="text-left py-2 pr-2">{t("student")}</th>
                      <th className="text-left py-2 pr-2">{t("invoice")}</th>
                      <th className="text-left py-2 pr-2">{t("method")}</th>
                      <th className="text-left py-2 pr-2">{t("reference")}</th>
                      <th className="text-right py-2">{t("amount")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paiements.map((p) => (
                      <tr key={p.id} className="border-b last:border-0">
                        <td className="py-2 pr-2 whitespace-nowrap">{formatDate(p.date)}</td>
                        <td className="py-2 pr-2">{p.facture.eleve ? `${p.facture.eleve.prenom ? `${p.facture.eleve.prenom} ` : ""}${p.facture.eleve.nom}` : "—"}</td>
                        <td className="py-2 pr-2">{p.facture.numero}</td>
                        <td className="py-2 pr-2 capitalize">{p.methode}</td>
                        <td className="py-2 pr-2 text-muted-foreground">{p.reference ?? "—"}</td>
                        <td className="py-2 text-right font-medium">{formatCurrency(p.montant, p.devise)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Section Factures émises ── */}
      {showFactures && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4 text-blue-600" />
              {t("invoicesForPeriod")}
              {facturesPeriode.length > 0 && (
                <Badge variant="secondary" className="text-xs ml-1">{facturesPeriode.length}</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {facturesPeriode.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">{t("noInvoicesPeriod")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground text-xs">
                      <th className="text-left py-2 pr-2">{t("date")}</th>
                      <th className="text-left py-2 pr-2">{t("colNumber")}</th>
                      <th className="text-left py-2 pr-2">{t("student")}</th>
                      <th className="text-left py-2 pr-2">{t("colStatus")}</th>
                      <th className="text-right py-2 pr-2">{t("amount")}</th>
                      <th className="text-right py-2 pr-2">{t("colPaid")}</th>
                      <th className="text-right py-2">{t("colRemaining")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {facturesPeriode.map((f) => {
                      const paye = f.paiements.reduce((s, p) => s + p.montant, 0);
                      const restant = f.montant - paye;
                      return (
                        <tr key={f.id} className="border-b last:border-0 hover:bg-muted/20">
                          <td className="py-2 pr-2 whitespace-nowrap">{formatDate(f.createdAt)}</td>
                          <td className="py-2 pr-2 font-mono text-xs">{f.numero}</td>
                          <td className="py-2 pr-2">
                            <div className="font-medium text-xs">{f.eleve.prenom} {f.eleve.nom}</div>
                            <div className="text-xs text-muted-foreground">{f.eleve.classe?.nom ?? "N/A"}</div>
                          </td>
                          <td className="py-2 pr-2">
                            {f.statut === "PAYEE" && <Badge variant="success" className="text-xs">{t("statusPaid")}</Badge>}
                            {f.statut === "EN_ATTENTE" && <Badge variant="warning" className="text-xs">{t("statusPending")}</Badge>}
                            {f.statut === "EN_RETARD" && <Badge variant="destructive" className="text-xs">{t("statusOverdue")}</Badge>}
                            {f.statut === "ANNULEE" && <Badge variant="secondary" className="text-xs">{t("statusCancelled")}</Badge>}
                          </td>
                          <td className="py-2 pr-2 text-right font-medium text-xs">{formatCurrency(f.montant, f.devise)}</td>
                          <td className="py-2 pr-2 text-right text-green-600 text-xs">{formatCurrency(paye, f.devise)}</td>
                          <td className={cn("py-2 text-right font-medium text-xs", restant > 0 ? "text-red-600" : "text-green-600")}>
                            {formatCurrency(restant, f.devise)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
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
                        <td className="py-2 pr-2 whitespace-nowrap">{formatDate(p.date)}</td>
                        <td className="py-2 pr-2">{p.facture.eleve ? `${p.facture.eleve.prenom ? `${p.facture.eleve.prenom} ` : ""}${p.facture.eleve.nom}` : "—"}</td>
                        <td className="py-2 pr-2">{p.facture.numero}</td>
                        <td className="py-2 pr-2 text-right font-medium">{formatCurrency(p.montant, p.devise)}</td>
                        <td className="py-2 pr-2 text-muted-foreground">{p.enregistrePar?.name ?? "—"}</td>
                        <td className="py-2 text-right">
                          <div className="flex justify-end gap-2">
                            <Button size="sm" variant="outline" onClick={() => { setDepotId(p.id); setDepotDate(todayInputValue()); }}>
                              {t("depositAction")}
                            </Button>
                            <Button size="sm" variant="secondary" onClick={() => recuperer(p.id)}>
                              {t("recoverAction")}
                            </Button>
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
