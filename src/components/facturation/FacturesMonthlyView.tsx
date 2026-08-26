"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  ChevronDown, ChevronRight, CheckCircle2, XCircle, Clock,
  AlertTriangle, Bell, Download, Plus,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { hasPermission } from "@/lib/client-permissions";

interface FactureMensuelle {
  id: string;
  numero: string;
  libelle: string;
  montant: number;
  devise: string;
  statut: "EN_ATTENTE" | "PAYEE" | "EN_RETARD" | "ANNULEE";
  echeance: Date | null;
  createdAt: Date;
  mois: string | null;
  eleve: {
    id: string;
    nom: string;
    prenom: string;
    matricule: string;
    classe: { nom: string } | null;
  };
  paiements: { montant: number }[];
  relances: { id: string; niveau: number; envoyeeLe: Date }[];
}

interface FacturesMonthlyViewProps {
  factures: FactureMensuelle[];
  userRole?: string;
}

const MOIS_NOMS = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];

function formatMoney(amount: number, devise: string) {
  const currency = devise === "XOF" ? "DJF" : devise;
  return new Intl.NumberFormat("fr-DJ", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
}

function getMonthLabel(moisKey: string): string {
  const [year, month] = moisKey.split("-");
  const monthIdx = parseInt(month) - 1;
  if (monthIdx >= 0 && monthIdx < 12) {
    return `${MOIS_NOMS[monthIdx]} ${year}`;
  }
  return moisKey;
}

export function FacturesMonthlyView({ factures, userRole }: FacturesMonthlyViewProps) {
  const t = useTranslations("facturation");
  const canWriteFinance = hasPermission(userRole, "finance:write");
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<"ALL" | "PAYEE" | "EN_ATTENTE" | "EN_RETARD" | "RELANCEE">("ALL");

  // Grouper par mois
  const facturesByMonth = useMemo(() => {
    const groups: Record<string, FactureMensuelle[]> = {};
    for (const f of factures) {
      const key = f.mois ?? `${f.createdAt.getFullYear()}-${String(f.createdAt.getMonth() + 1).padStart(2, "0")}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(f);
    }
    // Trier par mois décroissant
    return Object.entries(groups).sort((a, b) => b[0].localeCompare(a[0]));
  }, [factures]);

  // Calculer les stats pour chaque mois
  const monthStats = useMemo(() => {
    const stats: Record<string, {
      total: number;
      payees: number;
      enAttente: number;
      enRetard: number;
      relancees: number;
      totalMontant: number;
      totalPaye: number;
      totalRestant: number;
    }> = {};

    for (const [mois, facs] of facturesByMonth) {
      const s = {
        total: facs.length,
        payees: 0,
        enAttente: 0,
        enRetard: 0,
        relancees: 0,
        totalMontant: 0,
        totalPaye: 0,
        totalRestant: 0,
      };

      for (const f of facs) {
        const paye = f.paiements.reduce((s, p) => s + p.montant, 0);
        s.totalMontant += f.montant;
        s.totalPaye += paye;
        s.totalRestant += f.montant - paye;

        if (f.statut === "PAYEE") s.payees++;
        else if (f.statut === "EN_RETARD") s.enRetard++;
        else if (f.statut === "EN_ATTENTE") s.enAttente++;
        if (f.relances.length > 0) s.relancees++;
      }

      stats[mois] = s;
    }

    return stats;
  }, [facturesByMonth]);

  function exportMonthCSV(mois: string, facs: FactureMensuelle[]) {
    const headers = ["N°", "Élève", "Matricule", "Classe", "Libellé", "Montant", "Payé", "Restant", "Statut", "Relances", "Échéance"];
    const rows = facs.map((f) => {
      const paye = f.paiements.reduce((s, p) => s + p.montant, 0);
      return [
        f.numero,
        `${f.eleve.prenom} ${f.eleve.nom}`,
        f.eleve.matricule,
        f.eleve.classe?.nom ?? "",
        f.libelle,
        f.montant,
        paye,
        f.montant - paye,
        f.statut,
        f.relances.length,
        f.echeance ? new Date(f.echeance).toLocaleDateString("fr-FR") : "",
      ];
    });
    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => {
        const v = String(cell ?? "").replace(/"/g, '""');
        return v.includes(",") || v.includes('"') ? `"${v}"` : v;
      }).join(","))
      .join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `factures-${mois}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      {/* Filtres statut */}
      <div className="flex flex-wrap gap-2">
        {[
          { key: "ALL", label: t("monthlyAll"), icon: null },
          { key: "PAYEE", label: t("monthlyPaid"), icon: <CheckCircle2 className="h-3.5 w-3.5 text-green-500" /> },
          { key: "EN_ATTENTE", label: t("monthlyPending"), icon: <Clock className="h-3.5 w-3.5 text-yellow-500" /> },
          { key: "EN_RETARD", label: t("monthlyOverdue"), icon: <XCircle className="h-3.5 w-3.5 text-red-500" /> },
          { key: "RELANCEE", label: t("monthlyReminded"), icon: <Bell className="h-3.5 w-3.5 text-orange-500" /> },
        ].map((f) => (
          <button
            key={f.key}
            onClick={() => setFilterStatus(f.key as typeof filterStatus)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-all",
              filterStatus === f.key
                ? "border-primary bg-primary/10 text-primary"
                : "border-input bg-background hover:bg-muted/50"
            )}
          >
            {f.icon}
            {f.label}
          </button>
        ))}
      </div>

      {/* Liste par mois */}
      {facturesByMonth.length === 0 ? (
        <Card className="p-12 text-center">
          <p className="text-sm text-muted-foreground">{t("noInvoices")}</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {facturesByMonth.map(([mois, facs]) => {
            const stats = monthStats[mois];
            const isExpanded = expandedMonth === mois;

            // Filtrer les factures selon le filtre statut
            const filteredFacs = facs.filter((f) => {
              if (filterStatus === "ALL") return true;
              if (filterStatus === "PAYEE") return f.statut === "PAYEE";
              if (filterStatus === "EN_ATTENTE") return f.statut === "EN_ATTENTE";
              if (filterStatus === "EN_RETARD") return f.statut === "EN_RETARD";
              if (filterStatus === "RELANCEE") return f.relances.length > 0;
              return true;
            });

            return (
              <Card key={mois} className="overflow-hidden">
                {/* Header du mois */}
                <button
                  onClick={() => setExpandedMonth(isExpanded ? null : mois)}
                  className="w-full flex items-center justify-between p-4 hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    {isExpanded ? (
                      <ChevronDown className="h-5 w-5 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-5 w-5 text-muted-foreground" />
                    )}
                    <div className="text-left">
                      <h3 className="font-semibold text-sm">{getMonthLabel(mois)}</h3>
                      <div className="flex items-center gap-3 mt-1 text-xs">
                        <span className="text-muted-foreground">{stats.total} {t("monthlyInvoices")}</span>
                        <span className="flex items-center gap-1 text-green-600">
                          <CheckCircle2 className="h-3 w-3" />
                          {stats.payees}
                        </span>
                        <span className="flex items-center gap-1 text-yellow-600">
                          <Clock className="h-3 w-3" />
                          {stats.enAttente}
                        </span>
                        <span className="flex items-center gap-1 text-red-600">
                          <XCircle className="h-3 w-3" />
                          {stats.enRetard}
                        </span>
                        {stats.relancees > 0 && (
                          <span className="flex items-center gap-1 text-orange-600">
                            <Bell className="h-3 w-3" />
                            {stats.relancees}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="grid grid-cols-3 gap-4 text-xs">
                      <div>
                        <p className="text-muted-foreground">{t("totalInvoiced")}</p>
                        <p className="font-bold">{formatMoney(stats.totalMontant, facs[0]?.devise ?? "DJF")}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">{t("totalCollected")}</p>
                        <p className="font-bold text-green-600">{formatMoney(stats.totalPaye, facs[0]?.devise ?? "DJF")}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">{t("balanceRemaining")}</p>
                        <p className={cn("font-bold", stats.totalRestant > 0 ? "text-red-600" : "text-green-600")}>
                          {formatMoney(stats.totalRestant, facs[0]?.devise ?? "DJF")}
                        </p>
                      </div>
                    </div>
                  </div>
                </button>

                {/* Détail des factures du mois */}
                {isExpanded && (
                  <div className="border-t">
                    <div className="flex items-center justify-between px-4 py-2 bg-muted/20">
                      <p className="text-xs text-muted-foreground">
                        {filteredFacs.length} / {facs.length} {t("monthlyInvoices")}
                      </p>
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1 text-xs h-7"
                          onClick={() => exportMonthCSV(mois, filteredFacs)}
                        >
                          <Download className="h-3 w-3" />
                          {t("export")}
                        </Button>
                        {canWriteFinance && (
                          <Button asChild variant="ghost" size="sm" className="gap-1 text-xs h-7">
                            <Link href="/facturation/nouvelle">
                              <Plus className="h-3 w-3" />
                              {t("newInvoice")}
                            </Link>
                          </Button>
                        )}
                      </div>
                    </div>

                    {filteredFacs.length === 0 ? (
                      <p className="text-center py-6 text-sm text-muted-foreground">{t("noInvoices")}</p>
                    ) : (
                      <table className="w-full text-sm">
                        <thead className="bg-muted/30 border-b">
                          <tr>
                            <th className="text-left px-4 py-2 font-medium text-xs">{t("colNumber")}</th>
                            <th className="text-left px-4 py-2 font-medium text-xs">{t("colStudent")}</th>
                            <th className="text-right px-4 py-2 font-medium text-xs">{t("colAmount")}</th>
                            <th className="text-right px-4 py-2 font-medium text-xs">{t("colPaid")}</th>
                            <th className="text-right px-4 py-2 font-medium text-xs">{t("colRemaining")}</th>
                            <th className="text-left px-4 py-2 font-medium text-xs">{t("colStatus")}</th>
                            <th className="text-center px-4 py-2 font-medium text-xs">{t("colReminders")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredFacs.map((f) => {
                            const paye = f.paiements.reduce((s, p) => s + p.montant, 0);
                            const restant = f.montant - paye;
                            return (
                              <tr key={f.id} className="border-b last:border-0 hover:bg-muted/20">
                                <td className="px-4 py-2.5 font-mono text-xs">
                                  <Link href={`/facturation/${f.id}`} className="hover:underline text-primary">
                                    {f.numero}
                                  </Link>
                                </td>
                                <td className="px-4 py-2.5">
                                  <div className="font-medium text-xs">{f.eleve.prenom} {f.eleve.nom}</div>
                                  <div className="text-xs text-muted-foreground">{f.eleve.classe?.nom ?? "N/A"}</div>
                                </td>
                                <td className="px-4 py-2.5 text-right font-medium text-xs">{formatMoney(f.montant, f.devise)}</td>
                                <td className="px-4 py-2.5 text-right text-green-600 text-xs">{formatMoney(paye, f.devise)}</td>
                                <td className={cn("px-4 py-2.5 text-right font-medium text-xs", restant > 0 ? "text-red-600" : "text-green-600")}>
                                  {formatMoney(restant, f.devise)}
                                </td>
                                <td className="px-4 py-2.5">
                                  {f.statut === "PAYEE" && (
                                    <Badge variant="success" className="text-xs gap-1">
                                      <CheckCircle2 className="h-3 w-3" /> {t("statusPaid")}
                                    </Badge>
                                  )}
                                  {f.statut === "EN_ATTENTE" && (
                                    <Badge variant="warning" className="text-xs gap-1">
                                      <Clock className="h-3 w-3" /> {t("statusPending")}
                                    </Badge>
                                  )}
                                  {f.statut === "EN_RETARD" && (
                                    <Badge variant="destructive" className="text-xs gap-1">
                                      <AlertTriangle className="h-3 w-3" /> {t("statusOverdue")}
                                    </Badge>
                                  )}
                                  {f.statut === "ANNULEE" && (
                                    <Badge variant="secondary" className="text-xs">{t("statusCancelled")}</Badge>
                                  )}
                                </td>
                                <td className="px-4 py-2.5 text-center">
                                  {f.relances.length > 0 ? (
                                    <span className="inline-flex items-center gap-1 text-xs text-orange-600">
                                      <Bell className="h-3 w-3" />
                                      {f.relances.length}
                                    </span>
                                  ) : (
                                    <span className="text-xs text-muted-foreground">—</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
