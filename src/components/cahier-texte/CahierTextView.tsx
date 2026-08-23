"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  BookOpen,
  Plus,
  Pencil,
  Trash2,
  Calendar,
  Clock,
  Paperclip,
  Download,
  FileText,
  MessageCircle,
  Send,
  X,
  List,
  CalendarDays,
} from "lucide-react";
import { WeekCalendarView } from "./WeekCalendarView";
import { StatutSeanceBadge } from "./StatutSeanceBadge";
import { ContenuStructureEditor, type ContenuStructure } from "./ContenuStructureEditor";
import { DevoirsSection } from "./DevoirsSection";
import type { StatutSeance, TypeDevoir } from "@prisma/client";

type Classe = { id: string; nom: string; niveau: string };
type Matiere = { id: string; nom: string; code: string };
type Enseignant = { id: string; specialite?: string | null; user: { name: string } };

type FichierJoint = {
  nom: string;
  type: string;
  taille: number;
  dataUrl: string;
};

type Commentaire = {
  id: string;
  contenu: string;
  createdAt: string;
  auteur: { name: string; role: string };
};

type DevoirItem = {
  id: string;
  description: string;
  type: TypeDevoir;
  dateRemise: string;
  statut: "DONNE" | "RENDU" | "NON_RENDU" | "CORRIGE";
};

type CahierEntry = {
  id: string;
  date: string;
  heureDebut: string | null;
  heureFin: string | null;
  statut: StatutSeance;
  contenu: string;
  devoirs: string | null;
  prochainCours: string | null;
  commentaire: string | null;
  fichiers: FichierJoint[] | null;
  contenuStructure: ContenuStructure | null;
  classe: { nom: string; niveau: string };
  matiere: { nom: string; code: string };
  enseignant: { id: string; specialite: string | null; user: { name: string } } | null;
  saisiePar: { name: string } | null;
  commentaires?: Commentaire[];
  devoirsLiees?: DevoirItem[];
};

