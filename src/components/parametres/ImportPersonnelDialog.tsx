"use client";

/**
 * Import du personnel (staff non-enseignant) en deux temps :
 * 1. Analyse du fichier → plan
 * 2. Confirmation → création des comptes + envoi d'emails
 */

import { useState, useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Loader2, Upload, FileSpreadsheet, CheckCircle2, AlertTriangle,
  X, ArrowLeft, Ban, RefreshCw, Plus, Download,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

type Action = "CREER" | "IGNORER";

type Verdict =
  | "NOUVEAU" | "EMAIL_EXISTANT" | "SITE_INCONNU" | "ROLE_INCONNU" | "ERREUR";

interface LignePlan {
  ligne: number;
  nom: string;
  email: string;
  telephone?: string;
  site: string;
  role: string;
  fonction?: string;
  verdict: Verdict;
  message: string;
  action: Action;
}

interface PlanImport {
  hash: string;
  lignes: LignePlan[];
  resume: {
    total: number;
    aCreer: number;
    aIgnorer: number;
    erreurs: number;
    sitesInconnus: number;
    rolesInconnus: number;
  };
  dejaImporte?: { date: string; par: string | null };
  sitesInconnus: string[];
  rolesInconnus: string[];
}

interface ImportSummary {
  totalRows: number;
  created: number;
  skipped: number;
  warnings?: string[];
  importBatchId?: string;
}

const VERDICT_STYLE: Record<Verdict, { label: string; classe: string }> = {
  NOUVEAU: { label: "Nouveau", classe: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300" },
  EMAIL_EXISTANT: { label: "Email connu", classe: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300" },
  SITE_INCONNU: { label: "Site inconnu", classe: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300" },
  ROLE_INCONNU: { label: "Rôle inconnu", classe: "bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-300" },
  ERREUR: { label: "Non importable", classe: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300" },
};

const ACTION_LABEL: Record<Action, string> = {
  CREER: "Créer",
  IGNORER: "Ignorer",
};

interface ImportPersonnelDialogProps {
  onClose: () => void;
  onImported?: () => void;
}

export function ImportPersonnelDialog({ onClose, onImported }: ImportPersonnelDialogProps) {
  const t = useTranslations("importPersonnel");
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [plan, setPlan] = useState<PlanImport | null>(null);
  const [decisions, setDecisions] = useState<Record<number, Action>>({});
  const [busy, setBusy] = useState<"analyse" | "import" | null>(null);
  const [result, setResult] = useState<ImportSummary | null>(null);
  const [seulementProblemes, setSeulementProblemes] = useState(true);

  const actionDe = (l: LignePlan): Action => decisions[l.ligne] ?? l.action;

  const compte = plan
    ? plan.lignes.reduce(
        (acc, l) => {
          acc[actionDe(l)]++;
          return acc;
        },
        { CREER: 0, IGNORER: 0 } as Record<Action, number>,
      )
    : { CREER: 0, IGNORER: 0 };

  async function analyser() {
    if (!file) return;
    setBusy("analyse");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/import/personnel/analyze", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Analyse impossible");
      setPlan(data);
      setDecisions({});
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Analyse impossible");
    } finally {
      setBusy(null);
    }
  }

  async function confirmer() {
    if (!file || !plan) return;
    setBusy("import");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("hash", plan.hash);
      fd.append("decisions", JSON.stringify(decisions));
      const res = await fetch("/api/import/personnel", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import impossible");
      setResult(data.summary);
      setPlan(null);
      toast.success(t("success"));
      onImported?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import impossible");
    } finally {
      setBusy(null);
    }
  }

  function choisirFichier(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (!selected) return;
    const ext = selected.name.split(".").pop()?.toLowerCase();
    if (ext !== "xlsx" && ext !== "xls") {
      toast.error(t("invalidFormat"));
      return;
    }
    setFile(selected);
    setPlan(null);
    setResult(null);
  }

  const lignesAffichees = plan
    ? seulementProblemes
      ? plan.lignes.filter((l) => l.verdict !== "NOUVEAU")
      : plan.lignes
    : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <Card
        className={cn("w-full flex flex-col max-h-[90vh]", plan ? "max-w-3xl" : "max-w-lg")}
        onClick={(e) => e.stopPropagation()}
      >
        <CardContent className="p-6 space-y-4 overflow-y-auto">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" />
              {plan ? t("reviewTitle") : t("title")}
            </h2>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Étape 1 : choix du fichier */}
          {!plan && !result && (
            <>
              <p className="text-sm text-muted-foreground">
                {t("description")}
              </p>

              <div className="rounded-lg border bg-muted/50 p-3 text-xs space-y-1">
                <p className="font-semibold">{t("expectedFormat")}</p>
                <p className="text-muted-foreground">{t("columns")}</p>
                <p className="text-muted-foreground">{t("roleFormat")}</p>
              </div>

              {/* Bouton de téléchargement du modèle */}
              <div className="flex justify-end">
                <a
                  href="/api/import/personnel/template"
                  className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
                >
                  <Download className="h-3.5 w-3.5" />
                  {t("downloadTemplate")}
                </a>
              </div>

              <div
                className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => fileRef.current?.click()}
              >
                <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={choisirFichier} />
                {file ? (
                  <div className="flex items-center justify-center gap-2 text-sm">
                    <FileSpreadsheet className="h-5 w-5 text-green-600" />
                    <span className="font-medium">{file.name}</span>
                    <span className="text-muted-foreground">({(file.size / 1024).toFixed(0)} KB)</span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <Upload className="h-8 w-8" />
                    <p className="text-sm">{t("dropzone")}</p>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Étape 2 : le plan */}
          {plan && (
            <>
              {plan.dejaImporte && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/40 p-3 text-xs">
                  <RefreshCw className="h-4 w-4 shrink-0 mt-0.5 text-amber-700 dark:text-amber-400" />
                  <div>
                    <p className="font-semibold text-amber-900 dark:text-amber-300">{t("alreadyImported")}</p>
                    <p className="text-amber-800 dark:text-amber-400">
                      {new Date(plan.dejaImporte.date).toLocaleString("fr-FR")}
                      {plan.dejaImporte.par ? ` — ${plan.dejaImporte.par}` : ""}
                    </p>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-4 gap-2">
                {[
                  { n: compte.CREER, l: t("toCreate"), i: Plus, c: "text-green-600" },
                  { n: compte.IGNORER, l: t("ignored"), i: Ban, c: "text-muted-foreground" },
                  { n: plan.resume.erreurs, l: t("errors"), i: AlertTriangle, c: "text-destructive" },
                  { n: plan.resume.sitesInconnus, l: t("unknownSites"), i: AlertTriangle, c: "text-red-600" },
                ].map((s) => (
                  <div key={s.l} className="rounded-lg border p-2.5 text-center">
                    <s.i className={cn("h-4 w-4 mx-auto mb-1", s.c)} />
                    <p className="text-lg font-bold leading-none">{s.n}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{s.l}</p>
                  </div>
                ))}
              </div>

              {plan.sitesInconnus.length > 0 && (
                <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/30 p-3 text-xs">
                  <p className="font-semibold text-red-900 dark:text-red-300">{t("unknownSites")}</p>
                  <p className="text-red-800 dark:text-red-400">{plan.sitesInconnus.join(", ")}</p>
                </div>
              )}

              {plan.rolesInconnus.length > 0 && (
                <div className="rounded-lg border border-orange-200 bg-orange-50 dark:bg-orange-950/30 p-3 text-xs">
                  <p className="font-semibold text-orange-900 dark:text-orange-300">{t("unknownRoles")}</p>
                  <p className="text-orange-800 dark:text-orange-400">{plan.rolesInconnus.join(", ")}</p>
                </div>
              )}

              <div className="flex items-center justify-between">
                <p className="text-xs font-medium">
                  {lignesAffichees.length} {t("rowsShown")}
                </p>
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={seulementProblemes}
                    onChange={(e) => setSeulementProblemes(e.target.checked)}
                    className="rounded"
                  />
                  {t("hideNew")}
                </label>
              </div>

              <div className="border rounded-lg divide-y max-h-80 overflow-y-auto">
                {lignesAffichees.length === 0 ? (
                  <p className="p-4 text-center text-xs text-muted-foreground">
                    {t("noIssues")}
                  </p>
                ) : (
                  lignesAffichees.map((l) => {
                    const style = VERDICT_STYLE[l.verdict];
                    const action = actionDe(l);
                    return (
                      <div key={l.ligne} className="p-2.5 flex items-start gap-3 text-xs">
                        <span className="text-muted-foreground w-8 shrink-0 pt-0.5">L{l.ligne}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium">
                              {l.nom}
                              {l.email && <span className="text-muted-foreground font-normal"> · {l.email}</span>}
                            </span>
                            <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", style.classe)}>
                              {style.label}
                            </span>
                          </div>
                          <p className="text-muted-foreground mt-0.5">{l.message}</p>
                          <p className="text-muted-foreground mt-0.5">
                            {t("role")}: {l.role} · {t("site")}: {l.site}
                          </p>
                        </div>
                        {l.verdict !== "ERREUR" && l.verdict !== "EMAIL_EXISTANT" && l.verdict !== "SITE_INCONNU" && l.verdict !== "ROLE_INCONNU" && (
                          <select
                            value={action}
                            onChange={(e) =>
                              setDecisions((d) => ({ ...d, [l.ligne]: e.target.value as Action }))
                            }
                            className="h-7 rounded border border-input bg-background px-1.5 text-[11px] shrink-0"
                          >
                            <option value="CREER">{ACTION_LABEL.CREER}</option>
                            <option value="IGNORER">{ACTION_LABEL.IGNORER}</option>
                          </select>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}

          {/* Étape 3 : le résultat */}
          {result && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {[
                  { n: result.created, l: t("created"), c: "text-green-600" },
                  { n: result.skipped, l: t("skipped"), c: "text-muted-foreground" },
                ].map((s) => (
                  <div key={s.l} className="rounded-lg border p-3 text-center">
                    <p className={cn("text-xl font-bold", s.c)}>{s.n}</p>
                    <p className="text-xs text-muted-foreground">{s.l}</p>
                  </div>
                ))}
              </div>
              {result.warnings && result.warnings.length > 0 && (
                <div className="rounded-lg border border-orange-200 bg-orange-50 dark:bg-orange-950/30 p-3 text-xs space-y-1 max-h-32 overflow-y-auto">
                  {result.warnings.map((w, i) => (
                    <p key={i} className="text-orange-800 dark:text-orange-300">{w}</p>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2 rounded-lg border p-3 text-xs">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <span className="text-green-700 dark:text-green-400">{t("importDone")}</span>
              </div>
            </div>
          )}
        </CardContent>

        {/* Actions */}
        <div className="flex gap-2 justify-between items-center border-t p-4">
          {plan ? (
            <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setPlan(null)}>
              <ArrowLeft className="h-4 w-4" />
              {t("changeFile")}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>{t("close")}</Button>
            {!plan && !result && (
              <Button size="sm" className="gap-2" onClick={analyser} disabled={!file || busy !== null}>
                {busy === "analyse" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {t("analyze")}
              </Button>
            )}
            {plan && (
              <Button
                size="sm"
                className="gap-2"
                onClick={confirmer}
                disabled={busy !== null || compte.CREER === 0}
              >
                {busy === "import" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                {t("confirm")} ({compte.CREER})
              </Button>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
