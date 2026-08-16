"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createDepense, deleteDepense } from "@/lib/actions/finances";
import { getUsersForTenant } from "@/lib/actions/parametres";
import { formatDate } from "@/lib/utils";
import { toast } from "sonner";

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

interface UserOption {
  id: string;
  name: string | null;
  role: string;
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

export function DepensesSection({
  depenses,
  activeSite,
  sites,
  currency,
}: {
  depenses: Depense[];
  activeSite: string;
  sites: { id: string; nom: string }[];
  currency: string;
}) {
  const t = useTranslations("finances");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [form, setForm] = useState({
    categorie: "",
    description: "",
    fournisseur: "",
    montant: "",
    date: todayInputValue(),
    siteId: activeSite === "all" ? "" : activeSite,
    typeEngagement: "",
    autoriseParId: "",
    payeParId: "",
  });
  const [users, setUsers] = useState<UserOption[]>([]);

  useEffect(() => {
    getUsersForTenant()
      .then((data) => setUsers(data.map((u) => ({ id: u.id, name: u.name, role: u.role }))))
      .catch(() => {});
  }, []);

  const typeEngagementOptions = [
    { value: "bon_commande", label: t("engBonCommande") },
    { value: "facture", label: t("engFacture") },
    { value: "bon_livraison", label: t("engBonLivraison") },
    { value: "achat_comptant", label: t("engAchatComptant") },
  ];

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const montant = parseFloat(form.montant);
    if (!form.categorie || isNaN(montant) || montant <= 0) {
      toast.error(t("invalidExpense"));
      return;
    }

    startTransition(async () => {
      try {
        await createDepense({
          categorie: form.categorie,
          description: form.description || undefined,
          fournisseur: form.fournisseur || undefined,
          montant,
          date: form.date,
          devise: currency,
          siteId: form.siteId || null,
          typeEngagement: form.typeEngagement || undefined,
          autoriseParId: form.autoriseParId || null,
          payeParId: form.payeParId || null,
        });
        toast.success(t("expenseSaved"));
        setForm({
          categorie: "",
          description: "",
          fournisseur: "",
          montant: "",
          date: todayInputValue(),
          siteId: activeSite === "all" ? "" : activeSite,
          typeEngagement: "",
          autoriseParId: "",
          payeParId: "",
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
        await deleteDepense(id);
        toast.success(t("expenseDeleted"));
        router.refresh();
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : "Erreur");
      }
    });
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t("expensesTitle")}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <Input placeholder={t("category")} value={form.categorie} onChange={(e) => setForm({ ...form, categorie: e.target.value })} />
          <Input placeholder={t("supplier")} value={form.fournisseur} onChange={(e) => setForm({ ...form, fournisseur: e.target.value })} />
          <Input type="number" step="0.01" placeholder={t("amount")} value={form.montant} onChange={(e) => setForm({ ...form, montant: e.target.value })} />
          <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
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
          <Input placeholder={t("description")} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <div className="space-y-1.5">
            <Label className="text-xs">{t("engagementType")}</Label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
              value={form.typeEngagement}
              onChange={(e) => setForm({ ...form, typeEngagement: e.target.value })}
            >
              <option value="">—</option>
              {typeEngagementOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">{t("authorizedBy")}</Label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
              value={form.autoriseParId}
              onChange={(e) => setForm({ ...form, autoriseParId: e.target.value })}
            >
              <option value="">—</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.name ?? "—"}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">{t("paidBy")}</Label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
              value={form.payeParId}
              onChange={(e) => setForm({ ...form, payeParId: e.target.value })}
            >
              <option value="">—</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.name ?? "—"}</option>
              ))}
            </select>
          </div>
          <div className={activeSite === "all" ? "lg:col-span-4" : "sm:col-span-2 lg:col-span-3"}>
            <Button type="submit" disabled={isPending}>{tCommon("save")}</Button>
          </div>
        </form>

        {depenses.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">{t("noExpenses")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground text-xs">
                  <th className="text-left py-2 pr-2">{t("date")}</th>
                  <th className="text-left py-2 pr-2">{t("category")}</th>
                  <th className="text-left py-2 pr-2">{t("supplier")}</th>
                  <th className="text-left py-2 pr-2">{t("description")}</th>
                  <th className="text-left py-2 pr-2">{t("engagementType")}</th>
                  <th className="text-left py-2 pr-2">{t("authorizedBy")}</th>
                  <th className="text-left py-2 pr-2">{t("paidBy")}</th>
                  <th className="text-right py-2 pr-2">{t("amount")}</th>
                  <th className="text-right py-2">{tCommon("actions")}</th>
                </tr>
              </thead>
              <tbody>
                {depenses.map((d) => (
                  <tr key={d.id} className="border-b last:border-0">
                    <td className="py-2 pr-2 whitespace-nowrap">{formatDate(d.date)}</td>
                    <td className="py-2 pr-2">{d.categorie}</td>
                    <td className="py-2 pr-2">{d.fournisseur ?? "—"}</td>
                    <td className="py-2 pr-2 text-muted-foreground">{d.description ?? "—"}</td>
                    <td className="py-2 pr-2 text-xs">{d.typeEngagement ? typeEngagementOptions.find((o) => o.value === d.typeEngagement)?.label ?? d.typeEngagement : "—"}</td>
                    <td className="py-2 pr-2 text-muted-foreground">{d.autorisePar?.name ?? "—"}</td>
                    <td className="py-2 pr-2 text-muted-foreground">{d.payePar?.name ?? "—"}</td>
                    <td className="py-2 pr-2 text-right font-medium">{formatCurrency(d.montant, d.devise)}</td>
                    <td className="py-2 text-right">
                      <Button size="sm" variant="ghost" onClick={() => onDelete(d.id)}>{tCommon("delete")}</Button>
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
