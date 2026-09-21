"use client";

import { useState, useMemo, useEffect, useTransition } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getInitials } from "@/lib/utils";
import { CheckCircle2, XCircle, Clock, Users, CheckCheck, RotateCcw, ChevronRight, ChevronDown, School } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

interface Eleve {
  id: string;
  nom: string;
  prenom: string;
  photoUrl: string | null;
  sexe: string;
  matricule: string;
}

interface Classe {
  id: string;
  nom: string;
  niveau: string;
  structure: { id: string; nom: string; type: string } | null;
  eleves: Eleve[];
}

interface Emploi {
  classeId: string;
  jour: string;
  heureDebut: string;
  heureFin: string;
}

type Presence = "present" | "absent" | "retard" | null;

// Mapping getDay() (0=dimanche) → valeur de l'enum Jour Prisma
const JS_DAY_TO_JOUR = [
  "DIMANCHE", "LUNDI", "MARDI", "MERCREDI", "JEUDI", "VENDREDI", "SAMEDI",
] as const;

const TYPE_ORDER: Record<string, number> = { MATERNELLE: 0, PRIMAIRE: 1, COLLEGE: 2, LYCEE: 3 };

const TYPE_LABELS: Record<string, { fr: string; color: string }> = {
  MATERNELLE: { fr: "Maternelle", color: "text-pink-600 dark:text-pink-400" },
  PRIMAIRE: { fr: "Primaire", color: "text-blue-600 dark:text-blue-400" },
  COLLEGE: { fr: "Collège", color: "text-green-600 dark:text-green-400" },
  LYCEE: { fr: "Lycée", color: "text-purple-600 dark:text-purple-400" },
};

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function minutesToTime(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Date locale → string YYYY-MM-DD pour <input type="date"> */
function toDateInput(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Heure actuelle arrondie au pas de 5 min le plus proche */
function currentTimeRounded(step = 5): string {
  const now = new Date();
  const totalMin = now.getHours() * 60 + now.getMinutes();
  return minutesToTime(Math.round(totalMin / step) * step);
}

export function AppelInterface({
  classes,
  emplois,
  tenantId,
}: {
  classes: Classe[];
  emplois: Emploi[];
  tenantId: string;
}) {
  const t = useTranslations("absences");

  // ── États ──────────────────────────────────────────────────
  const [selectedClasseId, setSelectedClasseId] = useState<string>("");
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());
  const [selectedDate, setSelectedDate] = useState<string>(toDateInput(new Date()));
  const [selectedCreneauIdx, setSelectedCreneauIdx] = useState<number>(-1);
  const [presences, setPresences] = useState<Record<string, Presence>>({});
  const [retardArrivees, setRetardArrivees] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();
  const [submitted, setSubmitted] = useState(false);

  // ── Hiérarchie : catégorie (structure) → classes ───────────
  const hierarchy = useMemo(() => {
    const map = new Map<string, { id: string; nom: string; type: string; classes: Classe[] }>();
    for (const c of classes) {
      const catKey = c.structure?.id ?? "__none__";
      const catNom = c.structure?.nom ?? t("noCategory");
      const catType = c.structure?.type ?? "";
      if (!map.has(catKey)) {
        map.set(catKey, { id: catKey, nom: catNom, type: catType, classes: [] });
      }
      map.get(catKey)!.classes.push(c);
    }
    return [...map.values()].sort((a, b) => {
      const ta = TYPE_ORDER[a.type] ?? 99;
      const tb = TYPE_ORDER[b.type] ?? 99;
      if (ta !== tb) return ta - tb;
      return a.nom.localeCompare(b.nom);
    });
  }, [classes, t]);

  const selectedClasse = classes.find((c) => c.id === selectedClasseId);
  const eleves = selectedClasse?.eleves ?? [];

  // ── Créneaux d'1h pour la classe sélectionnée et le jour choisi ──
  // Générés à partir de l'emploi du temps : de 07:30 jusqu'à la fin du
  // dernier cours de la classe ce jour-là. Si pas de cours, défaut 07:30→17:00.
  const creneaux = useMemo(() => {
    if (!selectedClasseId) return [];
    const classe = classes.find((c) => c.id === selectedClasseId);
    if (!classe) return [];
    const dateObj = new Date(selectedDate + "T00:00:00");
    const jourEnum = JS_DAY_TO_JOUR[dateObj.getDay()];

    const dayEmplois = emplois.filter(
      (e) => e.classeId === classe.id && e.jour === jourEnum,
    );

    let endMin = timeToMinutes("17:00"); // défaut si pas d'emploi du temps
    if (dayEmplois.length > 0) {
      endMin = Math.max(...dayEmplois.map((e) => timeToMinutes(e.heureFin)));
    }

    const startMin = timeToMinutes("07:30");
    const slots: { debut: string; fin: string }[] = [];
    for (let m = startMin; m < endMin; m += 60) {
      const fin = Math.min(m + 60, endMin);
      slots.push({ debut: minutesToTime(m), fin: minutesToTime(fin) });
    }
    return slots;
  }, [selectedClasseId, selectedDate, emplois, classes]);

  // ── Auto-sélection du créneau selon l'heure courante ────────
  // Quand on sélectionne une classe ou change de jour, on détermine
  // automatiquement le créneau : celui qui contient l'heure actuelle si
  // la date choisie est aujourd'hui, sinon le premier créneau de la journée.
  useEffect(() => {
    if (creneaux.length === 0) {
      setSelectedCreneauIdx(-1);
      return;
    }
    const today = new Date();
    const isToday = selectedDate === toDateInput(today);
    if (!isToday) {
      setSelectedCreneauIdx(0);
      return;
    }
    const nowMin = today.getHours() * 60 + today.getMinutes();
    let found = -1;
    for (let i = 0; i < creneaux.length; i++) {
      const d = timeToMinutes(creneaux[i].debut);
      const f = timeToMinutes(creneaux[i].fin);
      if (nowMin >= d && nowMin < f) { found = i; break; }
    }
    if (found === -1) {
      // Avant le 1er créneau → 1er ; après le dernier → dernier
      found = nowMin < timeToMinutes(creneaux[0].debut) ? 0 : creneaux.length - 1;
    }
    setSelectedCreneauIdx(found);
  }, [creneaux, selectedDate]);

  const selectedCreneau = creneaux[selectedCreneauIdx] ?? null;

  // ── Stats ──────────────────────────────────────────────────
  const stats = {
    total: eleves.length,
    presents: Object.values(presences).filter((p) => p === "present").length,
    absents: Object.values(presences).filter((p) => p === "absent").length,
    retards: Object.values(presences).filter((p) => p === "retard").length,
    nonSaisis: eleves.filter((e) => !presences[e.id]).length,
  };

  // ── Actions ─────────────────────────────────────────────────
  function toggleCat(key: string) {
    setExpandedCats((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function selectClasse(classeId: string) {
    setSelectedClasseId(classeId);
    setPresences({});
    setRetardArrivees({});
    setSubmitted(false);
  }

  function setPresence(eleveId: string, status: Presence) {
    setPresences((prev) => ({ ...prev, [eleveId]: status }));
    // Initialiser l'heure d'arrivée par défaut pour un retard
    if (status === "retard" && !retardArrivees[eleveId]) {
      setRetardArrivees((prev) => ({ ...prev, [eleveId]: currentTimeRounded(5) }));
    }
  }

  function setRetardArrivee(eleveId: string, time: string) {
    setRetardArrivees((prev) => ({ ...prev, [eleveId]: time }));
  }

  function marquerTousPresents() {
    const all: Record<string, Presence> = {};
    eleves.forEach((e) => { all[e.id] = "present"; });
    setPresences(all);
    setRetardArrivees({});
  }

  function reset() {
    setPresences({});
    setRetardArrivees({});
    setSubmitted(false);
  }

  async function soumettre() {
    if (stats.nonSaisis > 0) {
      toast.warning(t("appelNotSetWarn", { count: stats.nonSaisis }));
      return;
    }
    if (!selectedCreneau) {
      toast.error(t("appelNoCreneau"));
      return;
    }
    startTransition(async () => {
      try {
        // Construire la date ISO à partir du jour sélectionné + début du créneau
        const dateObj = new Date(selectedDate + "T00:00:00");
        const [h, m] = selectedCreneau.debut.split(":").map(Number);
        dateObj.setHours(h, m, 0, 0);

        // Retards → map eleveId → heure d'arrivée
        const retardsHeureArrivee: Record<string, string> = {};
        for (const [eleveId, status] of Object.entries(presences)) {
          if (status === "retard" && retardArrivees[eleveId]) {
            retardsHeureArrivee[eleveId] = retardArrivees[eleveId];
          }
        }

        const res = await fetch("/api/absences/appel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            classeId: selectedClasseId,
            date: dateObj.toISOString(),
            heureDebut: selectedCreneau.debut,
            heureFin: selectedCreneau.fin,
            presences,
            retardsHeureArrivee,
          }),
        });
        if (!res.ok) throw new Error();
        const data = await res.json();
        setSubmitted(true);
        toast.success(data.message ?? t("appelSuccess"));
      } catch {
        toast.error(t("appelError"));
      }
    });
  }

  // ── Options d'heure d'arrivée (pas de 5 min, de 07:30 à 18:00) ──
  const arrivalOptions = useMemo(() => {
    const opts: string[] = [];
    for (let m = timeToMinutes("07:30"); m <= timeToMinutes("18:00"); m += 5) {
      opts.push(minutesToTime(m));
    }
    return opts;
  }, []);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
      {/* ── Colonne gauche : catégories + classes + récap ── */}
      <div className="lg:col-span-1 space-y-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">{t("appelCategories")}</CardTitle>
          </CardHeader>
          <CardContent className="p-2 pt-0">
            {hierarchy.length === 0 && (
              <p className="text-sm text-muted-foreground italic py-4 text-center">
                {t("appelNoClasses")}
              </p>
            )}
            <div className="space-y-1.5">
              {hierarchy.map((cat) => {
                const catExpanded = expandedCats.has(cat.id);
                const catHasSelected = selectedClasse && (selectedClasse.structure?.id ?? "__none__") === cat.id;
                const catClassCount = cat.classes.length;
                const typeLabel = TYPE_LABELS[cat.type];
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
                      <School className={cn("w-4 h-4 flex-shrink-0 opacity-70", typeLabel?.color)} />
                      <span className="truncate">{typeLabel?.fr ?? cat.nom}</span>
                      <span className="ml-auto text-xs font-normal text-gray-400 flex-shrink-0">
                        {t("appelClassCount", { count: catClassCount })}
                      </span>
                    </button>
                    {/* Niveau 2 : Classes */}
                    {catExpanded && (
                      <div className="divide-y divide-gray-100 dark:divide-gray-800">
                        {cat.classes.map((classe) => (
                          <button
                            key={classe.id}
                            onClick={() => selectClasse(classe.id)}
                            className={cn(
                              "w-full flex items-center justify-between pl-10 pr-3 py-2.5 text-sm font-medium transition-colors",
                              selectedClasseId === classe.id
                                ? "bg-primary text-white"
                                : "hover:bg-muted text-foreground"
                            )}
                          >
                            <span className="truncate">{classe.nom}</span>
                            <Badge
                              variant={selectedClasseId === classe.id ? "outline" : "secondary"}
                              className={cn("text-xs ml-2 flex-shrink-0", selectedClasseId === classe.id && "border-white/50 text-white")}
                            >
                              {classe.eleves.length}
                            </Badge>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Récap */}
        {eleves.length > 0 && (
          <Card>
            <CardContent className="p-4 space-y-3">
              <p className="text-sm font-semibold">{t("appelSummary")}</p>
              {[
                { label: t("appelTotal"), value: stats.total, color: "text-foreground" },
                { label: t("appelPresents"), value: stats.presents, color: "text-green-600 dark:text-green-400" },
                { label: t("appelAbsents"), value: stats.absents, color: "text-red-500 dark:text-red-400" },
                { label: t("appelRetards"), value: stats.retards, color: "text-yellow-600 dark:text-yellow-400" },
                { label: t("appelNotSet"), value: stats.nonSaisis, color: "text-muted-foreground" },
              ].map((item) => (
                <div key={item.label} className="flex justify-between items-center">
                  <span className="text-xs text-muted-foreground">{item.label}</span>
                  <span className={`text-sm font-bold ${item.color}`}>{item.value}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>

      {/* ── Colonne droite : interface d'appel ── */}
      <div className="lg:col-span-3">
        {!selectedClasse ? (
          <Card className="h-64 flex items-center justify-center">
            <p className="text-muted-foreground">{t("appelSelectCategory")}</p>
          </Card>
        ) : submitted ? (
          <Card className="h-64 flex flex-col items-center justify-center gap-4">
            <CheckCheck className="h-12 w-12 text-green-500" />
            <div className="text-center">
              <p className="text-lg font-semibold">{t("appelSaved")}</p>
              <p className="text-sm text-muted-foreground">
                {t("appelSummaryLine", { presents: stats.presents, absents: stats.absents, retards: stats.retards })}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={reset} className="gap-2">
              <RotateCcw className="h-4 w-4" /> {t("appelRedo")}
            </Button>
          </Card>
        ) : (
          <Card>
            {/* En-tête : classe + sélecteurs jour/créneau */}
            <div className="px-5 py-4 border-b space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-semibold">{selectedClasse.nom}</h2>
                  <p className="text-sm text-muted-foreground">{t("appelStudents", { count: eleves.length })}</p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="gap-2" onClick={marquerTousPresents}>
                    <Users className="h-4 w-4" />
                    {t("appelAllPresent")}
                  </Button>
                  <Button
                    size="sm"
                    className="gap-2"
                    onClick={soumettre}
                    disabled={isPending || creneaux.length === 0}
                  >
                    <CheckCheck className="h-4 w-4" />
                    {isPending ? t("appelSubmitting") : t("appelSubmit")}
                  </Button>
                </div>
              </div>

              {/* Sélecteurs jour + créneau */}
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <label className="text-xs font-medium text-muted-foreground">{t("appelDay")}</label>
                  <input
                    type="date"
                    value={selectedDate}
                    onChange={(e) => { setSelectedDate(e.target.value); setPresences({}); setRetardArrivees({}); setSubmitted(false); }}
                    className="border border-input rounded-md px-2.5 py-1.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs font-medium text-muted-foreground">{t("appelCreneau")}</label>
                  <select
                    value={selectedCreneauIdx}
                    onChange={(e) => setSelectedCreneauIdx(Number(e.target.value))}
                    disabled={creneaux.length === 0}
                    className="border border-input rounded-md px-2.5 py-1.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                  >
                    {creneaux.length === 0 && <option value={-1}>{t("appelNoCreneauDay")}</option>}
                    {creneaux.map((c, i) => (
                      <option key={i} value={i}>
                        {c.debut} – {c.fin}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Grille élèves */}
            <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
              {eleves.map((eleve) => {
                const status = presences[eleve.id] ?? null;
                const showArrival = status === "retard";
                return (
                  <div
                    key={eleve.id}
                    className={cn(
                      "flex flex-col rounded-xl border-2 transition-all",
                      status === "present" && "border-green-400 bg-green-50 dark:bg-green-900/10",
                      status === "absent" && "border-red-400 bg-red-50 dark:bg-red-900/10",
                      status === "retard" && "border-yellow-400 bg-yellow-50 dark:bg-yellow-900/10",
                      !status && "border-border bg-background hover:border-muted-foreground/30"
                    )}
                  >
                    <div className="flex items-center gap-3 p-3">
                      <Avatar className="h-9 w-9 flex-shrink-0">
                        {eleve.photoUrl && <AvatarImage src={eleve.photoUrl} />}
                        <AvatarFallback className="text-xs bg-muted font-semibold">
                          {getInitials(`${eleve.prenom} ${eleve.nom}`)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {eleve.prenom} {eleve.nom}
                        </p>
                        <p className="text-xs text-muted-foreground">{eleve.matricule}</p>
                      </div>
                      <div className="flex gap-1 flex-shrink-0">
                        <button
                          onClick={() => setPresence(eleve.id, "present")}
                          title={t("appelPresent")}
                          className={cn(
                            "p-1.5 rounded-lg transition-all",
                            status === "present"
                              ? "bg-green-500 text-white"
                              : "hover:bg-green-100 text-green-600 dark:hover:bg-green-900/30"
                          )}
                        >
                          <CheckCircle2 className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setPresence(eleve.id, "retard")}
                          title={t("appelLate")}
                          className={cn(
                            "p-1.5 rounded-lg transition-all",
                            status === "retard"
                              ? "bg-yellow-500 text-white"
                              : "hover:bg-yellow-100 text-yellow-600 dark:hover:bg-yellow-900/30"
                          )}
                        >
                          <Clock className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setPresence(eleve.id, "absent")}
                          title={t("appelAbsentTitle")}
                          className={cn(
                            "p-1.5 rounded-lg transition-all",
                            status === "absent"
                              ? "bg-red-500 text-white"
                              : "hover:bg-red-100 text-red-600 dark:hover:bg-red-900/30"
                          )}
                        >
                          <XCircle className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    {/* Heure d'arrivée pour les retards */}
                    {showArrival && (
                      <div className="flex items-center gap-2 px-3 pb-3 pt-1">
                        <Clock className="h-3.5 w-3.5 text-yellow-600 dark:text-yellow-400 flex-shrink-0" />
                        <label className="text-xs text-muted-foreground whitespace-nowrap">
                          {t("appelArrivalTime")}
                        </label>
                        <select
                          value={retardArrivees[eleve.id] ?? currentTimeRounded(5)}
                          onChange={(e) => setRetardArrivee(eleve.id, e.target.value)}
                          className="border border-input rounded-md px-2 py-1 text-xs bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                        >
                          {arrivalOptions.map((tm) => (
                            <option key={tm} value={tm}>{tm}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
