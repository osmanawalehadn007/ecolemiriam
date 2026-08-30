"use client";

import { useState, useRef, useTransition, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  Upload,
  Loader2,
  FileSpreadsheet,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  X,
  Download,
  Info,
  Clock,
  GraduationCap,
  ArrowRight,
  ArrowLeft,
  GitCompare,
  Plus,
  Minus,
  Equal,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { niveauToLabel } from "@/lib/niveau";

type Jour = "DIMANCHE" | "LUNDI" | "MARDI" | "MERCREDI" | "JEUDI" | "VENDREDI" | "SAMEDI";

interface ClasseOption {
  id: string;
  nom: string;
  niveau: string;
  structure: { id: string; nom: string; type: string } | null;
}

interface ExistingCreneau {
  id: string;
  jour: Jour;
  heureDebut: string;
  heureFin: string;
  salle: string | null;
  matiere: { nom: string; code: string; couleur: string | null };
  enseignant: { user: { name: string | null } } | null;
  classeId?: string;
}

interface CreneauPreview {
  jour: Jour;
  heureDebut: string;
  heureFin: string;
  dureeMinutes: number;
  matiereId: string | null;
  matiereNom: string;
  matiereMatched: boolean;
  matiereCreated: boolean;
  enseignantId: string | null;
  enseignantNom: string | null;
  enseignantMatched: boolean;
  salle: string | null;
  sourceLine: number;
  warnings: string[];
  status: "ok" | "warning" | "error";
  isEvaluation: boolean;
}

interface ImportPreview {
  format: string;
  classeNom: string;
  creneaux: CreneauPreview[];
  unmatched: {
    matieres: { raw: string; suggestions: string[] }[];
    enseignants: { raw: string; suggestions: string[] }[];
  };
  conflicts: string[];
  stats: { total: number; ok: number; warning: number; error: number };
  dailyTotals: { jour: Jour; totalMinutes: number; creneauCount: number }[];
  durationWarnings: string[];
  createdMatieres: { nom: string; code: string }[];
  docxMetadata?: {
    classe: string | null;
    annee: string | null;
    textLines: string[];
  };
}

interface Props {
  /** Toutes les classes disponibles pour la sélection préalable. */
  classes: ClasseOption[];
  /** ID de la classe initialement sélectionnée dans la vue principale. */
  initialClasseId: string;
  /** Tous les créneaux existants (toutes classes confondues) — filtrés par classe sélectionnée. */
  existingCreneaux: ExistingCreneau[];
  onClose: () => void;
  /** Appelé après une importation réussie avec les nouveaux créneaux. */
  onImported: (creneaux: CreneauPreview[], classeId: string, classeNom: string) => void;
}

export function ImportEmploiModal({ classes, initialClasseId, existingCreneaux, onClose, onImported }: Props) {
  const t = useTranslations("emploi");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = useTransition();
  const [isApplying, setIsApplying] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // ── Étape 1 : sélection préalable de la classe ──
  const [step, setStep] = useState<"select-class" | "upload">("select-class");
  const [selectedClasseId, setSelectedClasseId] = useState<string>(initialClasseId);

  const selectedClasse = useMemo(
    () => classes.find((c) => c.id === selectedClasseId) ?? null,
    [classes, selectedClasseId],
  );

  // Créneaux existants de la classe sélectionnée (pour la comparaison)
  const currentCreneaux = useMemo(
    () => existingCreneaux.filter((c) => c.classeId === selectedClasseId),
    [existingCreneaux, selectedClasseId],
  );

  // Compter les créneaux existants par classe (pour affichage dans le sélecteur)
  const creneauxCountByClasse = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of existingCreneaux) {
      if (c.classeId) counts.set(c.classeId, (counts.get(c.classeId) ?? 0) + 1);
    }
    return counts;
  }, [existingCreneaux]);

  // Hiérarchie des classes pour le sélecteur : structure → niveau → classes
  const classHierarchy = useMemo(() => {
    const map = new Map<string, { id: string; nom: string; type: string; niveaux: Map<string, ClasseOption[]> }>();
    for (const c of classes) {
      const catKey = c.structure?.id ?? "__none__";
      const catNom = c.structure?.nom ?? t("noCategory");
      const catType = c.structure?.type ?? "";
      if (!map.has(catKey)) {
        map.set(catKey, { id: catKey, nom: catNom, type: catType, niveaux: new Map() });
      }
      const cat = map.get(catKey)!;
      if (!cat.niveaux.has(c.niveau)) cat.niveaux.set(c.niveau, []);
      cat.niveaux.get(c.niveau)!.push(c);
    }
    const typeOrder: Record<string, number> = { MATERNELLE: 0, PRIMAIRE: 1, COLLEGE: 2, LYCEE: 3 };
    return [...map.values()].sort((a, b) => {
      const ta = typeOrder[a.type] ?? 99;
      const tb = typeOrder[b.type] ?? 99;
      if (ta !== tb) return ta - tb;
      return a.nom.localeCompare(b.nom);
    });
  }, [classes, t]);

  function handleFile(file: File) {
    setFileName(file.name);
    setParseError(null);
    setPreview(null);
    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("classeId", selectedClasseId);
        const res = await fetch("/api/emploi-du-temps/import", {
          method: "POST",
          body: formData,
        });
        const data = await res.json();
        if (!res.ok) {
          setParseError(data.error ?? "Erreur lors de la lecture du fichier");
          return;
        }
        setPreview(data as ImportPreview);
      } catch (e) {
        setParseError(e instanceof Error ? e.message : "Erreur réseau");
      }
    });
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  function downloadTemplate() {
    // Modèle CSV format grille (le plus intuitif pour un directeur)
    const header = "Horaire,Lundi,Mardi,Mercredi,Jeudi,Vendredi,Samedi";
    const rows = [
      "07:00-08:00,Mathématiques / M. Ahmed / Salle 1,Français / Mme Fatima,,,,,",
      "08:00-09:00,Mathématiques / M. Ahmed,Sciences / M. Omar / Labo,,,,",
      "09:00-10:00,,,,,,,",
      "10:00-11:00,Histoire / M. Said,,,,,,",
      "11:00-12:00,,,,,,,",
      "12:00-13:00,,,,,,,",
      "13:00-14:00,Anglais / Miss Amina / Salle 2,,,,,,",
      "14:00-15:00,Anglais / Miss Amina,,,,,,",
    ];
    const csv = [header, ...rows].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "modele-emploi-du-temps.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function applyImport() {
    if (!preview || !selectedClasse) return;
    // Les évaluations sont valides même sans matiereId
    const valid = preview.creneaux.filter((c) => c.matiereId || c.isEvaluation);
    if (valid.length === 0) {
      toast.error(t("importNoValid"));
      return;
    }
    setIsApplying(true);
    fetch("/api/emploi-du-temps/bulk-apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        classeId: selectedClasseId,
        creneaux: valid.map((c) => ({
          matiereId: c.matiereId,
          enseignantId: c.enseignantId,
          jour: c.jour,
          heureDebut: c.heureDebut,
          heureFin: c.heureFin,
          salle: c.salle,
        })),
      }),
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Erreur lors de l'application");
        toast.success(t("importApplied", { count: valid.length, classe: selectedClasse.nom }));
        onImported(valid, selectedClasseId, selectedClasse.nom);
        onClose();
      })
      .catch((e) => {
        toast.error(e instanceof Error ? e.message : "Erreur lors de l'application");
      })
      .finally(() => setIsApplying(false));
  }

  const canApply =
    preview && preview.stats.error === 0 && preview.creneaux.some((c) => c.matiereId || c.isEvaluation);

  // ── Comparaison : créneaux existants vs importés ──
  const comparison = useMemo(() => {
    if (!preview) return null;
    const existing = currentCreneaux;
    const imported = preview.creneaux;

    // Clé de comparaison : jour + horaire + matière (approximatif)
    const existingKeys = new Set(
      existing.map((c) => `${c.jour}|${c.heureDebut}|${c.heureFin}|${c.matiere.nom.toLowerCase()}`),
    );
    const importedKeys = new Set(
      imported
        .filter((c) => c.matiereId || c.isEvaluation)
        .map((c) => `${c.jour}|${c.heureDebut}|${c.heureFin}|${(c.matiereNom || "évaluation").toLowerCase()}`),
    );

    const unchanged = [...existingKeys].filter((k) => importedKeys.has(k));
    const added = [...importedKeys].filter((k) => !existingKeys.has(k));
    const removed = [...existingKeys].filter((k) => !importedKeys.has(k));

    return {
      existingCount: existing.length,
      importedCount: imported.filter((c) => c.matiereId || c.isEvaluation).length,
      unchangedCount: unchanged.length,
      addedCount: added.length,
      removedCount: removed.length,
    };
  }, [preview, currentCreneaux]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
              {step === "select-class" ? (
                <GraduationCap className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              ) : (
                <Upload className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              )}
            </div>
            <div>
              <h2 className="text-lg font-semibold">{t("importTitle")}</h2>
              <p className="text-sm text-gray-500">
                {step === "select-class"
                  ? t("importStep1Subtitle")
                  : selectedClasse
                    ? t("importSubtitle", { classe: selectedClasse.nom })
                    : t("importSubtitle", { classe: "" })}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5 scrollbar-thin">
          {/* ── Étape 1 : Sélection préalable de la classe ── */}
          {step === "select-class" && (
            <div className="space-y-4">
              <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 p-4 text-sm text-blue-700 dark:text-blue-400 flex items-start gap-2">
                <Info className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">{t("importStep1Info")}</p>
                  <p className="mt-1 text-blue-600 dark:text-blue-500">{t("importStep1InfoDesc")}</p>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t("importSelectClass")}
                </label>
                <div className="max-h-72 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 scrollbar-thin">
                  {classHierarchy.map((cat) => (
                    <div key={cat.id}>
                      <div className="sticky top-0 bg-gray-50 dark:bg-gray-800 px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-200 dark:border-gray-700">
                        {cat.nom}
                      </div>
                      {[...cat.niveaux.entries()].map(([niveau, classes]) => (
                        <div key={niveau}>
                          <div className="px-3 py-1 text-xs text-gray-400 bg-gray-50/50 dark:bg-gray-800/30">
                            {niveauToLabel(niveau)}
                          </div>
                          {classes.map((c) => (
                            <label
                              key={c.id}
                              className={cn(
                                "flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors border-b border-gray-100 dark:border-gray-800",
                                selectedClasseId === c.id
                                  ? "bg-blue-50 dark:bg-blue-900/20"
                                  : "hover:bg-gray-50 dark:hover:bg-gray-800/50",
                              )}
                            >
                              <input
                                type="radio"
                                name="import-classe"
                                value={c.id}
                                checked={selectedClasseId === c.id}
                                onChange={(e) => {
                                  setSelectedClasseId(e.target.value);
                                  setPreview(null);
                                  setFileName("");
                                  setParseError(null);
                                }}
                                className="w-4 h-4 text-blue-600"
                              />
                              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                {c.nom}
                              </span>
                              {creneauxCountByClasse.has(c.id) && (
                                <span className="text-xs text-gray-400">
                                  ({creneauxCountByClasse.get(c.id)} créneau{creneauxCountByClasse.get(c.id)! > 1 ? "x" : ""})
                                </span>
                              )}
                            </label>
                          ))}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>

              {selectedClasse && (
                <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-4">
                  <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                    <GraduationCap className="w-4 h-4" />
                    <span>
                      {t("importSelectedClass")}: <strong className="text-gray-800 dark:text-gray-200">{selectedClasse.nom}</strong>
                      {selectedClasse.structure && (
                        <span className="text-gray-400 ml-2">— {selectedClasse.structure.nom}</span>
                      )}
                    </span>
                  </div>
                  <div className="mt-2 text-xs text-gray-400">
                    {t("importExistingCount", { count: currentCreneaux.length })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Étape 2 : Upload + aperçu ── */}
          {step === "upload" && (
            <>
          {/* Zone de dépôt */}
          {!preview && (
            <>
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  "border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors",
                  dragOver
                    ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                    : "border-gray-300 dark:border-gray-700 hover:border-blue-400 dark:hover:border-blue-600",
                )}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.csv,.txt,.docx,.doc"
                  onChange={onInputChange}
                  className="hidden"
                />
                {isPending ? (
                  <div className="flex flex-col items-center gap-3">
                    <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
                    <p className="text-sm text-gray-500">{t("importParsing")}</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3">
                    <FileSpreadsheet className="w-10 h-10 text-gray-400" />
                    <div>
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        {t("importDropzone")}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        {t("importFormats")}
                      </p>
                    </div>
                    {fileName && (
                      <p className="text-xs text-blue-600 dark:text-blue-400">
                        {fileName}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Erreur de parsing */}
              {parseError && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm">
                  <XCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                  <span>{parseError}</span>
                </div>
              )}

              {/* Aide format */}
              <div className="rounded-lg bg-gray-50 dark:bg-gray-800/50 p-4 text-sm space-y-2">
                <div className="flex items-center gap-2 font-medium text-gray-700 dark:text-gray-300">
                  <Info className="w-4 h-4" />
                  {t("importHelpTitle")}
                </div>
                <ul className="list-disc list-inside text-gray-500 space-y-1 ml-2">
                  <li>{t("importHelpList")}</li>
                  <li>{t("importHelpGrid")}</li>
                  <li>{t("importHelpSnap")}</li>
                </ul>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-2 mt-2"
                  onClick={downloadTemplate}
                >
                  <Download className="w-4 h-4" />
                  {t("importTemplate")}
                </Button>
              </div>
            </>
          )}

          {/* Aperçu */}
          {preview && (
            <div className="space-y-4">
              {/* Stats */}
              <div className="grid grid-cols-4 gap-3">
                <StatCard
                  label={t("importStatTotal")}
                  value={preview.stats.total}
                  color="gray"
                  icon={<FileSpreadsheet className="w-4 h-4" />}
                />
                <StatCard
                  label={t("importStatOk")}
                  value={preview.stats.ok}
                  color="green"
                  icon={<CheckCircle2 className="w-4 h-4" />}
                />
                <StatCard
                  label={t("importStatWarning")}
                  value={preview.stats.warning}
                  color="amber"
                  icon={<AlertTriangle className="w-4 h-4" />}
                />
                <StatCard
                  label={t("importStatError")}
                  value={preview.stats.error}
                  color="red"
                  icon={<XCircle className="w-4 h-4" />}
                />
              </div>

              {/* Format détecté */}
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <Info className="w-4 h-4" />
                {t("importFormatDetected", { format: preview.format === "grid" ? t("importFormatGrid") : t("importFormatList") })}
              </div>

              {/* Métadonnées .docx (classe détectée dans le texte) */}
              {preview.docxMetadata && (preview.docxMetadata.classe || preview.docxMetadata.annee) && (
                <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 p-3 text-sm space-y-1">
                  <div className="flex items-center gap-2 font-medium text-blue-700 dark:text-blue-400">
                    <Info className="w-4 h-4" />
                    Informations détectées dans le document Word
                  </div>
                  {preview.docxMetadata.classe && (
                    <div className="text-blue-700 dark:text-blue-400">
                      <span className="font-medium">Classe détectée :</span> {preview.docxMetadata.classe}
                      {preview.docxMetadata.classe !== selectedClasse?.nom && (
                        <span className="text-amber-600 dark:text-amber-400 ml-2">
                          (différente de la classe sélectionnée : {selectedClasse?.nom})
                        </span>
                      )}
                    </div>
                  )}
                  {preview.docxMetadata.annee && (
                    <div className="text-blue-700 dark:text-blue-400">
                      <span className="font-medium">Année scolaire :</span> {preview.docxMetadata.annee}
                    </div>
                  )}
                </div>
              )}

              {/* Entités non reconnues */}
              {(preview.unmatched.matieres.length > 0 || preview.unmatched.enseignants.length > 0) && (
                <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-4 space-y-3">
                  <div className="flex items-center gap-2 font-medium text-amber-700 dark:text-amber-400 text-sm">
                    <AlertTriangle className="w-4 h-4" />
                    {t("importUnmatchedTitle")}
                  </div>
                  {preview.unmatched.matieres.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-amber-600 dark:text-amber-500 mb-1">
                        {t("importUnmatchedSubjects")}
                      </p>
                      <div className="space-y-1">
                        {preview.unmatched.matieres.map((m) => (
                          <div key={m.raw} className="text-xs text-amber-700 dark:text-amber-400">
                            <span className="font-medium">« {m.raw} »</span>
                            {m.suggestions.length > 0 && (
                              <span className="text-amber-500"> — {t("importSuggestions")}: {m.suggestions.join(", ")}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {preview.unmatched.enseignants.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-amber-600 dark:text-amber-500 mb-1">
                        {t("importUnmatchedTeachers")}
                      </p>
                      <div className="space-y-1">
                        {preview.unmatched.enseignants.map((e) => (
                          <div key={e.raw} className="text-xs text-amber-700 dark:text-amber-400">
                            <span className="font-medium">« {e.raw} »</span>
                            {e.suggestions.length > 0 && (
                              <span className="text-amber-500"> — {t("importSuggestions")}: {e.suggestions.join(", ")}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Totaux horaires par jour */}
              {preview.dailyTotals.length > 0 && (
                <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-4 space-y-2">
                  <div className="flex items-center gap-2 font-medium text-gray-700 dark:text-gray-300 text-sm">
                    <Clock className="w-4 h-4" />
                    Totaux horaires par jour (max 12h45)
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                    {preview.dailyTotals.map((dt) => {
                      const h = Math.floor(dt.totalMinutes / 60);
                      const m = dt.totalMinutes % 60;
                      const exceeds = dt.totalMinutes > 765;
                      return (
                        <div
                          key={dt.jour}
                          className={cn(
                            "rounded-md px-3 py-2 text-xs border",
                            exceeds
                              ? "border-red-300 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400"
                              : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300",
                          )}
                        >
                          <div className="font-medium">{t(`daysShort.${dt.jour}`)}</div>
                          <div className={cn("font-mono font-bold", exceeds && "text-red-600")}>
                            {h}h{String(m).padStart(2, "0")}
                          </div>
                          <div className="text-gray-400">{dt.creneauCount} créneaux</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Avertissements de durée (dépassement 12h45) */}
              {preview.durationWarnings.length > 0 && (
                <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4 space-y-2">
                  <div className="flex items-center gap-2 font-medium text-red-700 dark:text-red-400 text-sm">
                    <AlertTriangle className="w-4 h-4" />
                    Dépassement horaire ({preview.durationWarnings.length})
                  </div>
                  <ul className="list-disc list-inside text-xs text-red-600 dark:text-red-400 space-y-1 ml-2">
                    {preview.durationWarnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Matières auto-créées */}
              {preview.createdMatieres.length > 0 && (
                <div className="rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 p-4 space-y-2">
                  <div className="flex items-center gap-2 font-medium text-green-700 dark:text-green-400 text-sm">
                    <CheckCircle2 className="w-4 h-4" />
                    Matières créées automatiquement ({preview.createdMatieres.length})
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {preview.createdMatieres.map((m, i) => (
                      <span key={i} className="text-xs bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 rounded-full px-3 py-1">
                        {m.nom} <span className="text-green-500">({m.code})</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Conflits */}
              {preview.conflicts.length > 0 && (
                <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4 space-y-2">
                  <div className="flex items-center gap-2 font-medium text-red-700 dark:text-red-400 text-sm">
                    <XCircle className="w-4 h-4" />
                    {t("importConflictsTitle")} ({preview.conflicts.length})
                  </div>
                  <ul className="list-disc list-inside text-xs text-red-600 dark:text-red-400 space-y-1 ml-2 max-h-32 overflow-y-auto scrollbar-thin">
                    {preview.conflicts.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Tableau des créneaux */}
              <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                <div className="overflow-x-auto max-h-80 overflow-y-auto scrollbar-thin">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 dark:bg-gray-800 sticky top-0 z-10">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium text-gray-500">#</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-500">{t("day")}</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-500">{t("startTime")}</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-500">{t("endTime")}</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-500">Durée</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-500">{t("subject")}</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-500">{t("teacher")}</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-500">{t("room")}</th>
                        <th className="px-3 py-2 text-center font-medium text-gray-500">Statut</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {preview.creneaux.map((c, i) => (
                        <tr
                          key={i}
                          className={cn(
                            c.status === "error" && "bg-red-50/50 dark:bg-red-900/10",
                            c.status === "warning" && "bg-amber-50/50 dark:bg-amber-900/10",
                          )}
                        >
                          <td className="px-3 py-2 text-gray-400 text-xs">{c.sourceLine}</td>
                          <td className="px-3 py-2">{t(`daysShort.${c.jour}`)}</td>
                          <td className="px-3 py-2 font-mono text-xs">{c.heureDebut}</td>
                          <td className="px-3 py-2 font-mono text-xs">{c.heureFin}</td>
                          <td className="px-3 py-2 font-mono text-xs text-gray-500">
                            {c.dureeMinutes} min
                          </td>
                          <td className="px-3 py-2">
                            {c.isEvaluation ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 font-medium">
                                Évaluation
                              </span>
                            ) : (
                              <span className={cn(!c.matiereMatched && "text-red-500")}>
                                {c.matiereNom || "—"}
                                {c.matiereCreated && (
                                  <span className="ml-1 text-xs text-green-600 dark:text-green-400" title="Créée automatiquement">+</span>
                                )}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <span className={cn(c.enseignantNom && !c.enseignantMatched && "text-amber-600 dark:text-amber-400")}>
                              {c.enseignantNom || "—"}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-xs">{c.salle || "—"}</td>
                          <td className="px-3 py-2 text-center">
                            {c.status === "ok" && <CheckCircle2 className="w-4 h-4 text-green-500 inline" />}
                            {c.status === "warning" && (
                              <AlertTriangle className="w-4 h-4 text-amber-500 inline" />
                            )}
                            {c.status === "error" && <XCircle className="w-4 h-4 text-red-500 inline" />}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* ── Comparaison avec l'emploi du temps actuel ── */}
              {comparison && (
                <div className="rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/20 p-4 space-y-3">
                  <div className="flex items-center gap-2 font-medium text-indigo-700 dark:text-indigo-400 text-sm">
                    <GitCompare className="w-4 h-4" />
                    {t("importComparisonTitle")}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div className="rounded-md bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 px-3 py-2">
                      <div className="flex items-center gap-1.5 text-xs text-gray-500">
                        <Equal className="w-3.5 h-3.5 text-gray-400" />
                        {t("importComparisonUnchanged")}
                      </div>
                      <div className="text-lg font-bold text-gray-700 dark:text-gray-300">
                        {comparison.unchangedCount}
                      </div>
                    </div>
                    <div className="rounded-md bg-white dark:bg-gray-900 border border-green-200 dark:border-green-800 px-3 py-2">
                      <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
                        <Plus className="w-3.5 h-3.5" />
                        {t("importComparisonAdded")}
                      </div>
                      <div className="text-lg font-bold text-green-700 dark:text-green-400">
                        {comparison.addedCount}
                      </div>
                    </div>
                    <div className="rounded-md bg-white dark:bg-gray-900 border border-red-200 dark:border-red-800 px-3 py-2">
                      <div className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
                        <Minus className="w-3.5 h-3.5" />
                        {t("importComparisonRemoved")}
                      </div>
                      <div className="text-lg font-bold text-red-700 dark:text-red-400">
                        {comparison.removedCount}
                      </div>
                    </div>
                    <div className="rounded-md bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 px-3 py-2">
                      <div className="flex items-center gap-1.5 text-xs text-gray-500">
                        <FileSpreadsheet className="w-3.5 h-3.5 text-gray-400" />
                        {t("importComparisonExisting")}
                      </div>
                      <div className="text-lg font-bold text-gray-700 dark:text-gray-300">
                        {comparison.existingCount}
                      </div>
                    </div>
                  </div>
                  {comparison.removedCount > 0 && (
                    <div className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400">
                      <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      <span>
                        {t("importComparisonRemovedWarn", { count: comparison.removedCount, classe: selectedClasse?.nom ?? "" })}
                      </span>
                    </div>
                  )}
                  {comparison.unchangedCount > 0 && comparison.addedCount === 0 && comparison.removedCount === 0 && (
                    <div className="flex items-start gap-2 text-xs text-green-600 dark:text-green-400">
                      <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      <span>{t("importComparisonIdentical")}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Détail des avertissements (si peu de créneaux) */}
              {preview.creneaux.some((c) => c.warnings.length > 0) && preview.creneaux.length <= 40 && (
                <div className="rounded-lg bg-gray-50 dark:bg-gray-800/50 p-3 text-xs space-y-1 max-h-32 overflow-y-auto scrollbar-thin">
                  {preview.creneaux
                    .filter((c) => c.warnings.length > 0)
                    .map((c, i) => (
                      <div key={i} className="text-gray-500">
                        <span className="font-medium">L{c.sourceLine} ({t(`daysShort.${c.jour}`)} {c.heureDebut}):</span>{" "}
                        {c.warnings.join(" · ")}
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t border-gray-200 dark:border-gray-700">
          <div className="text-xs text-gray-400">
            {step === "select-class"
              ? t("importStep1FooterHint")
              : preview
                ? t("importReplaceWarning")
                : t("importFooterHint")}
          </div>
          <div className="flex items-center gap-3">
            {step === "select-class" ? (
              <>
                <Button variant="outline" onClick={onClose}>
                  {t("cancel")}
                </Button>
                <Button
                  onClick={() => setStep("upload")}
                  disabled={!selectedClasse}
                  className="gap-2 bg-blue-600 hover:bg-blue-700 text-white"
                >
                  {t("importStep1Continue")}
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  onClick={() => { setStep("select-class"); setPreview(null); setFileName(""); setParseError(null); }}
                  className="gap-2"
                >
                  <ArrowLeft className="w-4 h-4" />
                  {t("importStep2Back")}
                </Button>
                {preview && (
                  <Button variant="outline" onClick={() => { setPreview(null); setFileName(""); }}>
                    {t("importChooseAnother")}
                  </Button>
                )}
                <Button variant="outline" onClick={onClose}>
                  {t("cancel")}
                </Button>
                {preview && (
                  <Button
                    onClick={applyImport}
                    disabled={!canApply || isApplying || preview.conflicts.length > 0}
                    className="gap-2 bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    {isApplying ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Upload className="w-4 h-4" />
                    )}
                    {t("importApply", { count: preview.creneaux.filter((c) => c.matiereId || c.isEvaluation).length })}
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
  icon,
}: {
  label: string;
  value: number;
  color: "gray" | "green" | "amber" | "red";
  icon: React.ReactNode;
}) {
  const colors = {
    gray: "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400",
    green: "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400",
    amber: "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400",
    red: "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400",
  };
  return (
    <div className={cn("rounded-lg p-3 flex items-center gap-2", colors[color])}>
      {icon}
      <div>
        <p className="text-xl font-bold leading-none">{value}</p>
        <p className="text-xs opacity-80 mt-0.5">{label}</p>
      </div>
    </div>
  );
}
