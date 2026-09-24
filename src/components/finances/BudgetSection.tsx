"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createBudget, deleteBudget } from "@/lib/actions/finances";
import { toast } from "sonner";

interface Budget {
  id: string;
  categorie: string;
  periode: string;
  montantPrevu: number;
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

const currentYear = new Date().getFullYear().toString();

export function BudgetSection({
  budgets,
  activeSite,
  sites,
  currency,
  depensesTotal,
}: {
  budgets: Budget[];
  activeSite: string;
  sites: { id: string; nom: string }[];
  currency: string;
  depensesTotal: number;
}) {
  const t = useTranslations("finances");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [form, setForm] = useState({
    categorie: "",
    periode: currentYear,
    montantPrevu: "",
    siteId: activeSite === "all" ? "" : activeSite,
  });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const montant = parseFloat(form.montantPrevu);
    if (!form.categorie || !form.periode || isNaN(montant) || montant <= 0) {
      toast.error(t("invalidBudget"));
      return;
    }

    startTransition(async () => {
      try {
        await createBudget({
          categorie: form.categorie,
          periode: form.periode,
          montantPrevu: montant,
          siteId: form.siteId || null,
        });
        toast.success(t("budgetSaved"));
        setForm({
          categorie: "",
          periode: currentYear,
          montantPrevu: "",
          siteId: activeSite === "all" ? "" : activeSite,
        });
        router.refresh();
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : "Erreur");
      }
    });
  }

  async function onDelete(id: string) {
    if (!window.confirm(tCommon("delete"))) return;
    startTransition(async () => {
      try {
        await deleteBudget(id);
        toast.success(t("budgetDeleted"));
        router.refresh();
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : "Erreur");
      }
    });
  }

  const totalBudget = budgets.reduce((sum, b) => sum + b.montantPrevu, 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t("budgetTitle")}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
          <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-950">
            <p className="text-xs text-blue-600 dark:text-blue-300">{t("totalBudgeted")}</p>
            <p className="text-xl font-bold text-blue-700 dark:text-blue-200">{formatCurrency(totalBudget, currency)}</p>
          </div>
          <div className="p-3 rounded-lg bg-orange-50 dark:bg-orange-950">
            <p className="text-xs text-orange-600 dark:text-orange-300">{t("totalSpent")}</p>
            <p className="text-xl font-bold text-orange-700 dark:text-orange-200">{formatCurrency(depensesTotal, currency)}</p>
          </div>
          <div className="p-3 rounded-lg bg-green-50 dark:bg-green-950">
            <p className="text-xs text-green-600 dark:text-green-300">{t("budgetRemaining")}</p>
            <p className="text-xl font-bold text-green-700 dark:text-green-200">{formatCurrency(totalBudget - depensesTotal, currency)}</p>
          </div>
        </div>

        <form onSubmit={onSubmit} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
          <Input placeholder={t("category")} value={form.categorie} onChange={(e) => setForm({ ...form, categorie: e.target.value })} />
          <Input placeholder={t("period")} value={form.periode} onChange={(e) => setForm({ ...form, periode: e.target.value })} />
          <Input type="number" step="0.01" placeholder={t("plannedAmount")} value={form.montantPrevu} onChange={(e) => setForm({ ...form, montantPrevu: e.target.value })} />
          {activeSite === "all" && (
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
              value={form.siteId}
              onChange={(e) => setForm({ ...form, siteId: e.target.value })}
            >
              <option value="">{t("sharedAllSites")}</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>{s.nom}</option>
              ))}
            </select>
          )}
          <div className="lg:col-span-2">
            <Button type="submit" disabled={isPending}>{tCommon("save")}</Button>
          </div>
        </form>

        {budgets.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">{t("noBudgets")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground text-xs">
                  <th className="text-left py-2 pr-2">{t("category")}</th>
                  <th className="text-left py-2 pr-2">{t("period")}</th>
                  <th className="text-right py-2 pr-2">{t("plannedAmount")}</th>
                  <th className="text-right py-2">{tCommon("actions")}</th>
                </tr>
              </thead>
              <tbody>
                {budgets.map((b) => (
                  <tr key={b.id} className="border-b last:border-0">
                    <td className="py-2 pr-2">{b.categorie}</td>
                    <td className="py-2 pr-2">{b.periode}</td>
                    <td className="py-2 pr-2 text-right font-medium">{formatCurrency(b.montantPrevu, currency)}</td>
                    <td className="py-2 text-right">
                      <Button size="sm" variant="ghost" onClick={() => onDelete(b.id)}>{tCommon("delete")}</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
