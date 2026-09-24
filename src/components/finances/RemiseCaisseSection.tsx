"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  createRemiseCaisse,
  confirmerRemiseCaisse,
  rejeterRemiseCaisse,
} from "@/lib/actions/finances";
import { getUsersForTenant } from "@/lib/actions/parametres";
import { formatDate } from "@/lib/utils";
import { toast } from "sonner";
import { Loader2, HandCoins, Check, X } from "lucide-react";

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

export function RemiseCaisseSection({
  remises,
  activeSite,
  sites,
  currency,
  cashPendingTotal,
  currentUser,
}: {
  remises: RemiseCaisse[];
  activeSite: string;
  sites: { id: string; nom: string }[];
  currency: string;
  cashPendingTotal: number;
  currentUser: { id: string; name?: string | null; role: string };
}) {
  const t = useTranslations("finances");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [users, setUsers] = useState<UserOption[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [montantDeclare, setMontantDeclare] = useState("");
  const [destinataireId, setDestinataireId] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [confirmMontant, setConfirmMontant] = useState("");

  useEffect(() => {
    getUsersForTenant()
      .then((data) => setUsers(data.map((u) => ({ id: u.id, name: u.name, role: u.role }))))
      .catch(() => {});
  }, []);

  function openDialog() {
    setMontantDeclare(cashPendingTotal > 0 ? String(cashPendingTotal) : "");
    setDestinataireId("");
    setDialogOpen(true);
  }

  async function onSubmit() {
    const montant = parseFloat(montantDeclare);
    if (isNaN(montant) || montant <= 0) {
      toast.error(t("invalidAmount"));
      return;
    }
    if (!destinataireId) {
      toast.error(t("selectRecipient"));
      return;
    }
    startTransition(async () => {
      try {
        await createRemiseCaisse({
          montantDeclare: montant,
          destinataireId,
          siteId: activeSite === "all" ? null : activeSite,
          paiementIds: [],
        });
        toast.success(t("remiseCreated"));
        setDialogOpen(false);
        router.refresh();
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : "Erreur");
      }
    });
  }

  async function onConfirm() {
    if (!confirmId) return;
    const montant = parseFloat(confirmMontant);
    if (isNaN(montant) || montant <= 0) {
      toast.error(t("invalidAmount"));
      return;
    }
    startTransition(async () => {
      try {
        await confirmerRemiseCaisse(confirmId, montant);
        toast.success(t("remiseConfirmed"));
        setConfirmId(null);
        setConfirmMontant("");
        router.refresh();
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : "Erreur");
      }
    });
  }

  async function onReject(id: string) {
    if (!window.confirm(t("confirmRejectRemise"))) return;
    startTransition(async () => {
      try {
        await rejeterRemiseCaisse(id);
        toast.success(t("remiseRejected"));
        router.refresh();
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : "Erreur");
      }
    });
  }

  const isAdmin = ["SUPER_ADMIN", "TENANT_ADMIN"].includes(currentUser.role);
  const canView = (r: RemiseCaisse) =>
    isAdmin || currentUser.id === r.caissier.id || currentUser.id === r.destinataire?.id;
  const canConfirm = (r: RemiseCaisse) => currentUser.id === r.destinataire?.id;

  const visibleRemises = remises.filter(canView);

  const statutBadge = (statut: string) => {
    if (statut === "CONFIRME") return <Badge variant="success">{t("remiseConfirmedBadge")}</Badge>;
    if (statut === "REJETE") return <Badge variant="destructive">{t("remiseRejectedBadge")}</Badge>;
    return <Badge variant="warning">{t("remisePendingBadge")}</Badge>;
  };

  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-base flex items-center gap-2">
          <HandCoins className="h-4 w-4" />
          {t("remiseCaisseTitle")}
        </CardTitle>
        <Button size="sm" variant="outline" onClick={openDialog}>
          {t("newRemise")}
        </Button>
      </CardHeader>
      <CardContent>
        {visibleRemises.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">{t("noRemises")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground text-xs">
                  <th className="text-left py-2 pr-2">{t("date")}</th>
                  <th className="text-left py-2 pr-2">{t("cashier")}</th>
                  <th className="text-left py-2 pr-2">{t("recipient")}</th>
                  <th className="text-right py-2 pr-2">{t("declaredAmount")}</th>
                  <th className="text-right py-2 pr-2">{t("receivedAmount")}</th>
                  <th className="text-left py-2 pr-2">{t("receptionDate")}</th>
                  <th className="text-left py-2 pr-2">{t("status")}</th>
                  <th className="text-right py-2">{tCommon("actions")}</th>
                </tr>
              </thead>
              <tbody>
                {visibleRemises.map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="py-2 pr-2 whitespace-nowrap">{formatDate(r.dateDeclaration)}</td>
                    <td className="py-2 pr-2">{r.caissier.name ?? "—"}</td>
                    <td className="py-2 pr-2">{r.destinataire?.name ?? "—"}</td>
                    <td className="py-2 pr-2 text-right font-medium">{formatCurrency(r.montantDeclare, currency)}</td>
                    <td className="py-2 pr-2 text-right">
                      {r.montantRecu != null ? formatCurrency(r.montantRecu, currency) : "—"}
                    </td>
                    <td className="py-2 pr-2 whitespace-nowrap">
                      {r.dateReception ? formatDate(r.dateReception) : "—"}
                    </td>
                    <td className="py-2 pr-2">{statutBadge(r.statut)}</td>
                    <td className="py-2 text-right">
                      {r.statut === "EN_ATTENTE" && canConfirm(r) && (
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setConfirmId(r.id);
                              setConfirmMontant(String(r.montantDeclare));
                            }}
                          >
                            <Check className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => onReject(r.id)}>
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      {/* Dialogue: nouvelle remise de caisse */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <HandCoins className="h-5 w-5" />
              {t("newRemise")}
            </DialogTitle>
            <DialogDescription>{t("newRemiseDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>{t("declaredAmount")}</Label>
              <Input
                type="number"
                step="0.01"
                value={montantDeclare}
                onChange={(e) => setMontantDeclare(e.target.value)}
                placeholder="0"
              />
              {cashPendingTotal > 0 && (
                <p className="text-xs text-muted-foreground">
                  {t("cashPendingHint")}: {formatCurrency(cashPendingTotal, currency)}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>{t("recipient")}</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                value={destinataireId}
                onChange={(e) => setDestinataireId(e.target.value)}
              >
                <option value="">—</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.name ?? "—"}</option>
                ))}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>{tCommon("cancel")}</Button>
            <Button onClick={onSubmit} disabled={isPending || !montantDeclare || !destinataireId}>
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("declare")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialogue: confirmation de réception */}
      <Dialog open={!!confirmId} onOpenChange={(open) => { if (!open) { setConfirmId(null); setConfirmMontant(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Check className="h-5 w-5" />
              {t("confirmReception")}
            </DialogTitle>
            <DialogDescription>{t("confirmReceptionDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>{t("receivedAmount")}</Label>
              <Input
                type="number"
                step="0.01"
                value={confirmMontant}
                onChange={(e) => setConfirmMontant(e.target.value)}
                placeholder="0"
              />
              <p className="text-xs text-amber-600">{t("amountMatchWarning")}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setConfirmId(null); setConfirmMontant(""); }}>{tCommon("cancel")}</Button>
            <Button onClick={onConfirm} disabled={isPending || !confirmMontant}>
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
