"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import type { SiteColor } from "@/lib/site-colors";
import { DepensesSection } from "./DepensesSection";
import { BudgetSection } from "./BudgetSection";
import { RemiseCaisseSection } from "./RemiseCaisseSection";

type Periode = "today" | "week" | "month" | "semester" | "year";

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
  remisesCaisse,
  activeSite,
  activePeriode,
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
  remisesCaisse: RemiseCaisse[];
  activeSite: string;
  activePeriode: Periode;
  siteColors: Record<string, SiteColor>;
  currentSiteName: string;
  currentUser: { id: string; name?: string | null; role: string };
  sites: { id: string; nom: string }[];
}) {
  const t = useTranslations("finances");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const searchParams = useSearchParams();
  const currency = paiements[0]?.devise ?? "DJF";
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

  function setPeriode(periode: Periode) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("periode", periode);
    router.push(`/finances?${params.toString()}`);
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

  const exportHref = `/api/finances/export?siteId=${activeSite}&periode=${activePeriode}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {periodes.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriode(p.key)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                activePeriode === p.key
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

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s) => (
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

      {cashPendingTotal > 0 && (
        <Card className="border-l-4 border-l-red-500">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">{t("cashPending")}</p>
            <p className="text-2xl font-bold text-red-600">{formatCurrency(cashPendingTotal, currency)}</p>
            <p className="text-xs text-red-500/80 mt-1">{t("cashPendingHint")}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t("paymentsForSite", { site: currentSiteName })}</CardTitle>
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

      <RemiseCaisseSection remises={remisesCaisse} activeSite={activeSite} sites={sites} currency={currency} cashPendingTotal={cashPendingTotal} currentUser={currentUser} />

      <DepensesSection depenses={depenses} activeSite={activeSite} sites={sites} currency={currency} />

      <BudgetSection budgets={budgets} activeSite={activeSite} sites={sites} currency={currency} depensesTotal={totalDepenses} />

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
