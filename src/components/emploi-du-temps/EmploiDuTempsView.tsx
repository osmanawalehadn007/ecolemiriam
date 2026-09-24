"use client";

import { useState, useTransition, useRef, useCallback, useMemo, useEffect } from "react";
import { useState, useTransition, useRef, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, Trash2, Loader2, Clock, Printer, GripVertical, Sparkles, AlertCircle, CheckCircle2, ChevronDown, ChevronRight, School, ChevronUp, Minus, Upload } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { hasPermission } from "@/lib/client-permissions";
import { SmartSuggestPanel } from "./SmartSuggestPanel";
import { ImportEmploiModal } from "./ImportEmploiModal";
import { useTranslations } from "next-intl";
import { niveauToLabel } from "@/lib/niveau";
import {
  getGridConfig,
  getStructureTypeFromClasse,
  computeEndTime,
  computeDuration,
  getValidStartSlots,
  type GridConfig,
} from "@/lib/emploi-du-temps/grid-config";

type Jour = "DIMANCHE" | "LUNDI" | "MARDI" | "MERCREDI" | "JEUDI" | "VENDREDI" | "SAMEDI";

const JOURS: Jour[] = ["DIMANCHE", "LUNDI", "MARDI", "MERCREDI", "JEUDI", "VENDREDI", "SAMEDI"];

// Grille standard (collège/lycée) : 07:00 → 18:00 en pas de 30 min.
// La grille fine (maternel/primaire) est calculée dynamiquement via getGridConfig
// dans le composant, selon le type de Structure de la classe sélectionnée.

