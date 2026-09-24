"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  BookOpen, Package, Plus, Pencil, Trash2, Send, CheckCircle2,
  XCircle, Globe, Search, ChevronDown, ChevronRight, Printer,
  Loader2, FileText, ListChecks,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { niveauToLabel } from "@/lib/niveau";

// ---------------------------------------------------------------
// Types
// ---------------------------------------------------------------

type FournitureType = "LIVRE" | "CAHIER" | "INSTRUMENT" | "AUTRE";
type FournitureStatut = "BROUILLON" | "SOUMISE" | "VALIDEE" | "PUBLIEE" | "REJETEE";

interface FournitureItem {
  id?: string;
  nom: string;
  type: FournitureType;
  quantite: number;
  format?: string | null;
  description?: string | null;
  marque?: string | null;
  ordre: number;
}

interface FournitureListe {
  id: string;
  niveau: string;
  annee: string;
  matiereId: string | null;
  matiere?: { id: string; nom: string; code: string } | null;
  enseignant?: { id: string; user: { id: string; name: string } } | null;
  valideePar?: { id: string; name: string } | null;
  statut: FournitureStatut;
  commentaireEnseignant?: string | null;
  commentaireSecretariat?: string | null;
  valideeAt?: string | null;
  publieeAt?: string | null;
  items: FournitureItem[];
  createdAt: string;
  updatedAt: string;
}

interface Matiere {
  id: string;
  nom: string;
  code: string;
}

// ---------------------------------------------------------------
// Configs UI
// ---------------------------------------------------------------

const TYPE_CONFIG: Record<FournitureType, { label: string; icon: typeof BookOpen; color: string }> = {
  LIVRE: { label: "Livre", icon: BookOpen, color: "bg-blue-100 text-blue-700" },
  CAHIER: { label: "Cahier", icon: FileText, color: "bg-amber-100 text-amber-700" },
  INSTRUMENT: { label: "Instrument", icon: Package, color: "bg-purple-100 text-purple-700" },
  AUTRE: { label: "Autre", icon: ListChecks, color: "bg-gray-100 text-gray-600" },
};

const STATUT_CONFIG: Record<FournitureStatut, { label: string; color: string }> = {
  BROUILLON: { label: "Brouillon", color: "bg-gray-100 text-gray-700" },
  SOUMISE: { label: "Soumise", color: "bg-amber-100 text-amber-700" },
  VALIDEE: { label: "Validée", color: "bg-blue-100 text-blue-700" },
  PUBLIEE: { label: "Publiée", color: "bg-emerald-100 text-emerald-700" },
  REJETEE: { label: "Rejetée", color: "bg-red-100 text-red-700" },
};

const EMPTY_ITEM: FournitureItem = {
  nom: "", type: "CAHIER", quantite: 1, format: "", description: "", marque: "", ordre: 0,
};

// ---------------------------------------------------------------
// Composant principal
// ---------------------------------------------------------------

interface FournituresViewProps {
  role: string;
  tenantId: string;
  currentYear: string;
  matieres: Matiere[];
  niveaux: string[];
}

