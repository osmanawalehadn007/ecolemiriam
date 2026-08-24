"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Loader2, Upload, Trash2, CalendarX, Plus, FileSpreadsheet, X, CheckCircle2, AlertCircle,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { getEnseignantsWithAffectations } from "@/lib/actions/parametres";

interface EnseignantOption {
  id: string;
  user: { name: string | null; email: string | null };
}

interface IndispoRow {
  id: string;
  jour: string;
  heureDebut: string;
  heureFin: string;
  source: string;
  note: string | null;
  enseignant: { user: { name: string | null } };
}

interface PlanLigne {
  ligne: number;
  enseignantNom: string;
  enseignantEmail?: string;
  jour: string;
  heureDebut: string;
  heureFin: string;
  note?: string;
  enseignantId: string | null;
  statut: "OK" | "IGNORER" | "ERREUR";
  raison: string;
}

interface PlanImport {
  hash: string;
  lignes: PlanLigne[];
  total: number;
  ok: number;
  erreurs: number;
  ignores: number;
}

const JOURS = ["DIMANCHE", "LUNDI", "MARDI", "MERCREDI", "JEUDI", "VENDREDI", "SAMEDI"];

export function EdtPersonnelsTab({ canManage }: { canManage: boolean }) {
  const t = useTranslations("parametres");
  const [indispos, setIndispos] = useState<IndispoRow[]>([]);
  const [enseignants, setEnseignants] = useState<EnseignantOption[]>([]);
  const [loading, setLoading] = useState(true);

  // Formulaire d'ajout manuel
  const [ensId, setEnsId] = useState("");
  const [jour, setJour] = useState("LUNDI");
  const [debut, setDebut] = useState("08:00");
  const [fin, setFin] = useState("12:00");
  const [note, setNote] = useState("");
  const [isPending, setIsPending] = useState(false);

  // Import
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importPlan, setImportPlan] = useState<PlanImport | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [indRes, ensList] = await Promise.all([
        fetch("/api/indisponibilites"),
        getEnseignantsWithAffectations(),
      ]);
      if (indRes.ok) setIndispos(await indRes.json());
      setEnseignants(
        ensList.map((e: any) => ({ id: e.id, user: { name: e.user?.name ?? null, email: e.user?.email ?? null } }))
      );
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleAdd() {
    if (!ensId) {
      toast.error("Sélectionnez un enseignant");
      return;
    }
    setIsPending(true);
    try {
      const res = await fetch("/api/indisponibilites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enseignantId: ensId, jour, heureDebut: debut, heureFin: fin, note: note || undefined }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Erreur");
      }
      toast.success("Indisponibilité ajoutée");
      setNote("");
      await loadData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setIsPending(false);
    }
  }

  async function handleDelete(id: string) {
    setIsPending(true);
    try {
      const res = await fetch(`/api/indisponibilites/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Erreur");
      }
      toast.success("Indisponibilité supprimée");
      await loadData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setIsPending(false);
    }
  }

  async function handleAnalyze() {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      toast.error("Sélectionnez un fichier");
      return;
    }
    setImporting(true);
    setImportFile(file);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/import/indisponibilites/analyze", {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Erreur lors de l'analyse");
      }
      setImportPlan(data);
      if (data.erreurs > 0) {
        toast.warning(`${data.ok} lignes valides, ${data.erreurs} en erreur`);
      } else {
        toast.success(`${data.ok} lignes prêtes à importer`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setImporting(false);
    }
  }

  async function handleConfirmImport() {
    if (!importFile || !importPlan) return;
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append("file", importFile);
      fd.append("hash", importPlan.hash);
      const res = await fetch("/api/import/indisponibilites", {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Erreur lors de l'import");
      }
      toast.success(data.message || "Import réussi");
      setImportPlan(null);
      setImportFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await loadData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setImporting(false);
    }
  }

  function cancelImport() {
    setImportPlan(null);
    setImportFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md bg-blue-50 border border-blue-200 p-3 text-sm text-blue-800">
        <strong>{t("edtPersonnelsTitle")}</strong> — {t("edtPersonnelsDesc")}
      </div>

      {/* Section import */}
      {canManage && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4" />
              {t("edtPersonnelsImport")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-3">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                className="text-sm file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:bg-primary file:text-primary-foreground file:cursor-pointer"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={handleAnalyze}
                disabled={importing}
              >
                {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Upload className="h-3.5 w-3.5 mr-1.5" />}
                {t("edtPersonnelsAnalyze")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("edtPersonnelsFormat")}
            </p>

            {importPlan && (
              <div className="space-y-3 rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <div className="flex gap-3 text-sm">
                    <Badge variant="success" className="gap-1">
                      <CheckCircle2 className="h-3 w-3" />
                      {importPlan.ok} {t("edtPersonnelsValid")}
                    </Badge>
                    {importPlan.erreurs > 0 && (
                      <Badge variant="destructive" className="gap-1">
                        <AlertCircle className="h-3 w-3" />
                        {importPlan.erreurs} {t("edtPersonnelsErrors")}
                      </Badge>
                    )}
                  </div>
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={cancelImport}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>

                <div className="max-h-64 overflow-y-auto rounded-md border">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50 sticky top-0">
                      <tr>
                        <th className="text-left p-2 font-medium">#</th>
                        <th className="text-left p-2 font-medium">{t("edtPersonnelsTeacher")}</th>
                        <th className="text-left p-2 font-medium">{t("edtPersonnelsDay")}</th>
                        <th className="text-left p-2 font-medium">{t("edtPersonnelsTime")}</th>
                        <th className="text-left p-2 font-medium">{t("edtPersonnelsStatus")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importPlan.lignes.map((l) => (
                        <tr key={l.ligne} className="border-t">
                          <td className="p-2 text-muted-foreground">{l.ligne}</td>
                          <td className="p-2">{l.enseignantNom}</td>
                          <td className="p-2">{l.jour}</td>
                          <td className="p-2">{l.heureDebut} → {l.heureFin}</td>
                          <td className="p-2">
                            {l.statut === "OK" ? (
                              <span className="text-green-600">{l.raison}</span>
                            ) : (
                              <span className="text-red-600">{l.raison}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {importPlan.ok > 0 && (
                  <div className="flex gap-2">
                    <Button size="sm" onClick={handleConfirmImport} disabled={importing}>
                      {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />}
                      {t("edtPersonnelsConfirm")} ({importPlan.ok})
                    </Button>
                    <Button size="sm" variant="outline" onClick={cancelImport}>
                      {t("edtPersonnelsCancel")}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Section ajout manuel */}
      {canManage && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Plus className="h-4 w-4" />
              {t("edtPersonnelsAdd")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
              <div className="space-y-1.5 md:col-span-2">
                <Label className="text-xs">{t("edtPersonnelsTeacher")}</Label>
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={ensId}
                  onChange={(e) => setEnsId(e.target.value)}
                >
                  <option value="">— {t("edtPersonnelsSelectTeacher")} —</option>
                  {enseignants.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.user.name ?? "Sans nom"} {e.user.email ? `(${e.user.email})` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{t("edtPersonnelsDay")}</Label>
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={jour}
                  onChange={(e) => setJour(e.target.value)}
                >
                  {JOURS.map((j) => (
                    <option key={j} value={j}>{j}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{t("edtPersonnelsStart")}</Label>
                <input
                  type="time"
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={debut}
                  onChange={(e) => setDebut(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{t("edtPersonnelsEnd")}</Label>
                <input
                  type="time"
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={fin}
                  onChange={(e) => setFin(e.target.value)}
                />
              </div>
              <div className="space-y-1.5 md:col-span-4">
                <Label className="text-xs">{t("edtPersonnelsNote")}</Label>
                <input
                  type="text"
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  placeholder={t("edtPersonnelsNotePlaceholder")}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
              <div className="flex items-end">
                <Button size="sm" className="w-full" onClick={handleAdd} disabled={isPending}>
                  {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                  {t("edtPersonnelsAddBtn")}
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              {t("edtPersonnelsFullDay")}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Liste des indisponibilités */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <CalendarX className="h-4 w-4" />
            {t("edtPersonnelsList")} ({indispos.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {indispos.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              {t("edtPersonnelsEmpty")}
            </p>
          ) : (
            <div className="space-y-1.5">
              {indispos.map((ind) => (
                <div
                  key={ind.id}
                  className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
                >
                  <Badge variant="info" className="text-xs">
                    {ind.enseignant.user.name ?? "—"}
                  </Badge>
                  <Badge variant="outline" className="text-xs">
                    {ind.jour}
                  </Badge>
                  <span className="text-xs">
                    {ind.heureDebut} → {ind.heureFin}
                  </span>
                  {ind.note && (
                    <span className="text-xs text-muted-foreground italic">
                      {ind.note}
                    </span>
                  )}
                  <Badge
                    variant={ind.source === "IMPORT" ? "secondary" : "default"}
                    className="text-xs ml-1"
                  >
                    {ind.source === "IMPORT" ? t("edtPersonnelsSourceImport") : t("edtPersonnelsSourceManual")}
                  </Badge>
                  {canManage && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 ml-auto text-destructive"
                      onClick={() => handleDelete(ind.id)}
                      disabled={isPending}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