export function CahierTextView({
  classes,
  matieres,
  enseignants,
  initialEntries,
  canWrite,
  canDelete,
  canComment,
  currentUserId,
  currentUserRole,
}: {
  classes: Classe[];
  matieres: Matiere[];
  enseignants: Enseignant[];
  initialEntries: CahierEntry[];
  canWrite: boolean;
  canDelete: boolean;
  canComment: boolean;
  currentUserId: string;
  currentUserRole: string;
}) {
  const t = useTranslations("cahierTexte");
  const [entries, setEntries] = useState<CahierEntry[]>(initialEntries);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [filterClasse, setFilterClasse] = useState<string>("all");
  const [filterMatiere, setFilterMatiere] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"calendar" | "list">("calendar");
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [weekStart, setWeekStart] = useState(() => {
    const now = new Date();
    const dayOfWeek = now.getUTCDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(now);
    monday.setUTCDate(now.getUTCDate() + mondayOffset);
    monday.setUTCHours(0, 0, 0, 0);
    return monday;
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form state
  const [form, setForm] = useState({
    classeId: "",
    matiereId: "",
    enseignantId: "",
    date: new Date().toISOString().split("T")[0],
    heureDebut: "",
    heureFin: "",
    contenu: "",
    devoirs: "",
    prochainCours: "",
    commentaire: "",
    statut: "EFFECTUEE" as StatutSeance,
  });
  const [formFichiers, setFormFichiers] = useState<FichierJoint[]>([]);
  const [formContenuStructure, setFormContenuStructure] = useState<ContenuStructure | null>(null);

  // Comment state per entry
  const [commentTexts, setCommentTexts] = useState<Record<string, string>>({});

  const resetForm = () => {
    setForm({
      classeId: "",
      matiereId: "",
      enseignantId: "",
      date: new Date().toISOString().split("T")[0],
      heureDebut: "",
      heureFin: "",
      contenu: "",
      devoirs: "",
      prochainCours: "",
      commentaire: "",
      statut: "EFFECTUEE",
    });
    setFormFichiers([]);
    setFormContenuStructure(null);
    setEditingId(null);
  };

  const openCreate = () => {
    resetForm();
    setDialogOpen(true);
  };

  const openEdit = (entry: CahierEntry) => {
    setForm({
      classeId: "",
      matiereId: "",
      enseignantId: entry.enseignant?.id ?? "",
      date: new Date(entry.date).toISOString().split("T")[0],
      heureDebut: entry.heureDebut ?? "",
      heureFin: entry.heureFin ?? "",
      contenu: entry.contenu,
      devoirs: entry.devoirs ?? "",
      prochainCours: entry.prochainCours ?? "",
      commentaire: entry.commentaire ?? "",
      statut: entry.statut,
    });
    setFormFichiers(entry.fichiers ?? []);
    setFormContenuStructure(entry.contenuStructure ?? null);
    setEditingId(entry.id);
    setDialogOpen(true);
  };

  // ------------------------------------------------------------
  // Upload fichier
  // ------------------------------------------------------------
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch("/api/cahier-de-texte/upload", {
          method: "POST",
          body: formData,
        });
        if (res.ok) {
          const data = await res.json();
          setFormFichiers((prev) => [...prev, data]);
        } else {
          const err = await res.json().catch(() => ({}));
          alert(err.error || `Erreur upload: ${file.name}`);
        }
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removeFichier = (index: number) => {
    setFormFichiers((prev) => prev.filter((_, i) => i !== index));
  };

  // ------------------------------------------------------------
  // Submit form (create or edit)
  // ------------------------------------------------------------
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const url = editingId
      ? `/api/cahier-de-texte/${editingId}`
      : "/api/cahier-de-texte";
    const method = editingId ? "PATCH" : "POST";

    const payload: Record<string, unknown> = {
      date: form.date,
      heureDebut: form.heureDebut || null,
      heureFin: form.heureFin || null,
      contenu: form.contenu,
      devoirs: form.devoirs || null,
      prochainCours: form.prochainCours || null,
      commentaire: form.commentaire || null,
      fichiers: formFichiers,
      statut: form.statut,
      contenuStructure: formContenuStructure,
    };
    if (!editingId) {
      payload.classeId = form.classeId;
      payload.matiereId = form.matiereId;
      payload.enseignantId = form.enseignantId || null;
    }

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      const saved = await res.json();
      if (editingId) {
        setEntries((prev) =>
          prev.map((e) => (e.id === editingId ? { ...e, ...saved } : e))
        );
      } else {
        setEntries((prev) => [saved, ...prev]);
      }
      setDialogOpen(false);
      resetForm();
    } else {
      const err = await res.json().catch(() => ({}));
      alert(err.error || "Erreur lors de l'enregistrement");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t("confirmDelete"))) return;
    const res = await fetch(`/api/cahier-de-texte/${id}`, { method: "DELETE" });
    if (res.ok) {
      setEntries((prev) => prev.filter((e) => e.id !== id));
    } else {
      alert("Erreur lors de la suppression");
    }
  };

  // ------------------------------------------------------------
  // Changer le statut d'une séance (transition rapide)
  // ------------------------------------------------------------
  const handleStatutChange = async (id: string, newStatut: StatutSeance) => {
    const res = await fetch(`/api/cahier-de-texte/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ statut: newStatut }),
    });
    if (res.ok) {
      const updated = await res.json();
      setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...updated } : e)));
    }
  };

  // ------------------------------------------------------------
  // Générer les séances depuis l'emploi du temps
  // ------------------------------------------------------------
  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await fetch("/api/cahier-de-texte/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          weekStart: weekStart.toISOString().split("T")[0],
        }),
      });
      const data = await res.json();
      if (res.ok) {
        alert(data.message);
        // Recharger les entrées
        fetchFiltered();
      } else {
        alert(data.error || "Erreur lors de la génération");
      }
    } finally {
      setGenerating(false);
    }
  };

  // ------------------------------------------------------------
  // Gestion des devoirs
  // ------------------------------------------------------------
  const handleAddDevoir = async (
    seanceId: string,
    data: { description: string; type: TypeDevoir; dateRemise: string }
  ) => {
    const res = await fetch("/api/devoirs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (res.ok) {
      const newDevoir = await res.json();
      setEntries((prev) =>
        prev.map((e) =>
          e.id === seanceId
            ? { ...e, devoirsLiees: [...(e.devoirsLiees ?? []), newDevoir] }
            : e
        )
      );
    }
  };

  const handleDeleteDevoir = async (devoirId: string) => {
    const res = await fetch(`/api/devoirs/${devoirId}`, { method: "DELETE" });
    if (res.ok) {
      setEntries((prev) =>
        prev.map((e) => ({
          ...e,
          devoirsLiees: (e.devoirsLiees ?? []).filter((d) => d.id !== devoirId),
        }))
      );
    }
  };

  // ------------------------------------------------------------
  // Commentaires
  // ------------------------------------------------------------
  const handleAddComment = async (entryId: string) => {
    const text = commentTexts[entryId]?.trim();
    if (!text) return;

    const res = await fetch(`/api/cahier-de-texte/${entryId}/commentaires`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contenu: text }),
    });

    if (res.ok) {
      const newComment = await res.json();
      setEntries((prev) =>
        prev.map((e) =>
          e.id === entryId
            ? { ...e, commentaires: [...(e.commentaires ?? []), newComment] }
            : e
        )
      );
      setCommentTexts((prev) => ({ ...prev, [entryId]: "" }));
    } else {
      alert("Erreur lors de l'ajout du commentaire");
    }
  };

  const handleDeleteComment = async (entryId: string, commentId: string) => {
    const res = await fetch(
      `/api/cahier-de-texte/${entryId}/commentaires?commentaireId=${commentId}`,
      { method: "DELETE" }
    );
    if (res.ok) {
      setEntries((prev) =>
        prev.map((e) =>
          e.id === entryId
            ? {
                ...e,
                commentaires: (e.commentaires ?? []).filter((c) => c.id !== commentId),
              }
            : e
        )
      );
    }
  };

  // ------------------------------------------------------------
  // Fetch filtered entries
  // ------------------------------------------------------------
  const fetchFiltered = useCallback(async () => {
    const params = new URLSearchParams();
    if (filterClasse !== "all") params.set("classeId", filterClasse);
    if (filterMatiere !== "all") params.set("matiereId", filterMatiere);
    // Pour la vue calendrier, filtrer par semaine
    if (viewMode === "calendar") {
      const from = weekStart.toISOString().split("T")[0];
      const to = new Date(weekStart);
      to.setUTCDate(weekStart.getUTCDate() + 6);
      params.set("from", from);
      params.set("to", to.toISOString().split("T")[0]);
    }
    const res = await fetch(`/api/cahier-de-texte?${params}`);
    if (res.ok) {
      const data = await res.json();
      setEntries(data);
    }
  }, [filterClasse, filterMatiere, viewMode, weekStart]);

  useEffect(() => {
    fetchFiltered();
  }, [fetchFiltered]);

  // ------------------------------------------------------------
  // Navigation semaine
  // ------------------------------------------------------------
  const handleWeekChange = (delta: number) => {
    if (delta === 0) {
      const now = new Date();
      const dayOfWeek = now.getUTCDay();
      const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      const monday = new Date(now);
      monday.setUTCDate(now.getUTCDate() + mondayOffset);
      monday.setUTCHours(0, 0, 0, 0);
      setWeekStart(monday);
    } else {
      const newWeek = new Date(weekStart);
      newWeek.setUTCDate(weekStart.getUTCDate() + delta * 7);
      setWeekStart(newWeek);
    }
  };

  // ------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------
  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString("fr-FR", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    });

  const formatDateTime = (d: string) =>
    new Date(d).toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const downloadFile = (fichier: FichierJoint) => {
    const link = document.createElement("a");
    link.href = fichier.dataUrl;
    link.download = fichier.nom;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const canDeleteComment = (comment: Commentaire) =>
    comment.auteur.role === currentUserRole ||
    ["SUPER_ADMIN", "TENANT_ADMIN"].includes(currentUserRole) ||
    comment.auteur.name === currentUserRole;

  const calEntries = entries.map((e) => ({
    id: e.id,
    date: e.date,
    heureDebut: e.heureDebut,
    heureFin: e.heureFin,
    statut: e.statut,
    contenu: e.contenu,
    classe: e.classe,
    matiere: e.matiere,
    enseignant: e.enseignant,
  }));

  return (
    <div className="space-y-6">
      {/* Header bar with filters, view toggle and create button */}
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {/* View toggle */}
          <div className="flex items-center bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5">
            <button
              onClick={() => setViewMode("calendar")}
              className={`px-3 py-1.5 rounded-md text-sm flex items-center gap-1.5 transition-colors ${
                viewMode === "calendar"
                  ? "bg-white dark:bg-slate-900 shadow-sm font-medium"
                  : "text-slate-500"
              }`}
            >
              <CalendarDays className="w-4 h-4" />
              Semaine
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`px-3 py-1.5 rounded-md text-sm flex items-center gap-1.5 transition-colors ${
                viewMode === "list"
                  ? "bg-white dark:bg-slate-900 shadow-sm font-medium"
                  : "text-slate-500"
              }`}
            >
              <List className="w-4 h-4" />
              Liste
            </button>
          </div>

          <Select value={filterClasse} onValueChange={setFilterClasse}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder={t("filterClasse")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("allClasses")}</SelectItem>
              {classes.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.nom} ({c.niveau})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filterMatiere} onValueChange={setFilterMatiere}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder={t("filterMatiere")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("allMatieres")}</SelectItem>
              {matieres.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.nom}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {canWrite && (
          <Button onClick={openCreate}>
            <Plus className="w-4 h-4 mr-2" />
            {t("addEntry")}
          </Button>
        )}
      </div>

      {/* Vue calendrier */}
      {viewMode === "calendar" && (
        <WeekCalendarView
          entries={calEntries}
          weekStart={weekStart}
          onWeekChange={handleWeekChange}
          onGenerate={handleGenerate}
          onEntryClick={(id) => {
            const entry = entries.find((e) => e.id === id);
            if (entry) openEdit(entry);
          }}
          generating={generating}
        />
      )}

      {/* Vue liste */}
      {viewMode === "list" && (
        <>
          {entries.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              <BookOpen className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>{t("noEntries")}</p>
            </div>
          ) : (
            <div className="space-y-4">
              {entries.map((entry) => (
                <div
                  key={entry.id}
                  className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm"
                >
                  {/* Header */}
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div className="flex items-center gap-3 flex-wrap">
                      <Badge variant="secondary" className="text-xs">
                        <Calendar className="w-3 h-3 mr-1" />
                        {formatDate(entry.date)}
                      </Badge>
                      {entry.heureDebut && (
                        <Badge variant="outline" className="text-xs">
                          <Clock className="w-3 h-3 mr-1" />
                          {entry.heureDebut}
                          {entry.heureFin ? ` – ${entry.heureFin}` : ""}
                        </Badge>
                      )}
                      <Badge className="text-xs bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
                        {entry.classe.nom}
                      </Badge>
                      <Badge className="text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">
                        {entry.matiere.nom}
                      </Badge>
                      <StatutSeanceBadge statut={entry.statut} />
                      {entry.enseignant && (
                        <span className="text-xs text-slate-500">
                          {entry.enseignant.user.name}
                        </span>
                      )}
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      {/* Quick statut change */}
                      {canWrite && entry.statut !== "CLOTUREE" && (
                        <Select
                          value={entry.statut}
                          onValueChange={(v) => handleStatutChange(entry.id, v as StatutSeance)}
                        >
                          <SelectTrigger className="w-[120px] h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="PLANIFIEE">Planifiée</SelectItem>
                            <SelectItem value="EFFECTUEE">Effectuée</SelectItem>
                            <SelectItem value="CLOTUREE">Clôturée</SelectItem>
                            <SelectItem value="ANNULEE">Annulée</SelectItem>
                            <SelectItem value="REMPLACEE">Remplacée</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                      {canWrite && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => openEdit(entry)}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                      )}
                      {canDelete && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDelete(entry.id)}
                          className="text-red-500 hover:text-red-600"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Content */}
                  <div className="space-y-3">
                    {/* Objectifs structurés */}
                    {entry.contenuStructure?.objectifs && entry.contenuStructure.objectifs.length > 0 && (
                      <div className="bg-indigo-50 dark:bg-indigo-900/20 rounded-lg p-3">
                        <p className="text-xs font-semibold text-indigo-700 dark:text-indigo-400 uppercase mb-2">
                          Objectifs
                        </p>
                        <ul className="space-y-1">
                          {entry.contenuStructure.objectifs.map((obj, i) => (
                            <li key={i} className="text-sm text-slate-700 dark:text-slate-300 flex items-start gap-2">
                              <span className="text-indigo-500 font-bold">{i + 1}.</span>
                              {obj}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Contenu principal */}
                    <div>
                      <p className="text-xs font-semibold text-slate-500 uppercase mb-1">
                        {t("contenu")}
                      </p>
                      <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                        {entry.contenu || <span className="text-slate-400 italic">Non renseigné</span>}
                      </p>
                    </div>

                    {/* Activités structurées */}
                    {entry.contenuStructure?.activites && entry.contenuStructure.activites.length > 0 && (
                      <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-3">
                        <p className="text-xs font-semibold text-purple-700 dark:text-purple-400 uppercase mb-2">
                          Activités
                        </p>
                        <div className="space-y-1.5">
                          {entry.contenuStructure.activites.map((act, i) => (
                            <div key={i} className="flex items-center gap-2 text-sm">
                              <Badge variant="outline" className="text-[10px]">{act.type}</Badge>
                              <span className="text-slate-700 dark:text-slate-300">{act.description}</span>
                              {act.dureeMin && (
                                <span className="text-xs text-slate-400">({act.dureeMin} min)</span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Supports structurés */}
                    {entry.contenuStructure?.supports && entry.contenuStructure.supports.length > 0 && (
                      <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3">
                        <p className="text-xs font-semibold text-blue-700 dark:text-blue-400 uppercase mb-2">
                          Supports
                        </p>
                        <div className="space-y-1">
                          {entry.contenuStructure.supports.map((sup, i) => (
                            <a
                              key={i}
                              href={sup.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-2 text-sm text-blue-600 hover:underline"
                            >
                              <Badge variant="outline" className="text-[10px]">{sup.type}</Badge>
                              {sup.url}
                            </a>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Devoirs liés (nouveau système) */}
                    {entry.devoirsLiees && entry.devoirsLiees.length > 0 && (
                      <DevoirsSection
                        seanceId={entry.id}
                        devoirs={entry.devoirsLiees}
                        canWrite={canWrite}
                        onAdd={handleAddDevoir}
                        onDelete={handleDeleteDevoir}
                      />
                    )}

                    {/* Devoirs legacy (texte libre) */}
                    {entry.devoirs && (
                      <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-3">
                        <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 uppercase mb-1">
                          {t("devoirs")}
                        </p>
                        <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                          {entry.devoirs}
                        </p>
                      </div>
                    )}

                    {/* Bouton ajouter devoir si pas de devoirs */}
                    {canWrite && (!entry.devoirsLiees || entry.devoirsLiees.length === 0) && (
                      <DevoirsSection
                        seanceId={entry.id}
                        devoirs={[]}
                        canWrite={canWrite}
                        onAdd={handleAddDevoir}
                        onDelete={handleDeleteDevoir}
                      />
                    )}

                    {/* Différenciation */}
                    {entry.contenuStructure?.differentiation && (
                      <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-3">
                        <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 uppercase mb-1">
                          Différenciation
                        </p>
                        <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                          {entry.contenuStructure.differentiation}
                        </p>
                      </div>
                    )}

                    {entry.prochainCours && (
                      <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3">
                        <p className="text-xs font-semibold text-blue-700 dark:text-blue-400 uppercase mb-1">
                          {t("prochainCours")}
                        </p>
                        <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                          {entry.prochainCours}
                        </p>
                      </div>
                    )}

                    {entry.commentaire && (
                      <div>
                        <p className="text-xs font-semibold text-slate-400 uppercase mb-1">
                          {t("commentaire")}
                        </p>
                        <p className="text-sm text-slate-500 italic whitespace-pre-wrap">
                          {entry.commentaire}
                        </p>
                      </div>
                    )}

                    {/* Files attached */}
                    {entry.fichiers && entry.fichiers.length > 0 && (
                      <div className="bg-slate-50 dark:bg-slate-800/50 rounded-lg p-3">
                        <p className="text-xs font-semibold text-slate-500 uppercase mb-2">
                          {t("fichiers")} ({entry.fichiers.length})
                        </p>
                        <div className="space-y-2">
                          {entry.fichiers.map((f, i) => (
                            <div
                              key={i}
                              className="flex items-center gap-2 bg-white dark:bg-slate-900 rounded-lg p-2 border border-slate-200 dark:border-slate-700"
                            >
                              <FileText className="w-4 h-4 text-blue-500 flex-shrink-0" />
                              <span className="text-sm flex-1 truncate">{f.nom}</span>
                              <span className="text-xs text-slate-400">
                                {formatFileSize(f.taille)}
                              </span>
                              <button
                                onClick={() => downloadFile(f)}
                                className="text-blue-500 hover:text-blue-600"
                                title={t("download")}
                              >
                                <Download className="w-4 h-4" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {entry.saisiePar && (
                      <p className="text-xs text-slate-400 pt-1">
                        {t("saisiePar")}: {entry.saisiePar.name}
                      </p>
                    )}
                  </div>

                  {/* Comments zone */}
                  <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-800">
                    <div className="flex items-center gap-2 mb-3">
                      <MessageCircle className="w-4 h-4 text-slate-400" />
                      <h4 className="text-sm font-semibold text-slate-600 dark:text-slate-400">
                        {t("commentaires")} ({entry.commentaires?.length ?? 0})
                      </h4>
                    </div>

                    {entry.commentaires && entry.commentaires.length > 0 && (
                      <div className="space-y-2 mb-3">
                        {entry.commentaires.map((c) => (
                          <div
                            key={c.id}
                            className="flex items-start gap-2 bg-slate-50 dark:bg-slate-800/50 rounded-lg p-3"
                          >
                            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center text-white text-xs font-bold">
                              {c.auteur.name.charAt(0).toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                                  {c.auteur.name}
                                </span>
                                <Badge variant="outline" className="text-[10px] py-0 px-1">
                                  {c.auteur.role}
                                </Badge>
                                <span className="text-xs text-slate-400">
                                  {formatDateTime(c.createdAt)}
                                </span>
                              </div>
                              <p className="text-sm text-slate-600 dark:text-slate-400 whitespace-pre-wrap">
                                {c.contenu}
                              </p>
                            </div>
                            {canComment && (canDeleteComment(c) || ["SUPER_ADMIN", "TENANT_ADMIN"].includes(currentUserRole)) && (
                              <button
                                onClick={() => handleDeleteComment(entry.id, c.id)}
                                className="text-red-400 hover:text-red-500 flex-shrink-0"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {canComment && (
                      <div className="flex items-start gap-2">
                        <Textarea
                          value={commentTexts[entry.id] ?? ""}
                          onChange={(e) =>
                            setCommentTexts((prev) => ({
                              ...prev,
                              [entry.id]: e.target.value,
                            }))
                          }
                          rows={2}
                          placeholder={t("addCommentPlaceholder")}
                          className="flex-1 text-sm"
                        />
                        <Button
                          size="sm"
                          onClick={() => handleAddComment(entry.id)}
                          disabled={!commentTexts[entry.id]?.trim()}
                          className="mt-1"
                        >
                          <Send className="w-4 h-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Dialog de création/édition */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingId ? t("editEntry") : t("addEntry")}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            {!editingId && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium mb-1 block">
                    {t("classe")} *
                  </label>
                  <Select
                    value={form.classeId}
                    onValueChange={(v) => setForm((f) => ({ ...f, classeId: v }))}
                    required
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t("selectClasse")} />
                    </SelectTrigger>
                    <SelectContent>
                      {classes.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.nom} ({c.niveau})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">
                    {t("matiere")} *
                  </label>
                  <Select
                    value={form.matiereId}
                    onValueChange={(v) => setForm((f) => ({ ...f, matiereId: v }))}
                    required
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t("selectMatiere")} />
                    </SelectTrigger>
                    <SelectContent>
                      {matieres.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.nom}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {!editingId && (
              <div>
                <label className="text-sm font-medium mb-1 block">
                  {t("enseignant")}
                </label>
                <Select
                  value={form.enseignantId}
                  onValueChange={(v) => setForm((f) => ({ ...f, enseignantId: v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("selectEnseignant")} />
                  </SelectTrigger>
                  <SelectContent>
                    {enseignants.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.user.name}
                        {e.specialite ? ` — ${e.specialite}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="text-sm font-medium mb-1 block">
                  {t("date")} *
                </label>
                <Input
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                  required
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">
                  {t("heureDebut")}
                </label>
                <Input
                  type="time"
                  value={form.heureDebut}
                  onChange={(e) => setForm((f) => ({ ...f, heureDebut: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">
                  {t("heureFin")}
                </label>
                <Input
                  type="time"
                  value={form.heureFin}
                  onChange={(e) => setForm((f) => ({ ...f, heureFin: e.target.value }))}
                />
              </div>
            </div>

            {/* Statut de la séance */}
            <div>
              <label className="text-sm font-medium mb-1 block">Statut de la séance</label>
              <Select
                value={form.statut}
                onValueChange={(v) => setForm((f) => ({ ...f, statut: v as StatutSeance }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PLANIFIEE">Planifiée</SelectItem>
                  <SelectItem value="EFFECTUEE">Effectuée</SelectItem>
                  <SelectItem value="CLOTUREE">Clôturée</SelectItem>
                  <SelectItem value="ANNULEE">Annulée</SelectItem>
                  <SelectItem value="REMPLACEE">Remplacée</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">
                {t("contenu")} *
              </label>
              <Textarea
                value={form.contenu}
                onChange={(e) => setForm((f) => ({ ...f, contenu: e.target.value }))}
                rows={3}
                required
                placeholder={t("contenuPlaceholder")}
              />
            </div>

            {/* Contenu structuré */}
            <div className="border-t border-slate-200 dark:border-slate-800 pt-4">
              <p className="text-sm font-semibold text-slate-600 dark:text-slate-400 mb-3">
                Contenu structuré (optionnel)
              </p>
              <ContenuStructureEditor
                value={formContenuStructure}
                onChange={setFormContenuStructure}
              />
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">
                {t("devoirs")} <span className="text-xs text-slate-400">(legacy — préférer le système de devoirs structurés)</span>
              </label>
              <Textarea
                value={form.devoirs}
                onChange={(e) => setForm((f) => ({ ...f, devoirs: e.target.value }))}
                rows={2}
                placeholder={t("devoirsPlaceholder")}
              />
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">
                {t("prochainCours")}
              </label>
              <Textarea
                value={form.prochainCours}
                onChange={(e) => setForm((f) => ({ ...f, prochainCours: e.target.value }))}
                rows={2}
                placeholder={t("prochainCoursPlaceholder")}
              />
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">
                {t("commentaire")}
              </label>
              <Textarea
                value={form.commentaire}
                onChange={(e) => setForm((f) => ({ ...f, commentaire: e.target.value }))}
                rows={2}
              />
            </div>

            {/* File upload zone */}
            <div>
              <label className="text-sm font-medium mb-1 block">
                {t("fichiers")}
              </label>
              <div className="border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-lg p-4">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".doc,.docx,.pdf,.odt,.txt"
                  multiple
                  onChange={handleFileUpload}
                  disabled={uploading}
                  className="hidden"
                  id="cahier-file-upload"
                />
                <label
                  htmlFor="cahier-file-upload"
                  className="flex flex-col items-center justify-center cursor-pointer py-4"
                >
                  <Paperclip className="w-8 h-8 text-slate-400 mb-2" />
                  <span className="text-sm text-slate-500">
                    {uploading ? t("uploading") : t("uploadPlaceholder")}
                  </span>
                  <span className="text-xs text-slate-400 mt-1">
                    .doc, .docx, .pdf, .odt, .txt (max 5 Mo)
                  </span>
                </label>

                {formFichiers.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {formFichiers.map((f, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 rounded-lg p-2"
                      >
                        <FileText className="w-4 h-4 text-blue-500 flex-shrink-0" />
                        <span className="text-sm flex-1 truncate">{f.nom}</span>
                        <span className="text-xs text-slate-400">
                          {formatFileSize(f.taille)}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeFichier(i)}
                          className="text-red-500 hover:text-red-600"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
              >
                {t("cancel")}
              </Button>
              <Button type="submit">
                {editingId ? t("save") : t("create")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