export function FournituresView({ role, currentYear, matieres, niveaux }: FournituresViewProps) {
  const t = useTranslations("fournitures");
  const [listes, setListes] = useState<FournitureListe[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatut, setFilterStatut] = useState<string>("all");
  const [filterNiveau, setFilterNiveau] = useState<string>("all");
  const [expandedListe, setExpandedListe] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<FournitureListe | null>(null);
  const [isPending, startTransition] = useTransition();

  // Formulaire
  const [form, setForm] = useState({
    niveau: "",
    annee: currentYear,
    matiereId: "",
    commentaireEnseignant: "",
    items: [{ ...EMPTY_ITEM }] as FournitureItem[],
  });

  const isReadOnly = role === "PARENT" || role === "STUDENT";
  const canWrite = role === "SUPER_ADMIN" || role === "TENANT_ADMIN" || role === "PRINCIPAL" ||
    role === "SECRETARY" || role === "TEACHER" || role === "CLASS_TEACHER";
  const canValidate = role === "SUPER_ADMIN" || role === "TENANT_ADMIN" || role === "PRINCIPAL" || role === "SECRETARY";
  const canPublish = canValidate;

  const fetchListes = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterNiveau !== "all") params.set("niveau", filterNiveau);
      if (filterStatut !== "all") params.set("statut", filterStatut);
      const res = await fetch(`/api/fournitures?${params}`);
      if (!res.ok) throw new Error("fetch error");
      const data = await res.json();
      setListes(data.listes ?? []);
    } catch {
      toast.error(t("errorFetch"));
    } finally {
      setLoading(false);
    }
  }, [filterNiveau, filterStatut, t]);

  useEffect(() => {
    fetchListes();
  }, [fetchListes]);

  // Filtrage côté client par recherche
  const filteredListes = listes.filter((l) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      l.niveau.toLowerCase().includes(s) ||
      niveauToLabel(l.niveau).toLowerCase().includes(s) ||
      l.annee.toLowerCase().includes(s) ||
      l.matiere?.nom.toLowerCase().includes(s) ||
      l.items.some((i) => i.nom.toLowerCase().includes(s))
    );
  });

  // Groupage par niveau
  const groupedByNiveau = filteredListes.reduce((acc, l) => {
    (acc[l.niveau] ??= []).push(l);
    return acc;
  }, {} as Record<string, FournitureListe[]>);

  function openCreateForm() {
    setEditing(null);
    setForm({
      niveau: niveaux[0] ?? "",
      annee: currentYear,
      matiereId: "",
      commentaireEnseignant: "",
      items: [{ ...EMPTY_ITEM }],
    });
    setShowForm(true);
  }

  function openEditForm(liste: FournitureListe) {
    setEditing(liste);
    setForm({
      niveau: liste.niveau,
      annee: liste.annee,
      matiereId: liste.matiereId ?? "",
      commentaireEnseignant: liste.commentaireEnseignant ?? "",
      items: liste.items.length > 0 ? liste.items.map((i) => ({ ...i })) : [{ ...EMPTY_ITEM }],
    });
    setShowForm(true);
  }

  function addItem() {
    setForm((f) => ({
      ...f,
      items: [...f.items, { ...EMPTY_ITEM, ordre: f.items.length }],
    }));
  }

  function removeItem(idx: number) {
    setForm((f) => ({
      ...f,
      items: f.items.filter((_, i) => i !== idx),
    }));
  }

  function updateItem(idx: number, field: keyof FournitureItem, value: string | number) {
    setForm((f) => ({
      ...f,
      items: f.items.map((it, i) => (i === idx ? { ...it, [field]: value } : it)),
    }));
  }

  async function saveListe() {
    if (!form.niveau) {
      toast.error(t("errorNiveau"));
      return;
    }
    if (form.items.length === 0 || form.items.some((i) => !i.nom.trim())) {
      toast.error(t("errorItems"));
      return;
    }

    startTransition(async () => {
      try {
        const payload = {
          niveau: form.niveau,
          annee: form.annee,
          matiereId: form.matiereId || null,
          commentaireEnseignant: form.commentaireEnseignant || null,
          items: form.items.map((it, idx) => ({
            nom: it.nom,
            type: it.type,
            quantite: it.quantite,
            format: it.format || null,
            description: it.description || null,
            marque: it.marque || null,
            ordre: idx,
          })),
        };

        const res = editing
          ? await fetch(`/api/fournitures/${editing.id}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            })
          : await fetch("/api/fournitures", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "save error");
        }

        toast.success(editing ? t("updated") : t("created"));
        setShowForm(false);
        fetchListes();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("errorSave"));
      }
    });
  }

  async function deleteListe(id: string) {
    if (!confirm(t("confirmDelete"))) return;
    startTransition(async () => {
      try {
        const res = await fetch(`/api/fournitures/${id}`, { method: "DELETE" });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "delete error");
        }
        toast.success(t("deleted"));
        fetchListes();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("errorDelete"));
      }
    });
  }

  async function actionWorkflow(id: string, action: "soumettre" | "valider" | "rejeter" | "publier") {
    let body: BodyInit | undefined;
    if (action === "rejeter") {
      const raison = prompt(t("promptRejet"));
      if (!raison) return;
      body = JSON.stringify({ raison });
    }

    startTransition(async () => {
      try {
        const res = await fetch(`/api/fournitures/${id}/${action}`, {
          method: "POST",
          headers: action === "rejeter" ? { "Content-Type": "application/json" } : undefined,
          body,
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "action error");
        }
        toast.success(t(`action_${action}`));
        fetchListes();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("errorAction"));
      }
    });
  }

  function printListe(liste: FournitureListe) {
    const printWindow = window.open("", "_blank", "width=800,height=600");
    if (!printWindow) return;

    const itemsHtml = liste.items.map((item, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${item.nom}${item.format ? ` <span class="format">(${item.format})</span>` : ""}</td>
        <td>${TYPE_CONFIG[item.type].label}</td>
        <td class="qty">${item.quantite}</td>
        <td>${item.marque ?? ""}</td>
      </tr>
    `).join("");

    printWindow.document.write(`<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <title>${t("printTitle")} — ${niveauToLabel(liste.niveau)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; padding: 40px; color: #1e293b; }
    h1 { font-size: 24px; color: #4f46e5; margin-bottom: 4px; }
    h2 { font-size: 16px; font-weight: 400; color: #64748b; margin-bottom: 24px; }
    .info { display: flex; gap: 32px; margin-bottom: 24px; padding: 16px; background: #f1f5f9; border-radius: 8px; }
    .info div { font-size: 14px; }
    .info strong { color: #475569; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; }
    th { text-align: left; padding: 10px 12px; background: #4f46e5; color: white; font-size: 13px; }
    td { padding: 10px 12px; border-bottom: 1px solid #e2e8f0; font-size: 14px; }
    .qty { text-align: center; font-weight: 600; }
    .format { color: #64748b; font-size: 12px; }
    .footer { margin-top: 40px; font-size: 12px; color: #94a3b8; text-align: center; }
    @media print { body { padding: 20px; } }
  </style>
</head>
<body>
  <h1>${t("printTitle")}</h1>
  <h2>${liste.annee}</h2>
  <div class="info">
    <div><strong>${t("niveau")}:</strong> ${niveauToLabel(liste.niveau)}</div>
    ${liste.matiere ? `<div><strong>${t("matiere")}:</strong> ${liste.matiere.nom}</div>` : ""}
  </div>
  <table>
    <thead>
      <tr><th>#</th><th>${t("itemNom")}</th><th>${t("itemType")}</th><th>${t("itemQuantite")}</th><th>${t("itemMarque")}</th></tr>
    </thead>
    <tbody>${itemsHtml}</tbody>
  </table>
  <div class="footer">${t("printFooter")}</div>
  <script>window.print();</script>
</body>
</html>`);
    printWindow.document.close();
  }

  // ---------------------------------------------------------------
  // Rendu
  // ---------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* Barre d'outils */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            placeholder={t("searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        {!isReadOnly && (
          <Select value={filterStatut} onValueChange={setFilterStatut}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder={t("filterStatut")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("allStatuses")}</SelectItem>
              <SelectItem value="BROUILLON">{t("statutBrouillon")}</SelectItem>
              <SelectItem value="SOUMISE">{t("statutSoumise")}</SelectItem>
              <SelectItem value="VALIDEE">{t("statutValidee")}</SelectItem>
              <SelectItem value="PUBLIEE">{t("statutPubliee")}</SelectItem>
              <SelectItem value="REJETEE">{t("statutRejetee")}</SelectItem>
            </SelectContent>
          </Select>
        )}
        <Select value={filterNiveau} onValueChange={setFilterNiveau}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder={t("filterNiveau")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("allNiveaux")}</SelectItem>
            {niveaux.map((n) => (
              <SelectItem key={n} value={n}>{niveauToLabel(n)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {canWrite && (
          <Button onClick={openCreateForm} className="gap-2 bg-indigo-600 hover:bg-indigo-700">
            <Plus className="w-4 h-4" />
            {t("newListe")}
          </Button>
        )}
      </div>

      {/* Liste */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
        </div>
      ) : filteredListes.length === 0 ? (
        <div className="text-center py-20 text-slate-400">
          <Package className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>{t("empty")}</p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(groupedByNiveau)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([niveau, listes]) => (
              <div key={niveau} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
                  <h3 className="font-bold text-slate-800 text-lg">{niveauToLabel(niveau)}</h3>
                  <Badge variant="secondary" className="ml-1">{listes.length}</Badge>
                </div>
                <div className="divide-y divide-slate-100">
                  {listes.map((liste) => {
                    const isExpanded = expandedListe === liste.id;
                    const statutCfg = STATUT_CONFIG[liste.statut];
                    return (
                      <div key={liste.id}>
                        <button
                          onClick={() => setExpandedListe(isExpanded ? null : liste.id)}
                          className="w-full flex items-center gap-3 px-5 py-3 hover:bg-slate-50 transition-colors text-left"
                        >
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-slate-400 flex-shrink-0" />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-slate-800">
                                {liste.matiere?.nom ?? t("generalFournitures")}
                              </span>
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statutCfg.color}`}>
                                {statutCfg.label}
                              </span>
                              <span className="text-xs text-slate-400">{liste.annee}</span>
                            </div>
                            <p className="text-sm text-slate-500 mt-0.5">
                              {liste.items.length} {t("itemsCount")}
                              {liste.enseignant && ` · ${liste.enseignant.user.name}`}
                            </p>
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => printListe(liste)}
                              title={t("print")}
                            >
                              <Printer className="w-4 h-4" />
                            </Button>
                          </div>
                        </button>

                        {isExpanded && (
                          <div className="px-5 pb-4 bg-slate-50/50">
                            {/* Items */}
                            <table className="w-full text-sm mt-2">
                              <thead>
                                <tr className="text-left text-slate-500 border-b border-slate-200">
                                  <th className="py-2 pr-3">#</th>
                                  <th className="py-2 pr-3">{t("itemNom")}</th>
                                  <th className="py-2 pr-3">{t("itemType")}</th>
                                  <th className="py-2 pr-3 text-center">{t("itemQuantite")}</th>
                                  <th className="py-2 pr-3">{t("itemFormat")}</th>
                                  <th className="py-2 pr-3">{t("itemMarque")}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {liste.items.map((item, idx) => {
                                  const typeCfg = TYPE_CONFIG[item.type];
                                  const Icon = typeCfg.icon;
                                  return (
                                    <tr key={idx} className="border-b border-slate-100">
                                      <td className="py-2 pr-3 text-slate-400">{idx + 1}</td>
                                      <td className="py-2 pr-3 font-medium text-slate-800">
                                        {item.nom}
                                        {item.description && (
                                          <p className="text-xs text-slate-400 mt-0.5">{item.description}</p>
                                        )}
                                      </td>
                                      <td className="py-2 pr-3">
                                        <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${typeCfg.color}`}>
                                          <Icon className="w-3 h-3" />
                                          {typeCfg.label}
                                        </span>
                                      </td>
                                      <td className="py-2 pr-3 text-center font-semibold">{item.quantite}</td>
                                      <td className="py-2 pr-3 text-slate-600">{item.format ?? "—"}</td>
                                      <td className="py-2 pr-3 text-slate-600">{item.marque ?? "—"}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>

                            {/* Commentaires */}
                            {(liste.commentaireEnseignant || liste.commentaireSecretariat) && (
                              <div className="mt-3 space-y-2">
                                {liste.commentaireEnseignant && (
                                  <p className="text-sm text-slate-600">
                                    <strong>{t("teacherNote")}:</strong> {liste.commentaireEnseignant}
                                  </p>
                                )}
                                {liste.commentaireSecretariat && (
                                  <p className="text-sm text-slate-600">
                                    <strong>{t("secretaryNote")}:</strong> {liste.commentaireSecretariat}
                                  </p>
                                )}
                              </div>
                            )}

                            {/* Actions */}
                            <div className="flex flex-wrap items-center gap-2 mt-4">
                              {canWrite && (liste.statut === "BROUILLON" || liste.statut === "REJETEE") && (
                                <>
                                  <Button size="sm" variant="outline" onClick={() => openEditForm(liste)} className="gap-1.5">
                                    <Pencil className="w-3.5 h-3.5" />
                                    {t("edit")}
                                  </Button>
                                  <Button size="sm" variant="outline" onClick={() => deleteListe(liste.id)} className="gap-1.5 text-red-600 hover:text-red-700">
                                    <Trash2 className="w-3.5 h-3.5" />
                                    {t("delete")}
                                  </Button>
                                  <Button size="sm" onClick={() => actionWorkflow(liste.id, "soumettre")} className="gap-1.5 bg-amber-600 hover:bg-amber-700" disabled={isPending}>
                                    <Send className="w-3.5 h-3.5" />
                                    {t("soumettre")}
                                  </Button>
                                </>
                              )}
                              {canValidate && liste.statut === "SOUMISE" && (
                                <>
                                  <Button size="sm" onClick={() => actionWorkflow(liste.id, "valider")} className="gap-1.5 bg-blue-600 hover:bg-blue-700" disabled={isPending}>
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                    {t("valider")}
                                  </Button>
                                  <Button size="sm" variant="outline" onClick={() => actionWorkflow(liste.id, "rejeter")} className="gap-1.5 text-red-600 hover:text-red-700" disabled={isPending}>
                                    <XCircle className="w-3.5 h-3.5" />
                                    {t("rejeter")}
                                  </Button>
                                </>
                              )}
                              {canPublish && liste.statut === "VALIDEE" && (
                                <Button size="sm" onClick={() => actionWorkflow(liste.id, "publier")} className="gap-1.5 bg-emerald-600 hover:bg-emerald-700" disabled={isPending}>
                                  <Globe className="w-3.5 h-3.5" />
                                  {t("publier")}
                                </Button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
        </div>
      )}

      {/* Dialog création/édition */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? t("editListe") : t("newListe")}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Niveau + Année + Matière */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>{t("niveau")}</Label>
                <Select value={form.niveau} onValueChange={(v) => setForm((f) => ({ ...f, niveau: v }))}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("niveauPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {niveaux.map((n) => (
                      <SelectItem key={n} value={n}>{n}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{t("annee")}</Label>
                <Input
                  value={form.annee}
                  onChange={(e) => setForm((f) => ({ ...f, annee: e.target.value }))}
                  placeholder="2025-2026"
                />
              </div>
              <div>
                <Label>{t("matiere")}</Label>
                <Select value={form.matiereId} onValueChange={(v) => setForm((f) => ({ ...f, matiereId: v }))}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("generalFournitures")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">{t("generalFournitures")}</SelectItem>
                    {matieres.map((m) => (
                      <SelectItem key={m.id} value={m.id}>{m.nom}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Commentaire enseignant */}
            <div>
              <Label>{t("teacherNote")}</Label>
              <Textarea
                value={form.commentaireEnseignant}
                onChange={(e) => setForm((f) => ({ ...f, commentaireEnseignant: e.target.value }))}
                placeholder={t("teacherNotePlaceholder")}
                rows={2}
              />
            </div>

            {/* Items */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label>{t("items")}</Label>
                <Button size="sm" variant="outline" onClick={addItem} className="gap-1.5">
                  <Plus className="w-3.5 h-3.5" />
                  {t("addItem")}
                </Button>
              </div>
              <div className="space-y-2">
                {form.items.map((item, idx) => (
                  <div key={idx} className="flex items-start gap-2 p-3 bg-slate-50 rounded-lg">
                    <div className="flex-1 grid grid-cols-12 gap-2">
                      <div className="col-span-4">
                        <Input
                          placeholder={t("itemNom")}
                          value={item.nom}
                          onChange={(e) => updateItem(idx, "nom", e.target.value)}
                        />
                      </div>
                      <div className="col-span-3">
                        <Select value={item.type} onValueChange={(v) => updateItem(idx, "type", v)}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="LIVRE">{t("typeLivre")}</SelectItem>
                            <SelectItem value="CAHIER">{t("typeCahier")}</SelectItem>
                            <SelectItem value="INSTRUMENT">{t("typeInstrument")}</SelectItem>
                            <SelectItem value="AUTRE">{t("typeAutre")}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="col-span-2">
                        <Input
                          type="number"
                          min={1}
                          placeholder={t("itemQuantite")}
                          value={item.quantite}
                          onChange={(e) => updateItem(idx, "quantite", parseInt(e.target.value) || 1)}
                        />
                      </div>
                      <div className="col-span-3">
                        <Input
                          placeholder={t("itemFormat")}
                          value={item.format ?? ""}
                          onChange={(e) => updateItem(idx, "format", e.target.value)}
                        />
                      </div>
                      <div className="col-span-6">
                        <Input
                          placeholder={t("itemMarque")}
                          value={item.marque ?? ""}
                          onChange={(e) => updateItem(idx, "marque", e.target.value)}
                        />
                      </div>
                      <div className="col-span-6">
                        <Input
                          placeholder={t("itemDescription")}
                          value={item.description ?? ""}
                          onChange={(e) => updateItem(idx, "description", e.target.value)}
                        />
                      </div>
                    </div>
                    {form.items.length > 1 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => removeItem(idx)}
                        className="text-red-600 hover:text-red-700 mt-1"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>
              {t("cancel")}
            </Button>
            <Button onClick={saveListe} disabled={isPending} className="gap-2 bg-indigo-600 hover:bg-indigo-700">
              {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              {editing ? t("save") : t("create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
