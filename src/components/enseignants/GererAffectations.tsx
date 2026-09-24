"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Settings2, Plus, Trash2, Loader2, BookOpen, Layers } from "lucide-react";
import { toast } from "sonner";
import { niveauToLabel } from "@/lib/niveau";

// ------------------------------------------------------------
// Types
// ------------------------------------------------------------
type Classe = { id: string; nom: string; niveau: string; siteId?: string | null };
type Matiere = { id: string; nom: string; code: string };

type Affectation = {
  id: string;
  classeId: string;
  matiereId: string | null;
  classe: { id: string; nom: string; niveau: string };
  matiere: { id: string; nom: string; code: string } | null;
};

type EnseignantMatiere = {
  id: string;
  matiereId: string;
  matiere: { id: string; nom: string; code: string };
};

// ------------------------------------------------------------
// Helpers : détection du cycle
// ------------------------------------------------------------
function isPrimaire(niveau: string): boolean {
  const n = parseInt(niveau, 10);
  if (!isNaN(n)) return n >= 1 && n <= 5;
  return false;
}

function isLycee(niveau: string): boolean {
  const n = parseInt(niveau, 10);
  if (!isNaN(n)) return n >= 10 && n <= 12;
  const lower = niveau.toLowerCase();
  return ["seconde", "première", "premiere", "terminale"].some((l) =>
    lower.includes(l)
  );
}

function isLangueMatiere(nom: string): boolean {
  const lower = nom.toLowerCase();
  return ["anglais", "arabe", "angl", "arab"].some((l) => lower.includes(l));
}

function getCycle(niveau: string): "primaire" | "college" | "lycee" {
  if (isPrimaire(niveau)) return "primaire";
  if (isLycee(niveau)) return "lycee";
  return "college";
}