interface Classe { id: string; nom: string; niveau: string; structure: { id: string; nom: string; type: string } | null }
interface Matiere { id: string; nom: string; code: string; couleur: string | null; coefficient: number }
interface Enseignant { id: string; user: { name: string | null } }
interface Salle { id: string; nom: string; capacite: number; type: string | null }
interface Disponibilite { id: string; enseignantId: string; jour: string; heureDebut: string; heureFin: string }
interface EmploiCreneau {
  id: string;
  jour: Jour;
  heureDebut: string;
  heureFin: string;
  salle: string | null;
  matiere: { nom: string; code: string; couleur: string | null };
  classe: { nom: string };
  enseignant: { user: { name: string | null } } | null;
  classeId?: string;
  matiereId?: string;
  enseignantId?: string | null;
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Une session dédoublée en groupes A/B est représentée par deux lignes
 * EmploiTemps distinctes (même jour/horaire, prof et salle différents) — il
 * n'y a pas de champ "groupe" dédié en base. L'outil IA encode le groupe dans
 * le libellé de la salle ("Salle 02 (Groupe A)") ; on l'extrait ici pour
 * l'afficher comme badge plutôt que comme texte brut de salle.
 */
function parseGroupe(salle: string | null): { salleAffichee: string | null; groupe: string | null } {
  if (!salle) return { salleAffichee: null, groupe: null };
  const m = salle.match(/^(.*)\s\(Groupe (\w+)\)$/);
  if (m) return { salleAffichee: m[1], groupe: m[2] };
  return { salleAffichee: salle, groupe: null };
}

/**
 * Convertit un niveau ("1ère", "2ème", …, "Seconde", "Première", "Terminale")
 * en numéro d'année (1-12) pour l'affichage à côté du nom de matière.
 * "1ère" → "1", "Seconde" → "10", "Première" → "11", "Terminale" → "12"
 */
function niveauToNumero(niveau: string): string {
  const map: Record<string, string> = {
    "1ère": "1", "1ere": "1", "1er": "1",
    "2ème": "2", "2eme": "2",
    "3ème": "3", "3eme": "3",
    "4ème": "4", "4eme": "4",
    "5ème": "5", "5eme": "5",
    "6ème": "6", "6eme": "6",
    "7ème": "7", "7eme": "7",
    "8ème": "8", "8eme": "8",
    "9ème": "9", "9eme": "9",
    "Seconde": "10", "seconde": "10",
    "Première": "11", "premiere": "11",
    "Terminale": "12", "terminale": "12", "tle": "12", "term": "12",
    "Maternelle": "0",
  };
  return map[niveau] ?? niveau;
}

function matiereColor(couleur: string | null): string {
  if (!couleur) return "bg-gray-100 border-gray-300 text-gray-800 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-300";
  // Palette étendue — chaque couleur hex a une classe Tailwind correspondante.
  // Pour les couleurs non listées, on utilise un fallback vert.
  const colorMap: Record<string, string> = {
    "#ef4444": "bg-red-100 border-red-300 text-red-800 dark:bg-red-900/30 dark:border-red-700 dark:text-red-300",
    "#3b82f6": "bg-blue-100 border-blue-300 text-blue-800 dark:bg-blue-900/30 dark:border-blue-700 dark:text-blue-300",
    "#f59e0b": "bg-amber-100 border-amber-300 text-amber-800 dark:bg-amber-900/30 dark:border-amber-700 dark:text-amber-300",
    "#10b981": "bg-emerald-100 border-emerald-300 text-emerald-800 dark:bg-emerald-900/30 dark:border-emerald-700 dark:text-emerald-300",
    "#8b5cf6": "bg-violet-100 border-violet-300 text-violet-800 dark:bg-violet-900/30 dark:border-violet-700 dark:text-violet-300",
    "#ec4899": "bg-pink-100 border-pink-300 text-pink-800 dark:bg-pink-900/30 dark:border-pink-700 dark:text-pink-300",
    "#14b8a6": "bg-teal-100 border-teal-300 text-teal-800 dark:bg-teal-900/30 dark:border-teal-700 dark:text-teal-300",
    "#f97316": "bg-orange-100 border-orange-300 text-orange-800 dark:bg-orange-900/30 dark:border-orange-700 dark:text-orange-300",
    "#6366f1": "bg-indigo-100 border-indigo-300 text-indigo-800 dark:bg-indigo-900/30 dark:border-indigo-700 dark:text-indigo-300",
    "#84cc16": "bg-lime-100 border-lime-300 text-lime-800 dark:bg-lime-900/30 dark:border-lime-700 dark:text-lime-300",
    "#06b6d4": "bg-cyan-100 border-cyan-300 text-cyan-800 dark:bg-cyan-900/30 dark:border-cyan-700 dark:text-cyan-300",
    "#a855f7": "bg-purple-100 border-purple-300 text-purple-800 dark:bg-purple-900/30 dark:border-purple-700 dark:text-purple-300",
    "#eab308": "bg-yellow-100 border-yellow-300 text-yellow-800 dark:bg-yellow-900/30 dark:border-yellow-700 dark:text-yellow-300",
    "#64748b": "bg-slate-100 border-slate-300 text-slate-800 dark:bg-slate-900/30 dark:border-slate-700 dark:text-slate-300",
    "#dc2626": "bg-rose-100 border-rose-300 text-rose-800 dark:bg-rose-900/30 dark:border-rose-700 dark:text-rose-300",
    "#0ea5e9": "bg-sky-100 border-sky-300 text-sky-800 dark:bg-sky-900/30 dark:border-sky-700 dark:text-sky-300",
    "#22c55e": "bg-green-100 border-green-300 text-green-800 dark:bg-green-900/30 dark:border-green-700 dark:text-green-300",
    "#d946ef": "bg-fuchsia-100 border-fuchsia-300 text-fuchsia-800 dark:bg-fuchsia-900/30 dark:border-fuchsia-700 dark:text-fuchsia-300",
    "#fbbf24": "bg-amber-100 border-amber-300 text-amber-800 dark:bg-amber-900/30 dark:border-amber-700 dark:text-amber-300",
    "#7c3aed": "bg-violet-100 border-violet-300 text-violet-800 dark:bg-violet-900/30 dark:border-violet-700 dark:text-violet-300",
    "#059669": "bg-emerald-100 border-emerald-300 text-emerald-800 dark:bg-emerald-900/30 dark:border-emerald-700 dark:text-emerald-300",
    "#e11d48": "bg-rose-100 border-rose-300 text-rose-800 dark:bg-rose-900/30 dark:border-rose-700 dark:text-rose-300",
    "#0891b2": "bg-cyan-100 border-cyan-300 text-cyan-800 dark:bg-cyan-900/30 dark:border-cyan-700 dark:text-cyan-300",
    "#ca8a04": "bg-yellow-100 border-yellow-300 text-yellow-800 dark:bg-yellow-900/30 dark:border-yellow-700 dark:text-yellow-300",
    "#2563eb": "bg-blue-100 border-blue-300 text-blue-800 dark:bg-blue-900/30 dark:border-blue-700 dark:text-blue-300",
    "#9333ea": "bg-purple-100 border-purple-300 text-purple-800 dark:bg-purple-900/30 dark:border-purple-700 dark:text-purple-300",
    "#65a30d": "bg-lime-100 border-lime-300 text-lime-800 dark:bg-lime-900/30 dark:border-lime-700 dark:text-lime-300",
    "#db2777": "bg-pink-100 border-pink-300 text-pink-800 dark:bg-pink-900/30 dark:border-pink-700 dark:text-pink-300",
    "#0d9488": "bg-teal-100 border-teal-300 text-teal-800 dark:bg-teal-900/30 dark:border-teal-700 dark:text-teal-300",
    "#c2410c": "bg-orange-100 border-orange-300 text-orange-800 dark:bg-orange-900/30 dark:border-orange-700 dark:text-orange-300",
    "#4f46e5": "bg-indigo-100 border-indigo-300 text-indigo-800 dark:bg-indigo-900/30 dark:border-indigo-700 dark:text-indigo-300",
    "#16a34a": "bg-green-100 border-green-300 text-green-800 dark:bg-green-900/30 dark:border-green-700 dark:text-green-300",
    "#be185d": "bg-pink-100 border-pink-300 text-pink-800 dark:bg-pink-900/30 dark:border-pink-700 dark:text-pink-300",
    "#1d4ed8": "bg-blue-100 border-blue-300 text-blue-800 dark:bg-blue-900/30 dark:border-blue-700 dark:text-blue-300",
    "#b45309": "bg-amber-100 border-amber-300 text-amber-800 dark:bg-amber-900/30 dark:border-amber-700 dark:text-amber-300",
    "#15803d": "bg-emerald-100 border-emerald-300 text-emerald-800 dark:bg-emerald-900/30 dark:border-emerald-700 dark:text-emerald-300",
    "#86198f": "bg-fuchsia-100 border-fuchsia-300 text-fuchsia-800 dark:bg-fuchsia-900/30 dark:border-fuchsia-700 dark:text-fuchsia-300",
    "#9f1239": "bg-rose-100 border-rose-300 text-rose-800 dark:bg-rose-900/30 dark:border-rose-700 dark:text-rose-300",
  };
  return colorMap[couleur] ?? "bg-green-100 border-green-300 text-green-800 dark:bg-green-900/30 dark:border-green-700 dark:text-green-300";
}

function AddCreneauModal({
  classeId,
  classes,
  matieres,
  enseignants,
  matiereToEnseignants,
  salles,
  disponibilites,
  emploisExistants,
  gridConfig,
  onClose,
  onAdded,
}: {
  classeId: string;
  classes: Classe[];
  matieres: Matiere[];
  enseignants: Enseignant[];
  matiereToEnseignants: Record<string, { id: string; user: { name: string | null } }[]>;
  salles: Salle[];
  disponibilites: Disponibilite[];
  emploisExistants: EmploiCreneau[];
  gridConfig: GridConfig;
  onClose: () => void;
  onAdded: (c: EmploiCreneau) => void;
}) {
  const t = useTranslations("emploi");
  const { slots: availableSlots, durations, isFineGrid, stepMinutes } = gridConfig;
  // Durée par défaut : 60 min en grille standard, 30 min en grille fine.
  const defaultDuration = isFineGrid ? 30 : 60;
  const [selectedDuration, setSelectedDuration] = useState<number>(defaultDuration);
  const [form, setForm] = useState({
    classeId,
    matiereId: matieres[0]?.id ?? "",
    enseignantId: "",
    jour: "DIMANCHE" as Jour,
    heureDebut: availableSlots[0] ?? "07:00",
    heureFin: computeEndTime(availableSlots[0] ?? "07:00", defaultDuration),
    salle: "",
  });
  const [isPending, startTransition] = useTransition();

  // Slots de début valides pour la durée sélectionnée (ne dépassant pas 18:00).
  const validStartSlots = useMemo(
    () => getValidStartSlots(availableSlots, selectedDuration),
    [availableSlots, selectedDuration],
  );

  // Quand la durée change, recalculer l'heure de fin.
  function changeDuration(newDuration: number) {
    setSelectedDuration(newDuration);
    const newFin = computeEndTime(form.heureDebut, newDuration);
    // Si la nouvelle heure de fin dépasse 18:00, reculer l'heure de début.
    if (timeToMinutes(newFin) > timeToMinutes("18:00")) {
      const newDebutMin = timeToMinutes("18:00") - newDuration;
      const newDebut = `${String(Math.floor(newDebutMin / 60)).padStart(2, "0")}:${String(newDebutMin % 60).padStart(2, "0")}`;
      setForm({ ...form, heureDebut: newDebut, heureFin: "18:00" });
    } else {
      setForm({ ...form, heureFin: newFin });
    }
  }

  // Naviguer dans la liste des durées avec les flèches haut/bas.
  function cycleDuration(direction: "up" | "down") {
    const idx = durations.indexOf(selectedDuration as never);
    if (direction === "up") {
      const nextIdx = idx > 0 ? idx - 1 : durations.length - 1;
      changeDuration(durations[nextIdx]);
    } else {
      const nextIdx = idx < durations.length - 1 ? idx + 1 : 0;
      changeDuration(durations[nextIdx]);
    }
  }

  // Quand l'heure de début change, recalculer l'heure de fin selon la durée.
  function changeHeureDebut(newDebut: string) {
    const newFin = computeEndTime(newDebut, selectedDuration);
    setForm({ ...form, heureDebut: newDebut, heureFin: newFin });
  }

  // Filter enseignants: only those who already teach the selected matiere
  const filteredEnseignants = matiereToEnseignants[form.matiereId] ?? [];

  // Check if the selected enseignant is available at the chosen day/time
  const enseignantDisponible = (() => {
    if (!form.enseignantId) return true;
    const dispo = disponibilites.filter(
      (d) => d.enseignantId === form.enseignantId && d.jour === form.jour
    );
    if (dispo.length === 0) return false; // No availability set for this day
    const debutMin = timeToMinutes(form.heureDebut);
    const finMin = timeToMinutes(form.heureFin);
    return dispo.some(
      (d) => timeToMinutes(d.heureDebut) <= debutMin && timeToMinutes(d.heureFin) >= finMin
    );
  })();

  // Filter salles: only those not occupied at the chosen day/time
  const sallesDisponibles = (() => {
    const debutMin = timeToMinutes(form.heureDebut);
    const finMin = timeToMinutes(form.heureFin);
    return salles.filter((s) => {
      // Check if any existing creneau uses this salle at the same time
      const occupe = emploisExistants.some((e) => {
        if (e.salle !== s.nom) return false;
        if (e.jour !== form.jour) return false;
        const eDebut = timeToMinutes(e.heureDebut);
        const eFin = timeToMinutes(e.heureFin);
        return eDebut < finMin && eFin > debutMin; // overlap
      });
      return !occupe;
    });
  })();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        const res = await fetch("/api/emploi-du-temps", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? t("deleteError"));
        onAdded(data);
        toast.success(t("slotAddedToast"));
        onClose();
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : t("deleteError"));
      }
    });
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md">
        <div className="p-6 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold">{t("newSlot")}</h2>
        </div>
        <form onSubmit={submit} className="p-6 space-y-4">
          <div>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">{t("class")}</label>
            <select
              required
              value={form.classeId}
              onChange={(e) => setForm({ ...form, classeId: e.target.value })}
              className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-green-500"
            >
              {classes.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">{t("subjectLabel")}</label>
            <select
              required
              value={form.matiereId}
              onChange={(e) => setForm({ ...form, matiereId: e.target.value, enseignantId: "" })}
              className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-green-500"
            >
              {matieres.map((m) => <option key={m.id} value={m.id}>{m.nom}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">{t("teacherLabel")}</label>
            {filteredEnseignants.length > 0 ? (
              <select
                value={form.enseignantId}
                onChange={(e) => setForm({ ...form, enseignantId: e.target.value })}
                className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                <option value="">{t("unassigned")}</option>
                {filteredEnseignants.map((e) => <option key={e.id} value={e.id}>{e.user.name ?? t("teacherLabel")}</option>)}
              </select>
            ) : (
              <p className="text-xs text-gray-400 italic py-2">
                {t("noTeacherForMatiere")}
              </p>
            )}
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">{t("dayLabel")}</label>
            <select
              required
              value={form.jour}
              onChange={(e) => setForm({ ...form, jour: e.target.value as Jour })}
              className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-green-500"
            >
              {JOURS.map((j) => <option key={j} value={j}>{t(`daysShort.${j}`)}</option>)}
            </select>
          </div>
          {/* Sélecteur de durée à flèches (maternel/primaire) ou select standard */}
          {isFineGrid ? (
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">
                {t("durationLabel")}
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => cycleDuration("down")}
                  className="flex-shrink-0 w-9 h-9 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center justify-center transition-colors"
                  aria-label={t("durationDecrease")}
                >
                  <Minus className="w-4 h-4" />
                </button>
                <div className="flex-1 text-center border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-gray-50 dark:bg-gray-800 font-semibold">
                  {selectedDuration} min
                  <span className="block text-xs font-normal text-gray-400 mt-0.5">
                    {form.heureDebut} → {form.heureFin}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => cycleDuration("up")}
                  className="flex-shrink-0 w-9 h-9 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center justify-center transition-colors"
                  aria-label={t("durationIncrease")}
                >
                  <ChevronUp className="w-4 h-4" />
                </button>
              </div>
              {/* Quick-pick des durées disponibles */}
              <div className="flex flex-wrap gap-1.5 mt-2">
                {durations.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => changeDuration(d)}
                    className={cn(
                      "px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
                      selectedDuration === d
                        ? "bg-green-600 text-white"
                        : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700",
                    )}
                  >
                    {d}min
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div className={isFineGrid ? "grid grid-cols-1 gap-3" : "grid grid-cols-2 gap-3"}>
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">{t("startLabel")}</label>
              <select
                required
                value={form.heureDebut}
                onChange={(e) => changeHeureDebut(e.target.value)}
                className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                {validStartSlots.map((slot) => <option key={slot} value={slot}>{slot}</option>)}
              </select>
            </div>
            {!isFineGrid && (
              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">{t("endLabel")}</label>
                <select
                  required
                  value={form.heureFin}
                  onChange={(e) => setForm({ ...form, heureFin: e.target.value })}
                  className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-green-500"
                >
                  {availableSlots.slice(1).map((slot) => <option key={slot} value={slot}>{slot}</option>)}
                </select>
              </div>
            )}
          </div>
          {/* Avertissement disponibilité enseignant */}
          {form.enseignantId && !enseignantDisponible && (
            <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-400 rounded-lg p-2.5">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{t("teacherNotAvailable", { jour: t(`daysShort.${form.jour}`), debut: form.heureDebut, fin: form.heureFin })}</span>
            </div>
          )}
          {form.enseignantId && enseignantDisponible && (
            <div className="flex items-center gap-2 text-xs text-green-700 bg-green-50 dark:bg-green-900/20 dark:text-green-400 rounded-lg p-2.5">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
              <span>{t("teacherAvailable")}</span>
            </div>
          )}
          <div>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">
              {t("roomLabel")} {sallesDisponibles.length > 0 && <span className="text-xs text-gray-400">({t("roomsAvailable", { count: sallesDisponibles.length })})</span>}
            </label>
            {salles.length === 0 ? (
              <p className="text-xs text-gray-400 italic py-2">
                {t("noRooms")}
              </p>
            ) : sallesDisponibles.length > 0 ? (
              <select
                value={form.salle}
                onChange={(e) => setForm({ ...form, salle: e.target.value })}
                className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                <option value="">{t("noRoom")}</option>
                {sallesDisponibles.map((s) => (
                  <option key={s.id} value={s.nom}>
                    {s.nom}{s.capacite ? ` (cap. ${s.capacite})` : ""}{s.type ? ` — ${s.type}` : ""}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-xs text-amber-600 italic py-2">
                {t("allRoomsOccupied")}
              </p>
            )}
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose}>{t("cancel")}</Button>
            <Button
              type="submit"
              disabled={isPending || (form.enseignantId !== "" && !enseignantDisponible)}
              className="flex-1 bg-green-600 hover:bg-green-700 text-white"
            >
              {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : t("addBtn")}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function EmploiDuTempsView({
  classes,
  matieres,
  enseignants,
  emplois: initial,
  matiereToEnseignants,
  salles,
  disponibilites,
  userRole,
  readOnly = false,
}: {
  classes: Classe[];
  matieres: Matiere[];
  enseignants: Enseignant[];
  emplois: EmploiCreneau[];
  matiereToEnseignants: Record<string, { id: string; user: { name: string | null } }[]>;
  salles: Salle[];
  disponibilites: Disponibilite[];
  tenantId: string;
  userRole?: string;
  /**
   * Consultation seule (enseignant) : masque la création, la suppression,
   * les suggestions IA et le glisser-déposer. Un enseignant consulte son
   * planning, il ne remodèle pas celui de ses collègues.
   */
  readOnly?: boolean;
}) {
  const t = useTranslations("emploi");
  const canWrite = hasPermission(userRole, "emploi-du-temps:write");
  const [emplois, setEmplois] = useState<EmploiCreneau[]>(initial);
  const [selectedClasse, setSelectedClasse] = useState<Classe | null>(classes[0] ?? null);
  const [showAdd, setShowAdd] = useState(false);
  const [showSuggest, setShowSuggest] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverSlot, setDragOverSlot] = useState<{ jour: Jour; time: string } | null>(null);
  const dragOffsetRef = useRef(0);

  // Configuration de grille dynamique : grille fine (pas de 10 min) pour le
  // maternel et le primaire, grille standard (pas de 30 min) pour le collège/lycée.
  // La détection se fait sur le type de la Structure de la classe sélectionnée.
  const gridConfig = useMemo<GridConfig>(() => {
    const structureType = getStructureTypeFromClasse(selectedClasse);
    return getGridConfig(structureType);
  }, [selectedClasse]);

  // Slots et hauteur utilisés dans tout le rendu de la grille.
  const ALL_SLOTS = gridConfig.slots;
  const SLOT_HEIGHT = gridConfig.slotHeight;

  // État des accordéons : catégories (structures) et niveaux dépliés.
  // La catégorie de la classe sélectionnée est automatiquement dépliée.
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());
  const [expandedLevels, setExpandedLevels] = useState<Set<string>>(new Set());

  // Hiérarchie : catégorie (structure) → niveau → classes.
  // Les classes sans structure sont regroupées sous "— Hors catégorie —".
  const hierarchy = useMemo(() => {
    const map = new Map<string, { id: string; nom: string; type: string; niveaux: Map<string, Classe[]> }>();
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
    // Tri des catégories par type (MATERNELLE < PRIMAIRE < COLLEGE < LYCEE), puis par nom
    const typeOrder: Record<string, number> = { MATERNELLE: 0, PRIMAIRE: 1, COLLEGE: 2, LYCEE: 3 };
    return [...map.values()].sort((a, b) => {
      const ta = typeOrder[a.type] ?? 99;
      const tb = typeOrder[b.type] ?? 99;
      if (ta !== tb) return ta - tb;
      return a.nom.localeCompare(b.nom);
    });
  }, [classes, t]);

  // Déplie automatiquement la catégorie + niveau de la classe sélectionnée
  useEffect(() => {
    if (!selectedClasse) return;
    const catKey = selectedClasse.structure?.id ?? "__none__";
    const levelKey = `${catKey}::${selectedClasse.niveau}`;
    setExpandedCats((prev) => (prev.has(catKey) ? prev : new Set(prev).add(catKey)));
    setExpandedLevels((prev) => (prev.has(levelKey) ? prev : new Set(prev).add(levelKey)));
  }, [selectedClasse]);

  function toggleCat(key: string) {
    setExpandedCats((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function toggleLevel(key: string) {
    setExpandedLevels((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  // Mémoïsé : recalculé à chaque rendu, ce tableau changeait d'identité en
  // permanence et invalidait le `useCallback` de déplacement de créneau, qui
  // en dépend — la mémoïsation ne servait donc plus à rien.
  // Fusionne les créneaux adjacents de même matière (même jour, même matière,
  // heure de fin de l'un = heure de début du suivant) en un seul créneau.
  const classeEmplois = useMemo(() => {
    if (!selectedClasse) return [];
    const filtered = emplois.filter(
      (e) =>
        e.classe.nom === selectedClasse.nom ||
        (e as { classeId?: string }).classeId === selectedClasse.id
    );

    // Grouper par jour
    const byDay = new Map<Jour, typeof filtered>();
    for (const e of filtered) {
      const day = e.jour;
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day)!.push(e);
    }

    // Pour chaque jour, fusionner les créneaux adjacents de même matière
    const merged: typeof filtered = [];
    for (const [, dayCreneaux] of byDay) {
      // Trier par heure de début
      const sorted = [...dayCreneaux].sort((a, b) => a.heureDebut.localeCompare(b.heureDebut));
      const stack: typeof sorted = [];

      for (const current of sorted) {
        const prev = stack[stack.length - 1];
        if (
          prev &&
          prev.matiere.nom === current.matiere.nom &&
          prev.heureFin === current.heureDebut &&
          // Ne pas fusionner si l'enseignant ou la salle diffère
          (prev.enseignant?.user?.name ?? null) === (current.enseignant?.user?.name ?? null) &&
          (prev.salle ?? null) === (current.salle ?? null)
        ) {
          // Fusionner : étendre la fin du précédent
          stack[stack.length - 1] = {
            ...prev,
            heureFin: current.heureFin,
          };
        } else {
          stack.push(current);
        }
      }
      merged.push(...stack);
    }

    return merged;
  }, [selectedClasse, emplois]);
  const classeEmplois = useMemo(
    () =>
      selectedClasse
        ? emplois.filter(
          )
        : [],
    [selectedClasse, emplois]

  function addCreneau(c: EmploiCreneau) {
    setEmplois((prev) => [...prev, c]);
  }

  function deleteCreneau(id: string) {
    startTransition(async () => {
      try {
        const res = await fetch(`/api/emploi-du-temps/${id}`, { method: "DELETE" });
        if (!res.ok) throw new Error();
        setEmplois((prev) => prev.filter((e) => e.id !== id));
        toast.success(t("slotDeletedToast"));
      } catch {
        toast.error(t("deleteError"));
      }
    });
  }

  // Drag-and-drop: move a creneau to a new day/time
  const moveCreneau = useCallback(async (id: string, newJour: Jour, newHeureDebut: string) => {
    const creneau = emplois.find((e) => e.id === id);
    if (!creneau) return;

    const oldDebut = creneau.heureDebut;
    const oldFin = creneau.heureFin;
    const durationMin = timeToMinutes(oldFin) - timeToMinutes(oldDebut);
    const newDebutMin = timeToMinutes(newHeureDebut);
    const newFinMin = newDebutMin + durationMin;
    const newHeureFin = `${String(Math.floor(newFinMin / 60)).padStart(2, "0")}:${String(newFinMin % 60).padStart(2, "0")}`;

    if (creneau.jour === newJour && creneau.heureDebut === newHeureDebut) return;

    // Check conflicts with existing creneaux at the target slot
    const draggedGroup = parseGroupe(creneau.salle).groupe;
    const conflicting = classeEmplois.filter((c) => {
      if (c.id === id) return false; // skip self
      if (c.jour !== newJour) return false;
      const cDebut = timeToMinutes(c.heureDebut);
      const cFin = timeToMinutes(c.heureFin);
      // Check time overlap
      return newDebutMin < cFin && newFinMin > cDebut;
    });

    for (const other of conflicting) {
      const otherGroup = parseGroupe(other.salle).groupe;
      // Two different groups (A + B) can share the same slot
      if (draggedGroup && otherGroup && draggedGroup !== otherGroup) continue;
      // Any other combination is a conflict — show clear feedback
      const reason = !draggedGroup && !otherGroup
        ? t("conflictBothTroncCommun")
        : !draggedGroup || !otherGroup
        ? t("conflictTroncCommunGroup")
        : t("conflictSameGroup", { group: draggedGroup ?? "" });
      toast.error(reason, { duration: 5000 });
      return;
    }

    // Optimistic update
    setEmplois((prev) =>
      prev.map((e) =>
        e.id === id ? { ...e, jour: newJour, heureDebut: newHeureDebut, heureFin: newHeureFin } : e
      )
    );

    try {
      const res = await fetch(`/api/emploi-du-temps/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jour: newJour, heureDebut: newHeureDebut, heureFin: newHeureFin }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? t("moveError"));
      }
      toast.success(t("slotMovedToast", { jour: t(`daysShort.${newJour}`), heure: newHeureDebut }));
    } catch (e: unknown) {
      // Revert on error
      setEmplois((prev) =>
        prev.map((e) =>
          e.id === id ? { ...e, jour: creneau.jour, heureDebut: oldDebut, heureFin: oldFin } : e
        )
      );
      toast.error(e instanceof Error ? e.message : t("moveError"), { duration: 5000 });
    }
  }, [emplois, classeEmplois, t]);

  // Render a single day column (drop zones)
  function renderDayColumn(jour: Jour) {
    return (
      <div key={jour} className="relative border-l border-gray-100 dark:border-gray-800">
        {ALL_SLOTS.map((time, idx) => {
          const isDropTarget = dragOverSlot?.jour === jour && dragOverSlot?.time === time;
          // Pause déjeuner : 12:00 → 14:00. En grille fine, tous les slots de
          // cette plage sont grisés ; en grille standard, seulement 12:30/13:00/13:30.
          const timeMin = timeToMinutes(time);
          const isLunch = timeMin >= 720 && timeMin < 840;
          // Alternance de fond : en grille fine, alterner toutes les 3 cellules
          // (toutes les 30 min) pour rester lisible ; en standard, toutes les 2.
          const altInterval = gridConfig.isFineGrid ? 6 : 2;
          return (
            <div
              key={time}
              className={cn(
                "border-b border-gray-100 dark:border-gray-800 relative transition-colors",
                isLunch
                  ? "bg-gray-100/50 dark:bg-gray-800/50"
                  : Math.floor(idx / altInterval) % 2 === 0 ? "bg-white dark:bg-gray-900" : "bg-gray-50/50 dark:bg-gray-800/30",
                isDropTarget && "bg-green-100 dark:bg-green-900/30 ring-2 ring-green-400 ring-inset"
              )}
              style={{ height: SLOT_HEIGHT }}
              onDragOver={(e) => {
                if (draggedId) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setDragOverSlot({ jour, time });
                }
              }}
              onDragEnter={(e) => {
                if (draggedId) {
                  e.preventDefault();
                }
              }}
              onDragLeave={() => {
                if (dragOverSlot?.jour === jour && dragOverSlot?.time === time) {
                  setDragOverSlot(null);
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (readOnly) return;
                if (draggedId) {
                  moveCreneau(draggedId, jour, time);
                  setDraggedId(null);
                  setDragOverSlot(null);
                }
              }}
            />
          );
        })}
      </div>
    );
  }

  // Render creneaux as absolutely positioned overlays. Les créneaux qui
  // partagent exactement le même horaire (sessions dédoublées en groupes
  // A/B) sont regroupés et affichés côte à côte plutôt que superposés — sans
  // ça, un seul des deux groupes était visible/cliquable.
  function renderCreneauxForDay(jour: Jour) {
    const jourCreneaux = classeEmplois.filter((c) => c.jour === jour);

    const parHoraire = new Map<string, EmploiCreneau[]>();
    for (const c of jourCreneaux) {
      const key = `${c.heureDebut}-${c.heureFin}`;
      if (!parHoraire.has(key)) parHoraire.set(key, []);
      parHoraire.get(key)!.push(c);
    }

    return [...parHoraire.values()].map((group) => {
      // Calcul basé sur les minutes plutôt que sur l'index du slot : un créneau
      // peut ne pas être aligné sur la grille (ex: 07:00-07:35 en grille 10 min).
      const debutMin = timeToMinutes(group[0].heureDebut);
      const finMin = timeToMinutes(group[0].heureFin);
      const gridStartMin = timeToMinutes(ALL_SLOTS[0]);
      const stepMin = gridConfig.stepMinutes;
      const startIdx = (debutMin - gridStartMin) / stepMin;
      const endIdx = (finMin - gridStartMin) / stepMin;
      if (startIdx < 0 || endIdx < 0 || endIdx < startIdx) return null;

      const top = startIdx * SLOT_HEIGHT;
      const height = (endIdx - startIdx) * SLOT_HEIGHT;

      return (
        <div
          key={`${jour}-${group[0].heureDebut}-${group[0].heureFin}`}
          className="absolute left-1 right-1 flex gap-1 pointer-events-none"
          style={{ top: top + 2, height: height - 4 }}
        >
          {group.map((creneau) => {
            const { salleAffichee, groupe } = parseGroupe(creneau.salle);
            return (
              <div
                key={creneau.id}
                draggable={!readOnly}
                onDragStart={(e) => {
                  console.log('[drag-drop] dragStart on creneau', creneau.id, creneau.matiere.nom);
                  if (readOnly) return;
                  setDraggedId(creneau.id);
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", creneau.id);
                }}
                onDragEnd={() => {
                  setDraggedId(null);
                  setDragOverSlot(null);
                }}
                className={cn(
                  "relative flex-1 min-w-0 rounded-lg border overflow-hidden group transition-all",
                  readOnly ? "cursor-default" : "cursor-grab active:cursor-grabbing",
                  matiereColor(creneau.matiere.couleur),
                  draggedId === creneau.id && "opacity-50 ring-2 ring-green-500",
                  // When dragging, disable pointer-events on all cards so drop events
                  // reach the grid cells underneath. The dragged card keeps pointer-events
                  // so the dragstart/dragend still work.
                  draggedId && draggedId !== creneau.id ? "pointer-events-none" : "pointer-events-auto"
                )}
              >
                <div className="p-1.5 h-full flex flex-col justify-between">
                  <div className="flex items-start gap-1">
                    <GripVertical className="w-3 h-3 opacity-40 flex-shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold leading-tight truncate uppercase">
                        {creneau.matiere.nom}
                        {selectedClasse?.niveau && (
                          <span className="ml-1 opacity-75">
                            {niveauToNumero(selectedClasse.niveau)}
                          </span>
                        )}
                        {groupe && <span className="ml-1 opacity-70">· Gr.{groupe}</span>}
                      </p>
                    </div>
                  </div>
                  <div className="text-xs opacity-70 leading-tight">
                    {height >= 64 && creneau.enseignant && (
                      <p className="truncate">{creneau.enseignant.user.name}</p>
                    )}
                    {height >= 48 && salleAffichee && (
                      <p className="truncate">{salleAffichee}</p>
                    )}
                    <p>{creneau.heureDebut}→{creneau.heureFin}</p>
                  </div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteCreneau(creneau.id); }}
                  className={cn(
                    "absolute top-1 right-1 transition-opacity bg-white dark:bg-gray-800 rounded-full p-0.5 shadow",
                    readOnly ? "hidden" : "opacity-0 group-hover:opacity-100"
                  )}
                  title={t("deleteTitle")}
                >
                  <Trash2 className="w-3 h-3 text-red-500" />
                </button>
              </div>
            );
          })}
        </div>
      );
    });
  }

  // Compteur d'heures hebdo
  const totalHeures = classeEmplois.reduce((sum, c) => {
    return sum + (timeToMinutes(c.heureFin) - timeToMinutes(c.heureDebut)) / 60;
  }, 0);

  // Get available slots for the add modal
  const availableSlotsForAdd = ALL_SLOTS;

  return (
    <div className="space-y-6">
      {/* Styles d'impression : masque les contrôles et optimise la grille */}
      <style>{`
        @media print {
          @page { size: landscape; margin: 10mm; }
          #emploi-print-area {
            box-shadow: none !important;
            border: none !important;
            overflow: visible !important;
            background: white !important;
          }
          #emploi-print-area .min-w-\[900px\] { min-width: auto !important; }
          #emploi-print-area .overflow-x-auto { overflow: visible !important; }
        }
      `}</style>

      {/* Sélecteur de classes — hiérarchie Catégorie → Niveau → Classe (accordéons) */}
      <div className="flex flex-col sm:flex-row sm:items-start gap-4 print:hidden">
        <div className="flex-1 min-w-0 space-y-1.5 max-h-[420px] overflow-y-auto scrollbar-thin pr-1">
          {hierarchy.length === 0 && (
            <p className="text-sm text-gray-400 italic py-4 text-center">{t("noClasses")}</p>
          )}
          {hierarchy.map((cat) => {
            const catExpanded = expandedCats.has(cat.id);
            const catClassCount = [...cat.niveaux.values()].reduce((s, cs) => s + cs.length, 0);
            const catHasSelected = selectedClasse && (selectedClasse.structure?.id ?? "__none__") === cat.id;
            return (
              <div key={cat.id} className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                {/* Niveau 1 : Catégorie (structure pédagogique) */}
                <button
                  onClick={() => toggleCat(cat.id)}
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-2.5 text-sm font-semibold transition-colors",
                    catHasSelected
                      ? "bg-primary/10 dark:bg-primary/20 text-primary"
                      : "bg-gray-50 dark:bg-gray-800/60 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                  )}
                >
                  {catExpanded ? <ChevronDown className="w-4 h-4 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 flex-shrink-0" />}
                  <School className="w-4 h-4 flex-shrink-0 opacity-70" />
                  <span className="truncate">{cat.nom}</span>
                  <span className="ml-auto text-xs font-normal text-gray-400 flex-shrink-0">
                    {t("classCount", { count: catClassCount })}
                  </span>
                </button>
                {catExpanded && (
                  <div className="divide-y divide-gray-100 dark:divide-gray-800">
                    {[...cat.niveaux.entries()]
                      .sort((a, b) => a[0].localeCompare(b[0], "fr"))
                      .map(([niveau, niveauClasses]) => {
                        const levelKey = `${cat.id}::${niveau}`;
                        const levelExpanded = expandedLevels.has(levelKey);
                        const levelHasSelected = selectedClasse && selectedClasse.niveau === niveau && (selectedClasse.structure?.id ?? "__none__") === cat.id;
                        return (
                          <div key={levelKey} className="bg-white dark:bg-gray-900">
                            {/* Niveau 2 : Niveau */}
                            <button
                              onClick={() => toggleLevel(levelKey)}
                              className={cn(
                                "w-full flex items-center gap-2 pl-8 pr-3 py-2 text-sm transition-colors",
                                levelHasSelected
                                  ? "text-primary font-medium"
                                  : "text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/40"
                              )}
                            >
                              {levelExpanded ? <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" />}
                              <span className="truncate">{niveauToLabel(niveau)}</span>
                              <span className="ml-auto text-xs text-gray-400 flex-shrink-0">{niveauClasses.length}</span>
                            </button>
                            {levelExpanded && (
                              /* Niveau 3 : Classes */
                              <div className="flex flex-wrap gap-2 pl-12 pr-3 pb-3 pt-1">
                                {niveauClasses.map((c) => (
                                  <button
                                    key={c.id}
                                    onClick={() => setSelectedClasse(c)}
                                    className={cn(
                                      "px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
                                      selectedClasse?.id === c.id
                                        ? "bg-primary text-white shadow-md"
                                        : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
                                    )}
                                  >
                                    {c.nom}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            );
          })}
      {/* Classe selector */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 print:hidden">
        <div className="flex gap-2 flex-wrap">
          {classes.map((c) => (
                "px-4 py-2 rounded-xl text-sm font-medium transition-all",
        </div>
        <div className="ml-auto flex items-center gap-3">
          {selectedClasse && (
            <span className="text-sm text-gray-500">
              <Clock className="w-4 h-4 inline mr-1" />
              {t("hoursPerWeek", { count: totalHeures })}
            </span>
          )}
          {selectedClasse && gridConfig.isFineGrid && (
            <span className="text-xs px-2 py-1 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 font-medium">
              {t("fineGridMode")}
            </span>
          )}
          <Button
            size="sm"
            variant="outline"
            className="gap-2"
            onClick={() => window.print()}
          >
            <Printer className="w-4 h-4" />
            {t("print")}
          </Button>
          {canWrite && (
          <Button
            onClick={() => setShowImport(true)}
            variant="outline"
            className="gap-2"
            size="sm"
          >
            <Upload className="w-4 h-4" />
            {t("importBtn")}
          </Button>
          )}
          {canWrite && (
          <Button
            onClick={() => setShowSuggest(true)}
            disabled={!selectedClasse}
            className="gap-2 bg-indigo-600 hover:bg-indigo-700 text-white"
            size="sm"
          >
            <Sparkles className="w-4 h-4" />
            {t("optimize")}
          </Button>
          )}
          {canWrite && (
          <Button
            onClick={() => setShowAdd(true)}
            disabled={!selectedClasse}
            className="gap-2 bg-green-600 hover:bg-green-700 text-white"
            size="sm"
          >
            <Plus className="w-4 h-4" />
            {t("addSlotBtn")}
          </Button>
          {!readOnly && (
          {!readOnly && (
          )}
        </div>
      </div>

      {/* Info banner */}
      <div className="text-xs text-gray-500 bg-gray-50 dark:bg-gray-800/50 rounded-lg px-4 py-2 flex items-center gap-2 print:hidden">
        <GripVertical className="w-4 h-4" />
        <span>{gridConfig.isFineGrid ? t("dragHintFine") : t("dragHint")}</span>
      </div>
      {!readOnly && (
          <span>{t("dragHint")}</span>
      )}

      {/* Grille horaire */}
      {selectedClasse ? (
        <Card id="emploi-print-area" className="overflow-hidden">
          <div className="overflow-x-auto">
            <div className="min-w-[900px]">
              {/* Header jours */}
              <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
                <div className="p-3 text-xs text-gray-400 font-medium"></div>
                {JOURS.map((j) => (
                  <div key={j} className="p-3 text-center border-l border-gray-200 dark:border-gray-700">
                    <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">{t(`daysShort.${j}`)}</p>
                  </div>
                ))}
              </div>

              {/* Body: time labels + day columns with creneaux */}
              <div className="relative flex">
                {/* Time labels column */}
                <div className="w-[60px] flex-shrink-0">
                  {ALL_SLOTS.map((time, idx) => {
                    // En grille fine (10 min), afficher un label toutes les
                    // 30 min (tous les 3 slots). En grille standard (30 min),
                    // afficher un label tous les 2 slots (toutes les heures).
                    const labelInterval = gridConfig.isFineGrid ? 3 : 2;
                    const showLabel = idx % labelInterval === 0;
                    return (
                      <div
                        key={time}
                        className="flex items-start justify-end pr-3 pt-1 border-b border-gray-100 dark:border-gray-800"
                        style={{ height: SLOT_HEIGHT }}
                      >
                        {showLabel && <span className="text-xs text-gray-400">{time}</span>}
                      </div>
                    );
                  })}
                </div>

                {/* Day columns container */}
                <div className="flex-1 relative">
                  {/* Grid background (drop zones) */}
                  <div className="grid grid-cols-7 relative">
                    {JOURS.map((jour) => renderDayColumn(jour))}
                  </div>

                  {/* Absolutely positioned creneaux overlay — pointer-events-none on container, auto only on creneaux */}
                  <div className="absolute inset-0 grid grid-cols-7 pointer-events-none">
                    {JOURS.map((jour) => (
                      <div key={jour} className="relative">
                        {renderCreneauxForDay(jour)}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Card>
      ) : (
        <Card>
          <CardContent className="flex items-center justify-center py-16 text-gray-400">
            <p>{t("selectClass")}</p>
          </CardContent>
        </Card>
      )}

      {showAdd && selectedClasse && (
        <AddCreneauModal
          classeId={selectedClasse.id}
          classes={classes}
          matieres={matieres}
          enseignants={enseignants}
          matiereToEnseignants={matiereToEnseignants}
          salles={salles}
          disponibilites={disponibilites}
          emploisExistants={emplois}
          gridConfig={gridConfig}
          onClose={() => setShowAdd(false)}
          onAdded={addCreneau}
        />
      )}

      {showSuggest && selectedClasse && (
        <SmartSuggestPanel
          classeId={selectedClasse.id}
          classeNom={selectedClasse.nom}
          matieres={matieres}
          enseignants={enseignants}
          matiereToEnseignants={matiereToEnseignants}
          onClose={() => setShowSuggest(false)}
          onGenerated={(creneaux) => {
            setEmplois((prev) => [...prev, ...(creneaux as EmploiCreneau[])]);
          }}
          onReplaced={(creneaux) => {
            // auto-generate DELETES all existing creneaux for this class/year in DB
            // So we must REPLACE, not append — remove old creneaux for this class and add new ones
            const newCreneaux = creneaux as EmploiCreneau[];
            setEmplois((prev) => {
              const otherClasses = prev.filter(
                (e) => e.classe.nom !== selectedClasse.nom &&
                       (e as { classeId?: string }).classeId !== selectedClasse.id
              );
              return [...otherClasses, ...newCreneaux];
            });
          }}
        />
      )}

      {showImport && classes.length > 0 && (
        <ImportEmploiModal
          classes={classes}
          initialClasseId={selectedClasse?.id ?? classes[0].id}
          existingCreneaux={emplois as unknown as { id: string; jour: Jour; heureDebut: string; heureFin: string; salle: string | null; matiere: { nom: string; code: string; couleur: string | null }; enseignant: { user: { name: string | null } } | null; classeId?: string }[]}
          onClose={() => setShowImport(false)}
          onImported={(imported, classeId, classeNom) => {
            // bulk-apply remplace tous les créneaux de la classe : on reconstruit
            // l'état local en gardant les autres classes et en ajoutant les nouveaux.
            const newCreneaux = imported.map((c) => ({
              id: `imported-${c.jour}-${c.heureDebut}-${c.matiereId}`,
              jour: c.jour,
              heureDebut: c.heureDebut,
              heureFin: c.heureFin,
              salle: c.salle,
              matiere: {
                nom: c.matiereNom,
                code: "",
                couleur: matieres.find((m) => m.id === c.matiereId)?.couleur ?? null,
              },
              classe: { nom: classeNom },
              enseignant: c.enseignantId
                ? { user: { name: c.enseignantNom } }
                : null,
              classeId,
              matiereId: c.matiereId,
              enseignantId: c.enseignantId,
            })) as EmploiCreneau[];
            setEmplois((prev) => {
              const otherClasses = prev.filter(
                (e) =>
                  e.classe.nom !== classeNom &&
                  (e as { classeId?: string }).classeId !== classeId
              );
              return [...otherClasses, ...newCreneaux];
            });
            // Recharger les données pour récupérer les IDs réels depuis la DB
            window.location.reload();
          }}
        />
      )}
    </div>
  );
}
