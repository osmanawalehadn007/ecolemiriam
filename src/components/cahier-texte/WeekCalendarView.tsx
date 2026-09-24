"use client";

import { useMemo } from "react";
import { StatutSeanceBadge } from "./StatutSeanceBadge";
import { Clock, CalendarDays, Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { StatutSeance } from "@prisma/client";

type CalEntry = {
  id: string;
  date: string;
  heureDebut: string | null;
  heureFin: string | null;
  statut: StatutSeance;
  contenu: string;
  classe: { nom: string; niveau: string };
  matiere: { nom: string; code: string };
  enseignant: { id: string; specialite: string | null; user: { name: string } } | null;
};

const DAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const MONTHS = [
  "Jan", "Fév", "Mar", "Avr", "Mai", "Jun",
  "Jul", "Aoû", "Sep", "Oct", "Nov", "Déc",
];

export function WeekCalendarView({
  entries,
  weekStart,
  onWeekChange,
  onGenerate,
  onEntryClick,
  generating,
}: {
  entries: CalEntry[];
  weekStart: Date; // lundi
  onWeekChange: (delta: number) => void;
  onGenerate: () => void;
  onEntryClick: (id: string) => void;
  generating: boolean;
}) {
  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setUTCDate(weekStart.getUTCDate() + i);
      return d;
    });
  }, [weekStart]);

  // Grouper les entrées par jour
  const entriesByDay = useMemo(() => {
    const map: Record<number, CalEntry[]> = {};
    for (const e of entries) {
      const d = new Date(e.date);
      const dayIdx = (d.getUTCDay() + 6) % 7; // 0 = lundi
      if (!map[dayIdx]) map[dayIdx] = [];
      map[dayIdx].push(e);
    }
    // Trier par heure dans chaque jour
    for (const k of Object.keys(map)) {
      map[Number(k)].sort((a, b) => (a.heureDebut ?? "").localeCompare(b.heureDebut ?? ""));
    }
    return map;
  }, [entries]);

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekStart.getUTCDate() + 6);

  const sameMonth = weekStart.getUTCMonth() === weekEnd.getUTCMonth();
  const weekLabel = sameMonth
    ? `${weekStart.getUTCDate()} – ${weekEnd.getUTCDate()} ${MONTHS[weekEnd.getUTCMonth()]} ${weekEnd.getUTCFullYear()}`
    : `${weekStart.getUTCDate()} ${MONTHS[weekStart.getUTCMonth()]} – ${weekEnd.getUTCDate()} ${MONTHS[weekEnd.getUTCMonth()]} ${weekEnd.getUTCFullYear()}`;

  return (
    <div className="space-y-3">
      {/* Barre de navigation semaine */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => onWeekChange(-1)}>
            ←
          </Button>
          <span className="text-sm font-medium min-w-[180px] text-center">
            {weekLabel}
          </span>
          <Button variant="outline" size="sm" onClick={() => onWeekChange(1)}>
            →
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onWeekChange(0)}
            className="ml-1"
          >
            Cette semaine
          </Button>
        </div>
        <Button
          size="sm"
          variant="default"
          onClick={onGenerate}
          disabled={generating}
        >
          {generating ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Sparkles className="w-4 h-4 mr-2" />
          )}
          Générer depuis l&apos;emploi du temps
        </Button>
      </div>

      {/* Grille 7 colonnes */}
      <div className="grid grid-cols-7 gap-2 min-w-[900px]">
        {weekDays.map((day, i) => {
          const isToday = day.getTime() === today.getTime();
          const dayEntries = entriesByDay[i] ?? [];
          return (
            <div
              key={i}
              className={`rounded-lg border min-h-[200px] ${
                isToday
                  ? "border-primary/40 bg-primary/5"
                  : "border-slate-200 dark:border-slate-800"
              }`}
            >
              {/* En-tête du jour */}
              <div className="px-2 py-1.5 border-b border-slate-200 dark:border-slate-800 text-center">
                <div className="text-xs font-semibold text-slate-500 uppercase">
                  {DAYS[i]}
                </div>
                <div
                  className={`text-lg font-bold ${
                    isToday
                      ? "text-primary"
                      : "text-slate-700 dark:text-slate-300"
                  }`}
                >
                  {day.getUTCDate()}
                </div>
              </div>

              {/* Séances du jour */}
              <div className="p-1.5 space-y-1.5">
                {dayEntries.length === 0 ? (
                  <div className="text-center py-4">
                    <CalendarDays className="w-5 h-5 mx-auto text-slate-300 dark:text-slate-700 mb-1" />
                    <p className="text-[10px] text-slate-400">Aucune séance</p>
                  </div>
                ) : (
                  dayEntries.map((entry) => (
                    <button
                      key={entry.id}
                      onClick={() => onEntryClick(entry.id)}
                      className="w-full text-left rounded-md p-2 border transition-all hover:shadow-sm hover:-translate-y-0.5"
                      style={{
                        backgroundColor:
                          entry.statut === "PLANIFIEE"
                            ? "rgb(241 245 249 / 0.5)"
                            : entry.statut === "EFFECTUEE"
                              ? "rgb(220 252 231 / 0.4)"
                              : entry.statut === "CLOTUREE"
                                ? "rgb(219 234 254 / 0.4)"
                                : entry.statut === "ANNULEE"
                                  ? "rgb(254 226 226 / 0.3)"
                                  : undefined,
                        borderColor:
                          entry.statut === "PLANIFIEE"
                            ? "rgb(203 213 225)"
                            : entry.statut === "EFFECTUEE"
                              ? "rgb(190 242 100)"
                              : entry.statut === "CLOTUREE"
                                ? "rgb(147 197 253)"
                                : entry.statut === "ANNULEE"
                                  ? "rgb(252 165 165)"
                                  : "rgb(203 213 225)",
                      }}
                    >
                      <div className="flex items-center gap-1 mb-1">
                        {entry.heureDebut && (
                          <span className="text-[10px] text-slate-500 flex items-center gap-0.5">
                            <Clock className="w-2.5 h-2.5" />
                            {entry.heureDebut}
                          </span>
                        )}
                      </div>
                      <p className="text-xs font-semibold truncate">
                        {entry.classe.nom}
                      </p>
                      <p className="text-[11px] text-slate-600 dark:text-slate-400 truncate">
                        {entry.matiere.nom}
                      </p>
                      <div className="mt-1">
                        <StatutSeanceBadge statut={entry.statut} />
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
