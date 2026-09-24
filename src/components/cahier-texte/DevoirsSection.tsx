"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  Trash2,
  CalendarClock,
  CheckCircle2,
  XCircle,
  Clock,
  BookOpen,
} from "lucide-react";
import type { TypeDevoir, StatutDevoir } from "@prisma/client";

type DevoirItem = {
  id: string;
  description: string;
  type: TypeDevoir;
  dateRemise: string;
  statut: StatutDevoir;
};

const STATUT_DEVOIR_CONFIG: Record<StatutDevoir, { label: string; icon: typeof Clock; color: string }> = {
  DONNE: { label: "À faire", icon: Clock, color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  RENDU: { label: "Rendu", icon: CheckCircle2, color: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
  NON_RENDU: { label: "Non rendu", icon: XCircle, color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
  CORRIGE: { label: "Corrigé", icon: CheckCircle2, color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
};

const TYPE_DEVOIR_LABELS: Record<TypeDevoir, string> = {
  EXERCICE: "Exercice",
  LECTURE: "Lecture",
  RECHERCHE: "Recherche",
  REVISION: "Révision",
  PROJET: "Projet",
  DISSERTATION: "Dissertation",
  AUTRE: "Autre",
};

export function DevoirsSection({
  seanceId,
  devoirs,
  canWrite,
  onAdd,
  onDelete,
}: {
  seanceId: string;
  devoirs: DevoirItem[];
  canWrite: boolean;
  onAdd: (seanceId: string, data: { description: string; type: TypeDevoir; dateRemise: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    description: "",
    type: "EXERCICE" as TypeDevoir,
    dateRemise: "",
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!form.description.trim() || !form.dateRemise) return;
    setSaving(true);
    try {
      await onAdd(seanceId, form);
      setForm({ description: "", type: "EXERCICE", dateRemise: "" });
      setShowForm(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <CalendarClock className="w-4 h-4 text-amber-500" />
          <h4 className="text-sm font-semibold text-slate-600 dark:text-slate-400">
            Devoirs ({devoirs.length})
          </h4>
        </div>
        {canWrite && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowForm(!showForm)}
          >
            <Plus className="w-3.5 h-3.5 mr-1" />
            Ajouter
          </Button>
        )}
      </div>

      {/* Formulaire d'ajout */}
      {showForm && canWrite && (
        <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-3 space-y-3">
          <Textarea
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            placeholder="Description du devoir…"
            rows={2}
            className="text-sm"
          />
          <div className="flex items-center gap-2">
            <Select
              value={form.type}
              onValueChange={(v) => setForm((f) => ({ ...f, type: v as TypeDevoir }))}
            >
              <SelectTrigger className="w-[150px] text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(TYPE_DEVOIR_LABELS).map(([val, label]) => (
                  <SelectItem key={val} value={val}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="date"
              value={form.dateRemise}
              onChange={(e) => setForm((f) => ({ ...f, dateRemise: e.target.value }))}
              className="w-[160px] text-sm"
            />
            <Button size="sm" onClick={handleSubmit} disabled={saving || !form.description.trim() || !form.dateRemise}>
              {saving ? "…" : "Enregistrer"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>
              Annuler
            </Button>
          </div>
        </div>
      )}

      {/* Liste des devoirs */}
      {devoirs.length > 0 ? (
        <div className="space-y-2">
          {devoirs.map((d) => {
            const config = STATUT_DEVOIR_CONFIG[d.statut];
            const Icon = config.icon;
            const isOverdue = d.statut === "DONNE" && new Date(d.dateRemise) < new Date();
            return (
              <div
                key={d.id}
                className={`flex items-start gap-2 rounded-lg p-3 border ${
                  isOverdue
                    ? "border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-900/10"
                    : "border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50"
                }`}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                    {d.description}
                  </p>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    <Badge variant="outline" className="text-[10px]">
                      {TYPE_DEVOIR_LABELS[d.type]}
                    </Badge>
                    <Badge className={`text-[10px] ${config.color}`}>
                      <Icon className="w-2.5 h-2.5 mr-1" />
                      {config.label}
                    </Badge>
                    <span className="text-[10px] text-slate-500 flex items-center gap-0.5">
                      <CalendarClock className="w-2.5 h-2.5" />
                      Pour le {new Date(d.dateRemise).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
                      {isOverdue && <span className="text-red-500 font-medium ml-1">(en retard)</span>}
                    </span>
                  </div>
                </div>
                {canWrite && (
                  <button
                    onClick={() => onDelete(d.id)}
                    className="text-red-400 hover:text-red-500 flex-shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        !showForm && (
          <div className="text-center py-3">
            <BookOpen className="w-5 h-5 mx-auto text-slate-300 dark:text-slate-700 mb-1" />
            <p className="text-xs text-slate-400">Aucun devoir donné</p>
          </div>
        )
      )}
    </div>
  );
}