// ------------------------------------------------------------
// Composant principal
// ------------------------------------------------------------
export function GererAffectations({
  enseignantId,
  enseignantName,
  classes,
  matieres,
  canManage,
}: {
  enseignantId: string;
  enseignantName: string;
  classes: Classe[];
  matieres: Matiere[];
  canManage: boolean;
}) {
  const t = useTranslations("affectations");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [affectations, setAffectations] = useState<Affectation[]>([]);
  const [enseignantMatieres, setEnseignantMatieres] = useState<EnseignantMatiere[]>([]);

  // Form state
  const [newClasseId, setNewClasseId] = useState("");
  const [newMatiereId, setNewMatiereId] = useState("");
  const [selectedMatieres, setSelectedMatieres] = useState<string[]>([]);

  const fetchAffectations = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/enseignants/${enseignantId}/affectations`);
      if (res.ok) {
        const data = await res.json();
        setAffectations(data.affectations ?? []);
        setEnseignantMatieres(data.matieres ?? []);
        setSelectedMatieres((data.matieres ?? []).map((m: EnseignantMatiere) => m.matiereId));
      }
    } finally {
      setLoading(false);
    }
  }, [enseignantId]);

  useEffect(() => {
    if (open) fetchAffectations();
  }, [open, fetchAffectations]);

  // Grouper les affectations par cycle
  const affectationsByCycle = affectations.reduce(
    (acc, a) => {
      const cycle = getCycle(a.classe.niveau);
      if (!acc[cycle]) acc[cycle] = [];
      acc[cycle].push(a);
      return acc;
    },
    {} as Record<string, Affectation[]>
  );

  // Classes disponibles (non encore assignées dans le cycle sélectionné)
  const availableClasses = classes.filter(
    (c) => !affectations.some((a) => a.classeId === c.id)
  );

  // Déterminer le cycle de la classe sélectionnée
  const selectedClasseCycle = newClasseId
    ? getCycle(classes.find((c) => c.id === newClasseId)?.niveau ?? "")
    : null;

  // Au primaire : la matière est optionnelle (sauf prof de langue)
  // Au collège/lycée : la matière est obligatoire
  const matiereRequired = selectedClasseCycle !== "primaire";

  const handleAddAffectation = () => {
    if (!newClasseId) return;
    if (matiereRequired && !newMatiereId) return;

    // Vérifier la règle primaire : 1 classe max sauf langues
    const classe = classes.find((c) => c.id === newClasseId);
    if (classe && isPrimaire(classe.niveau)) {
      const primaireAffectations = affectations.filter((a) =>
        isPrimaire(a.classe.niveau)
      );
      if (primaireAffectations.length >= 1) {
        // Vérifier si c'est un prof de langue
        const matiere = matieres.find((m) => m.id === newMatiereId);
        if (!matiere || !isLangueMatiere(matiere.nom)) {
          toast.error(t("primaireOneClasseRule"));
          return;
        }
      }
    }

    // Créer localement (l'ID sera assigné par le serveur)
    const newAff: Affectation = {
      id: `temp-${Date.now()}`,
      classeId: newClasseId,
      matiereId: newMatiereId || null,
      classe: {
        id: classe!.id,
        nom: classe!.nom,
        niveau: classe!.niveau,
      },
      matiere: newMatiereId
        ? matieres.find((m) => m.id === newMatiereId)
          ? { id: newMatiereId, nom: matieres.find((m) => m.id === newMatiereId)!.nom, code: matieres.find((m) => m.id === newMatiereId)!.code }
          : null
        : null,
    };

    setAffectations((prev) => [...prev, newAff]);
    setNewClasseId("");
    setNewMatiereId("");
  };

  const handleRemoveAffectation = (affId: string) => {
    setAffectations((prev) => prev.filter((a) => a.id !== affId));
  };

  const handleToggleMatiere = (matiereId: string) => {
    setSelectedMatieres((prev) =>
      prev.includes(matiereId)
        ? prev.filter((id) => id !== matiereId)
        : [...prev, matiereId]
    );
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/enseignants/${enseignantId}/affectations`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          affectations: affectations.map((a) => ({
            classeId: a.classeId,
            matiereId: a.matiereId,
          })),
          matieres: selectedMatieres,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setAffectations(data.affectations ?? []);
        setEnseignantMatieres(data.matieres ?? []);
        toast.success(t("saved"));
        setOpen(false);
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || t("saveError"));
      }
    } finally {
      setSaving(false);
    }
  };

  const cycleLabel = (cycle: string) => {
    if (cycle === "primaire") return t("primaire");
    if (cycle === "lycee") return t("lycee");
    return t("college");
  };

  const cycleColor = (cycle: string) => {
    if (cycle === "primaire") return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300";
    if (cycle === "lycee") return "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300";
    return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300";
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5 text-xs" disabled={!canManage}>
          <Settings2 className="w-3.5 h-3.5" />
          {t("manage")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t("title")} — {enseignantName}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* Affectations actuelles par cycle */}
            {["primaire", "college", "lycee"].map((cycle) => {
              const cycleAffs = affectationsByCycle[cycle] ?? [];
              if (cycleAffs.length === 0) return null;
              return (
                <div key={cycle} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge className={`text-xs ${cycleColor(cycle)}`}>
                      {cycleLabel(cycle)}
                    </Badge>
                    <span className="text-xs text-slate-400">
                      {cycleAffs.length} {t("classes")}
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {cycleAffs.map((aff) => (
                      <div
                        key={aff.id}
                        className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800/50 rounded-lg p-2.5"
                      >
                        <BookOpen className="w-4 h-4 text-slate-400 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                            {aff.classe.nom}
                          </span>
                          {aff.matiere && (
                            <span className="text-xs text-slate-500 ml-2">
                              — {aff.matiere.nom}
                            </span>
                          )}
                        </div>
                        <button
                          onClick={() => handleRemoveAffectation(aff.id)}
                          className="text-red-400 hover:text-red-500 flex-shrink-0"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}

            {affectations.length === 0 && (
              <p className="text-sm text-slate-400 text-center py-4">
                {t("noAffectations")}
              </p>
            )}

            {/* Ajouter une affectation */}
            <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
              <h4 className="text-sm font-semibold text-slate-600 dark:text-slate-400 mb-3">
                {t("addAffectation")}
              </h4>
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex-1 min-w-[180px]">
                  <label className="text-xs text-slate-500 mb-1 block">
                    {t("classe")}
                  </label>
                  <Select value={newClasseId} onValueChange={setNewClasseId}>
                    <SelectTrigger>
                      <SelectValue placeholder={t("selectClasse")} />
                    </SelectTrigger>
                    <SelectContent>
                      {availableClasses.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.nom} ({niveauToLabel(c.niveau)})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex-1 min-w-[180px]">
                  <label className="text-xs text-slate-500 mb-1 block">
                    {t("matiere")}
                    {matiereRequired && <span className="text-red-500"> *</span>}
                    {selectedClasseCycle === "primaire" && (
                      <span className="text-slate-400 ml-1">({t("optionalPrimaire")})</span>
                    )}
                  </label>
                  <Select
                    value={newMatiereId}
                    onValueChange={setNewMatiereId}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t("selectMatiere")} />
                    </SelectTrigger>
                    <SelectContent>
                      {matieres.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.nom}
                          {isLangueMatiere(m.nom) && (
                            <Badge className="ml-2 text-[10px] bg-amber-100 text-amber-700">
                              {t("langue")}
                            </Badge>
                          )}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <Button
                  size="sm"
                  onClick={handleAddAffectation}
                  disabled={!newClasseId || (matiereRequired && !newMatiereId)}
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>

              {/* Règle d'info */}
              {selectedClasseCycle === "primaire" && (
                <p className="text-xs text-blue-600 dark:text-blue-400 mt-2">
                  {t("primaireRule")}
                </p>
              )}
              {selectedClasseCycle && selectedClasseCycle !== "primaire" && (
                <p className="text-xs text-green-600 dark:text-green-400 mt-2">
                  {t("collegeLyceeRule")}
                </p>
              )}
            </div>

            {/* Matières enseignées (collège/lycée) */}
            {(affectationsByCycle.college?.length > 0 ||
              affectationsByCycle.lycee?.length > 0) && (
              <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
                <h4 className="text-sm font-semibold text-slate-600 dark:text-slate-400 mb-3 flex items-center gap-1">
                  <Layers className="w-4 h-4" />
                  {t("matieresEnseignees")}
                </h4>
                <div className="flex flex-wrap gap-2">
                  {matieres.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => handleToggleMatiere(m.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                        selectedMatieres.includes(m.id)
                          ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800"
                          : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 border border-slate-200 dark:border-slate-700"
                      }`}
                    >
                      {m.nom}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Save / Cancel */}
            <div className="flex justify-end gap-2 pt-4 border-t border-slate-200 dark:border-slate-700">
              <Button variant="outline" onClick={() => setOpen(false)}>
                {t("cancel")}
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {t("save")}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
