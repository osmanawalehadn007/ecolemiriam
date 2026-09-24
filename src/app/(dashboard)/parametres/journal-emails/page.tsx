"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
  Mail, MailCheck, MailX, MailOpen, AlertTriangle, Search,
  ChevronLeft, ChevronRight, Filter, Clock, Send, RefreshCw,
} from "lucide-react";
import { getEmailLogs, getEmailStats, resendVerificationEmail } from "@/lib/actions/parametres";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

interface EmailLogItem {
  id: string;
  email: string;
  type: string;
  subject: string;
  status: string;
  resendEmailId: string | null;
  errorMessage: string | null;
  bounceReason: string | null;
  sentAt: Date | null;
  deliveredAt: Date | null;
  bouncedAt: Date | null;
  openedAt: Date | null;
  createdAt: Date;
  user: { id: string; name: string; emailVerified: Date | null } | null;
}

interface EmailStats {
  total: number;
  sent: number;
  delivered: number;
  bounced: number;
  failed: number;
  opened: number;
  complained: number;
}

const statusConfig: Record<string, { color: string; icon: typeof Mail; labelKey: string }> = {
  PENDING: { color: "bg-gray-100 text-gray-600", icon: Clock, labelKey: "emailStatusPending" },
  SENT: { color: "bg-blue-100 text-blue-700", icon: Send, labelKey: "emailStatusSent" },
  DELIVERED: { color: "bg-green-100 text-green-700", icon: MailCheck, labelKey: "emailStatusDelivered" },
  BOUNCED: { color: "bg-red-100 text-red-700", icon: MailX, labelKey: "emailStatusBounced" },
  FAILED: { color: "bg-red-100 text-red-700", icon: MailX, labelKey: "emailStatusFailed" },
  COMPLAINED: { color: "bg-orange-100 text-orange-700", icon: AlertTriangle, labelKey: "emailStatusComplained" },
  OPENED: { color: "bg-purple-100 text-purple-700", icon: MailOpen, labelKey: "emailStatusOpened" },
  DELIVERY_DELAYED: { color: "bg-amber-100 text-amber-700", icon: Clock, labelKey: "emailStatusDelayed" },
};

const typeLabels: Record<string, string> = {
  VERIFICATION: "Vérification",
  PASSWORD_RESET: "Réinit. mot de passe",
  NOTIFICATION: "Notification",
  ADMISSION: "Admission",
  RELANCE: "Relance",
  AUTRE: "Autre",
};

