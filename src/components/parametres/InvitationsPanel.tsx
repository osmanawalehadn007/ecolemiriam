"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Loader2, Mail, Plus, RefreshCw, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createInvitation,
  getTenantInvitations,
  resendInvitation,
  revokeInvitation,
} from "@/lib/actions/invitations";
import type { InvitableRole } from "@/lib/invitations";

interface SiteItem {
  id: string;
  nom: string;
  code: string | null;
}

interface InvitationRow {
  id: string;
  email: string;
  name: string | null;
  role: string;
  status: string;
  expiresAt: Date;
  createdAt: Date;
  siteId: string | null;
}

/** Rôles qu'un administrateur peut attribuer par invitation. */
const INVITABLE_ROLES: { value: string; labelKey: string }[] = [
  { value: "TENANT_ADMIN", labelKey: "roleTenantAdmin" },
  { value: "PRINCIPAL", labelKey: "rolePrincipal" },
  { value: "SECRETARY", labelKey: "roleSecretary" },
  { value: "TEACHER", labelKey: "roleTeacher" },
  { value: "CLASS_TEACHER", labelKey: "roleClassTeacher" },
  { value: "COUNSELOR", labelKey: "roleCounselor" },
  { value: "NURSE", labelKey: "roleNurse" },
  { value: "ACCOUNTANT", labelKey: "roleAccountant" },
  { value: "PARENT", labelKey: "roleParent" },
];

export function InvitationsPanel({
  canManage,
  sites = [],
}: {
  canManage: boolean;
  sites?: SiteItem[];
}) {
  const t = useTranslations("invitation");
  const tp = useTranslations("parametres");

  const [rows, setRows] = useState<InvitationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [pending, setPending] = useState(false);
  const [fallbackLink, setFallbackLink] = useState<string | null>(null);
  const [form, setForm] = useState<{ email: string; name: string; role: InvitableRole; siteId: string }>({
    email: "",
    name: "",
    role: "TEACHER",
    siteId: "",
  });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getTenantInvitations();
      setRows(data as InvitationRow[]);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (canManage) void refresh();
  }, [canManage, refresh]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.email || !form.name) return;
    setPending(true);
    setFallbackLink(null);
    try {
      const result = await createInvitation({
        email: form.email,
        name: form.name,
        role: form.role,
        siteId: form.siteId || null,
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(t("invited"));
      setFallbackLink(result.inviteUrl ?? null);
      setForm({ email: "", name: "", role: "TEACHER", siteId: "" });
      setShowForm(false);
      await refresh();
    } finally {
      setPending(false);
    }
  }

  async function handleResend(id: string) {
    const result = await resendInvitation(id);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    setFallbackLink(result.inviteUrl ?? null);
    toast.success(t("resent"));
    await refresh();
  }

  async function handleRevoke(id: string) {
    if (typeof window !== "undefined" && !window.confirm(t("revokeConfirm"))) return;
    const result = await revokeInvitation(id);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success(t("revoked"));
    await refresh();
  }

  function statusLabel(row: InvitationRow): string {
    if (row.status === "PENDING") {
      return new Date(row.expiresAt).getTime() <= Date.now()
        ? t("statusExpired")
        : t("statusPending");
    }
    if (row.status === "ACCEPTED") return t("statusAccepted");
    if (row.status === "REVOKED") return t("statusRevoked");
    return row.status;
  }

  if (!canManage) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Mail className="h-4 w-4 text-primary" />
            {t("panelTitle")}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">{t("panelIntro")}</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button size="sm" variant="ghost" onClick={() => void refresh()} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
          <Button
            size="sm"
            className="gap-2"
            data-testid="open-invite"
            onClick={() => setShowForm((v) => !v)}
          >
            <Plus className="h-4 w-4" />
            {t("inviteButton")}
          </Button>
        </div>
      </div>

      {fallbackLink && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-1">
          <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
            {t("emailNotSent")}
          </p>
          <input
            readOnly
            value={fallbackLink}
            data-testid="invite-link"
            onFocus={(e) => e.currentTarget.select()}
            className="w-full text-xs font-mono rounded border border-amber-300 bg-white dark:bg-slate-900 px-2 py-1"
          />
        </div>
      )}

      {showForm && (
        <form
          onSubmit={handleCreate}
          className="grid grid-cols-1 md:grid-cols-4 gap-3 rounded-lg border p-3"
        >
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="invite-form-email">{t("colEmail")} *</Label>
            <Input
              id="invite-form-email"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="prof@ecole.com"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-form-name">{t("name")} *</Label>
            <Input
              id="invite-form-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-form-role">{t("colRole")}</Label>
            <select
              id="invite-form-role"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as InvitableRole })}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {INVITABLE_ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {tp(r.labelKey)}
                </option>
              ))}
            </select>
          </div>
          {sites.length > 0 && (
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="invite-form-site">{t("site")}</Label>
              <select
                id="invite-form-site"
                value={form.siteId}
                onChange={(e) => setForm({ ...form, siteId: e.target.value })}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">{t("allSites")}</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nom}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="md:col-span-4 flex gap-2">
            <Button
              type="submit"
              size="sm"
              className="gap-2"
              data-testid="send-invitation"
              disabled={pending}
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {pending ? t("sending") : t("send")}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setShowForm(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </form>
      )}

      <div className="rounded-lg border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-b">
            <tr>
              <th className="text-left px-3 py-2 font-medium">{t("colEmail")}</th>
              <th className="text-left px-3 py-2 font-medium">{t("colRole")}</th>
              <th className="text-left px-3 py-2 font-medium">{t("colStatus")}</th>
              <th className="text-left px-3 py-2 font-medium">{t("colExpires")}</th>
              <th className="text-right px-3 py-2 font-medium">{t("colActions")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center py-6 text-muted-foreground">
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin inline" />
                  ) : (
                    t("noInvitations")
                  )}
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const isPending = row.status === "PENDING";
                return (
                  <tr key={row.id} className="border-b last:border-0">
                    <td className="px-3 py-2">
                      <div className="font-medium">{row.name ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">{row.email}</div>
                    </td>
                    <td className="px-3 py-2 text-xs">{row.role}</td>
                    <td className="px-3 py-2 text-xs">{statusLabel(row)}</td>
                    <td className="px-3 py-2 text-xs">
                      {new Date(row.expiresAt).toLocaleDateString("fr-FR")}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {isPending && (
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs gap-1"
                            onClick={() => void handleResend(row.id)}
                          >
                            <RefreshCw className="h-3 w-3" />
                            {t("resend")}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs gap-1 text-destructive"
                            onClick={() => void handleRevoke(row.id)}
                          >
                            <X className="h-3 w-3" />
                            {t("revoke")}
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
