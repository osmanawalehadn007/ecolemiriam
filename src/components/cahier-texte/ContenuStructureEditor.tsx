"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
  Target,
  Activity,
  Link as LinkIcon,
  GraduationCap,
  FileText,
  Video,
  BookOpen,
} from "lucide-react";

export type ContenuStructure = {
  objectifs?: string[];
  activites?: {
    type: "COURS" | "EXERCICE" | "TP" | "EVALUATION" | "PROJET";
    description: string;
    dureeMin?: number;
  }[];
  supports?: {
    type: "DOCUMENT" | "VIDEO" | "LIEN" | "COURS_EN_LIGNE";
    url: string;
    coursId?: string;
  }[];
  differentiation?: string;
};

export function ContenuStructureEditor({
  value,
  onChange,
}: {
  value: ContenuStructure | null | undefined;
  onChange: (v: ContenuStructure | null) => void;
}) {
  const objectifs = value?.objectifs ?? [];
  const activites = value?.activites ?? [];
  const supports = value?.supports ?? [];
  const differentiation = value?.differentiation ?? "";

  // --- Objectifs ---
  const [newObjectif, setNewObjectif] = useState("");

  const addObjectif = () => {
    if (!newObjectif.trim()) return;
    onChange({
      ...(value ?? {}),
      objectifs: [...objectifs, newObjectif.trim()],
    });
    setNewObjectif("");
  };

  const removeObjectif = (i: number) => {
    onChange({
      ...(value ?? {}),
      objectifs: objectifs.filter((_, idx) => idx !== i),
    });
  };

  // --- Activités ---
  const addActivite = () => {
    onChange({
      ...(value ?? {}),
      activites: [...activites, { type: "COURS", description: "", dureeMin: undefined }],
    });
  };

  const updateActivite = (i: number, field: "type" | "description" | "dureeMin", val: unknown) => {
    const updated = [...activites];
    updated[i] = { ...updated[i], [field]: val };
    onChange({ ...(value ?? {}), activites: updated });
  };

  const removeActivite = (i: number) => {
    onChange({
      ...(value ?? {}),
      activites: activites.filter((_, idx) => idx !== i),
    });
  };

  // --- Supports ---
  const addSupport = () => {
    onChange({
      ...(value ?? {}),
      supports: [...supports, { type: "LIEN", url: "" }],
    });
  };

  const updateSupport = (i: number, field: "type" | "url" | "coursId", val: unknown) => {
    const updated = [...supports];
    updated[i] = { ...updated[i], [field]: val };
    onChange({ ...(value ?? {}), supports: updated });
  };

  const removeSupport = (i: number) => {
    onChange({
      ...(value ?? {}),
      supports: supports.filter((_, idx) => idx !== i),
    });
  };

  return (
    <div className="space-y-5">
      {/* Objectifs pédagogiques */}
      <div>
        <label className="text-sm font-medium mb-2 flex items-center gap-1.5">
          <Target className="w-4 h-4 text-indigo-500" />
          Objectifs pédagogiques
        </label>
        <div className="space-y-2">
          {objectifs.map((obj, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-xs text-indigo-500 font-bold w-5">
                {i + 1}.
              </span>
              <span className="text-sm flex-1 bg-indigo-50 dark:bg-indigo-900/20 rounded-md px-3 py-1.5">
                {obj}
              </span>
              <button
                type="button"
                onClick={() => removeObjectif(i)}
                className="text-red-400 hover:text-red-500"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <Input
              value={newObjectif}
              onChange={(e) => setNewObjectif(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addObjectif();
                }
              }}
              placeholder="Ajouter un objectif…"
              className="flex-1 text-sm"
            />
            <Button type="button" size="sm" variant="outline" onClick={addObjectif}>
              <Plus className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Activités */}
      <div>
        <label className="text-sm font-medium mb-2 flex items-center gap-1.5">
          <Activity className="w-4 h-4 text-purple-500" />
          Déroulé des activités
        </label>
        <div className="space-y-2">
          {activites.map((act, i) => (
            <div
              key={i}
              className="flex items-start gap-2 bg-purple-50 dark:bg-purple-900/20 rounded-lg p-3"
            >
              <Select
                value={act.type}
                onValueChange={(v) => updateActivite(i, "type", v)}
              >
                <SelectTrigger className="w-[130px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="COURS">Cours</SelectItem>
                  <SelectItem value="EXERCICE">Exercice</SelectItem>
                  <SelectItem value="TP">TP</SelectItem>
                  <SelectItem value="EVALUATION">Évaluation</SelectItem>
                  <SelectItem value="PROJET">Projet</SelectItem>
                </SelectContent>
              </Select>
              <Input
                value={act.description}
                onChange={(e) => updateActivite(i, "description", e.target.value)}
                placeholder="Description de l'activité…"
                className="flex-1 text-sm"
              />
              <Input
                type="number"
                value={act.dureeMin ?? ""}
                onChange={(e) =>
                  updateActivite(i, "dureeMin", e.target.value ? Number(e.target.value) : undefined)
                }
                placeholder="min"
                className="w-[70px] text-sm"
              />
              <button
                type="button"
                onClick={() => removeActivite(i)}
                className="text-red-400 hover:text-red-500 mt-2"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          <Button type="button" size="sm" variant="outline" onClick={addActivite}>
            <Plus className="w-3.5 h-3.5 mr-1" />
            Ajouter une activité
          </Button>
        </div>
      </div>

      {/* Supports / Ressources */}
      <div>
        <label className="text-sm font-medium mb-2 flex items-center gap-1.5">
          <LinkIcon className="w-4 h-4 text-blue-500" />
          Supports & ressources
        </label>
        <div className="space-y-2">
          {supports.map((sup, i) => (
            <div
              key={i}
              className="flex items-center gap-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3"
            >
              <Select
                value={sup.type}
                onValueChange={(v) => updateSupport(i, "type", v)}
              >
                <SelectTrigger className="w-[140px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DOCUMENT">
                    <span className="flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5" /> Document
                    </span>
                  </SelectItem>
                  <SelectItem value="VIDEO">
                    <span className="flex items-center gap-1.5">
                      <Video className="w-3.5 h-3.5" /> Vidéo
                    </span>
                  </SelectItem>
                  <SelectItem value="LIEN">
                    <span className="flex items-center gap-1.5">
                      <LinkIcon className="w-3.5 h-3.5" /> Lien
                    </span>
                  </SelectItem>
                  <SelectItem value="COURS_EN_LIGNE">
                    <span className="flex items-center gap-1.5">
                      <BookOpen className="w-3.5 h-3.5" /> Cours en ligne
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
              <Input
                value={sup.url}
                onChange={(e) => updateSupport(i, "url", e.target.value)}
                placeholder="https://…"
                className="flex-1 text-sm"
              />
              <button
                type="button"
                onClick={() => removeSupport(i)}
                className="text-red-400 hover:text-red-500"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          <Button type="button" size="sm" variant="outline" onClick={addSupport}>
            <Plus className="w-3.5 h-3.5 mr-1" />
            Ajouter un support
          </Button>
        </div>
      </div>

      {/* Différenciation */}
      <div>
        <label className="text-sm font-medium mb-2 flex items-center gap-1.5">
          <GraduationCap className="w-4 h-4 text-amber-500" />
          Différenciation pédagogique
        </label>
        <Textarea
          value={differentiation}
          onChange={(e) =>
            onChange({ ...(value ?? {}), differentiation: e.target.value || undefined })
          }
          rows={2}
          placeholder="Adaptations pour élèves à besoins spécifiques, groupes de niveau…"
        />
      </div>
    </div>
  );
}