export default function EmailJournalPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const t = useTranslations("parametres");
  const [logs, setLogs] = useState<EmailLogItem[]>([]);
  const [stats, setStats] = useState<EmailStats | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ status: "", type: "", email: "" });
  const [resendingId, setResendingId] = useState<string | null>(null);
  const limit = 50;

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [logsResult, statsResult] = await Promise.all([
        getEmailLogs({
          status: filters.status || undefined,
          type: filters.type || undefined,
          email: filters.email || undefined,
          limit,
          offset: (page - 1) * limit,
        }),
        getEmailStats(),
      ]);
      setLogs(logsResult.logs as EmailLogItem[]);
      setTotal(logsResult.total);
      setStats(statsResult);
    } catch (err) {
      console.error("Email journal fetch error:", err);
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setLoading(false);
    }
  }, [page, filters]);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
      return;
    }
    if (status === "loading") return;
    const role = session?.user?.role;
    if (role !== "SUPER_ADMIN" && role !== "TENANT_ADMIN") {
      router.push("/dashboard");
      return;
    }
    fetchData();
  }, [status, session, router, fetchData]);

  const handleFilterSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchData();
  };

  async function handleResend(userId: string) {
    setResendingId(userId);
    try {
      const result = await resendVerificationEmail(userId);
      if (result.success) {
        toast.success(t("emailResent"));
        fetchData();
      } else {
        toast.error(result.error ?? t("emailResentFailed"));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("emailResentFailed"));
    } finally {
      setResendingId(null);
    }
  }

  const totalPages = Math.ceil(total / limit);

  if (status === "loading" || loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Mail className="w-8 h-8 text-blue-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t("emailJournalTitle")}</h1>
            <p className="text-sm text-gray-500">{t("emailJournalSubtitle")}</p>
          </div>
        </div>
        <button
          onClick={() => fetchData()}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border rounded-lg hover:bg-gray-50 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          {t("refresh")}
        </button>
      </div>

      {/* Stats cards */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
          <StatCard label={t("emailStatTotal")} value={stats.total} icon={Mail} color="text-gray-600" />
          <StatCard label={t("emailStatSent")} value={stats.sent} icon={Send} color="text-blue-600" />
          <StatCard label={t("emailStatDelivered")} value={stats.delivered} icon={MailCheck} color="text-green-600" />
          <StatCard label={t("emailStatOpened")} value={stats.opened} icon={MailOpen} color="text-purple-600" />
          <StatCard label={t("emailStatBounced")} value={stats.bounced} icon={MailX} color="text-red-600" />
          <StatCard label={t("emailStatFailed")} value={stats.failed} icon={MailX} color="text-red-600" />
          <StatCard label={t("emailStatComplained")} value={stats.complained} icon={AlertTriangle} color="text-orange-600" />
        </div>
      )}

      {/* Filters */}
      <form onSubmit={handleFilterSubmit} className="bg-white rounded-xl border p-4 mb-6">
        <div className="flex items-center gap-2 mb-3 text-gray-700 font-medium">
          <Filter className="w-4 h-4" />
          {t("filters")}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <select
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            className="px-3 py-2 border rounded-lg text-sm"
          >
            <option value="">{t("allStatuses")}</option>
            <option value="PENDING">{t("emailStatusPending")}</option>
            <option value="SENT">{t("emailStatusSent")}</option>
            <option value="DELIVERED">{t("emailStatusDelivered")}</option>
            <option value="BOUNCED">{t("emailStatusBounced")}</option>
            <option value="FAILED">{t("emailStatusFailed")}</option>
            <option value="COMPLAINED">{t("emailStatusComplained")}</option>
            <option value="OPENED">{t("emailStatusOpened")}</option>
            <option value="DELIVERY_DELAYED">{t("emailStatusDelayed")}</option>
          </select>
          <select
            value={filters.type}
            onChange={(e) => setFilters({ ...filters, type: e.target.value })}
            className="px-3 py-2 border rounded-lg text-sm"
          >
            <option value="">{t("allTypes")}</option>
            <option value="VERIFICATION">{t("emailTypeVerification")}</option>
            <option value="PASSWORD_RESET">{t("emailTypePasswordReset")}</option>
            <option value="NOTIFICATION">{t("emailTypeNotification")}</option>
            <option value="ADMISSION">{t("emailTypeAdmission")}</option>
            <option value="RELANCE">{t("emailTypeRelance")}</option>
            <option value="AUTRE">{t("emailTypeAutre")}</option>
          </select>
          <input
            type="text"
            placeholder={t("searchEmail")}
            value={filters.email}
            onChange={(e) => setFilters({ ...filters, email: e.target.value })}
            className="px-3 py-2 border rounded-lg text-sm"
          />
        </div>
        <button
          type="submit"
          className="mt-3 flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
        >
          <Search className="w-4 h-4" />
          {t("filter")}
        </button>
      </form>

      {/* Table */}
      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">{t("emailColDate")}</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">{t("emailColRecipient")}</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">{t("emailColType")}</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">{t("emailColSubject")}</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">{t("emailColStatus")}</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">{t("emailColError")}</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">{t("emailColActions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-gray-400">
                    {t("noEmailLogs")}
                  </td>
                </tr>
              ) : (
                logs.map((log) => {
                  const cfg = statusConfig[log.status] ?? statusConfig.PENDING;
                  const StatusIcon = cfg.icon;
                  return (
                    <tr key={log.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                        {new Date(log.createdAt).toLocaleString("fr-FR")}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col">
                          <span className="text-gray-900">{log.email}</span>
                          {log.user && (
                            <span className="text-xs text-gray-400">
                              {log.user.name}
                              {log.user.emailVerified && " ✓"}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-600 text-xs">
                        {typeLabels[log.type] ?? log.type}
                      </td>
                      <td className="px-4 py-3 text-gray-600 max-w-xs truncate">
                        {log.subject}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>
                          <StatusIcon className="w-3 h-3" />
                          {t(cfg.labelKey)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 max-w-xs truncate text-xs">
                        {log.errorMessage ?? log.bounceReason ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        {log.type === "VERIFICATION" && log.user && !log.user.emailVerified &&
                         (log.status === "BOUNCED" || log.status === "FAILED") && (
                          <button
                            onClick={() => handleResend(log.user!.id)}
                            disabled={resendingId === log.user!.id}
                            className="flex items-center gap-1 px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded disabled:opacity-40"
                          >
                            {resendingId === log.user!.id ? (
                              <RefreshCw className="w-3 h-3 animate-spin" />
                            ) : (
                              <Send className="w-3 h-3" />
                            )}
                            {t("resendEmail")}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t">
            <p className="text-sm text-gray-500">
              {t("page")} {page} {t("on")} {totalPages} — {total} {t("entries")}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="flex items-center gap-1 px-3 py-1.5 text-sm border rounded-lg disabled:opacity-40 hover:bg-gray-50"
              >
                <ChevronLeft className="w-4 h-4" />
                {t("previous")}
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="flex items-center gap-1 px-3 py-1.5 text-sm border rounded-lg disabled:opacity-40 hover:bg-gray-50"
              >
                {t("next")}
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, icon: Icon, color }: { label: string; value: number; icon: typeof Mail; color: string }) {
  return (
    <div className="bg-white rounded-xl border p-3">
      <div className="flex items-center gap-2 text-gray-600 text-xs">
        <Icon className={`w-3.5 h-3.5 ${color}`} />
        {label}
      </div>
      <p className="text-xl font-bold mt-1">{value}</p>
    </div>
  );
}
