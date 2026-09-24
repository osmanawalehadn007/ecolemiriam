"use client";

import { useState, useMemo, useTransition } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Briefcase, Search, Users, Clock, DollarSign,
  BookOpen, Star, ChevronDown, ChevronUp, Calendar,
  Loader2, CheckCircle2, FileText, Edit2, CalendarX, Plane,
} from "lucide-react";
import { toast } from "sonner";
import { cn, getInitials, formatCurrency } from "@/lib/utils";
import { hasPermission } from "@/lib/client-permissions";
import { useTranslations } from "next-intl";
import { PersonnelAbsencesConges } from "./PersonnelAbsencesConges";
import { GererAffectations } from "@/components/enseignants/GererAffectations";

// ─── Types ────────────────────────────────────────────────────────────────────

type TypeContrat = "CDI" | "CDD" | "VACATAIRE" | "FONCTIONNAIRE" | "STAGIAIRE";

const MOIS_FR = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];

const CONTRAT_CONFIG: Record<TypeContrat, { labelKey: string; color: string }> = {
  CDI: { labelKey: "contractTypes.CDI", color: "bg-green-50 text-green-700 border-green-200" },
  CDD: { labelKey: "contractTypes.CDD", color: "bg-blue-50 text-blue-700 border-blue-200" },
  VACATAIRE: { labelKey: "contractTypes.VACATAIRE", color: "bg-orange-50 text-orange-700 border-orange-200" },
  FONCTIONNAIRE: { labelKey: "contractTypes.FONCTIONNAIRE", color: "bg-purple-50 text-purple-700 border-purple-200" },
  STAGIAIRE: { labelKey: "contractTypes.STAGIAIRE", color: "bg-gray-100 text-gray-600 border-gray-200" },
};

interface BulletinPaie {
  id: string;
  mois: number;
  annee: number;
  heuresEffectuees: number;
  salaireBase: number;
  netAPayer: number;
  isPaye: boolean;
}

interface FicheRH {
  id: string;
  typeContrat: TypeContrat;
  salaireBase: number | null;
  tarifHoraire: number | null;
  diplome: string | null;
  echelon: number;
  grade: string | null;
  banque: string | null;
  rib: string | null;
  evaluation: string | null;
  congesAnnuels: number;
  congesPris: number;
  bulletinsPaie: BulletinPaie[];
}

interface EmploiTempsItem {
  jour: string;
  heureDebut: string;
  heureFin: string;
  matiere: { nom: string; couleur: string | null };
  classe: { nom: string };
}

interface EnseignantRH {
  id: string;
  user: {
    id: string;
    name: string;
    email: string;
    avatarUrl: string | null;
    phone: string | null;
    isActive: boolean;
  };
  specialite: string | null;
  typeContrat: string | null;
  ficheRH: FicheRH | null;
  emploiTemps: EmploiTempsItem[];
  classesPrincipales: { id: string; nom: string; niveau: string }[];
  affectations?: {
    id: string;
    classeId: string;
    matiereId: string | null;
    classe: { id: string; nom: string; niveau: string };
    matiere: { id: string; nom: string; code: string } | null;
  }[];
}

// ─── Calcul heures hebdo ──────────────────────────────────────────────────────

function calcHeuresHebdo(emploiTemps: EmploiTempsItem[]): number {
  const totalMinutes = emploiTemps.reduce((sum, et) => {
    const [hd, md] = et.heureDebut.split(":").map(Number);
    const [hf, mf] = et.heureFin.split(":").map(Number);
    return sum + (hf * 60 + mf) - (hd * 60 + md);
  }, 0);
  return Math.round(totalMinutes / 60 * 10) / 10;
}

// ─── Carte enseignant RH ──────────────────────────────────────────────────────

function EnseignantRHCard({
  enseignant,
  onUpdate,
  classes,
  matieres,
  canManageAffectations,
  canWriteRH,
}: {
  enseignant: EnseignantRH;
  onUpdate: (id: string, ficheRH: FicheRH) => void;
  classes: { id: string; nom: string; niveau: string; siteId?: string | null }[];
  matieres: { id: string; nom: string; code: string }[];
  canManageAffectations: boolean;
  canWriteRH: boolean;
}) {
  const t = useTranslations("rh");
  const tCommon = useTranslations("common");
  const [expanded, setExpanded] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [generatingPaie, setGeneratingPaie] = useState(false);
  const [editingFiche, setEditingFiche] = useState(false);
  const [savingFiche, setSavingFiche] = useState(false);

  const heuresHebdo = calcHeuresHebdo(enseignant.emploiTemps);
  const ficheRH = enseignant.ficheRH;
  const contrat = ficheRH?.typeContrat ?? (enseignant.typeContrat as TypeContrat | null);
  const contratConfig = contrat ? CONTRAT_CONFIG[contrat] : null;

  const now = new Date();
  const moisActuel = now.getMonth() + 1;
  const anneeActuelle = now.getFullYear();

  // Formulaire d'édition de la fiche RH
  const [ficheForm, setFicheForm] = useState({
    typeContrat: ficheRH?.typeContrat ?? enseignant.typeContrat ?? "CDI",
    salaireBase: ficheRH?.salaireBase?.toString() ?? "",
    tarifHoraire: ficheRH?.tarifHoraire?.toString() ?? "",
    grade: ficheRH?.grade ?? "",
    diplome: ficheRH?.diplome ?? "",
    echelon: ficheRH?.echelon?.toString() ?? "1",
    banque: ficheRH?.banque ?? "",
    rib: ficheRH?.rib ?? "",
    congesAnnuels: ficheRH?.congesAnnuels?.toString() ?? "30",
  });

  const handleSaveFiche = () => {
    setSavingFiche(true);
    startTransition(async () => {
      try {
        const payload: Record<string, unknown> = {
          typeContrat: ficheForm.typeContrat,
          grade: ficheForm.grade || undefined,
          diplome: ficheForm.diplome || undefined,
          echelon: parseInt(ficheForm.echelon) || 1,
          banque: ficheForm.banque || undefined,
          rib: ficheForm.rib || undefined,
          congesAnnuels: parseInt(ficheForm.congesAnnuels) || 30,
        };
        if (ficheForm.salaireBase) payload.salaireBase = parseFloat(ficheForm.salaireBase);
        else payload.salaireBase = null;
        if (ficheForm.tarifHoraire) payload.tarifHoraire = parseFloat(ficheForm.tarifHoraire);
        else payload.tarifHoraire = null;

        const res = await fetch(`/api/rh/${enseignant.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Erreur");
        }
        const { ficheRH: updated } = await res.json();
        onUpdate(enseignant.id, updated);
        toast.success(t("ficheSaved"));
        setEditingFiche(false);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t("ficheSaveError"));
      } finally {
        setSavingFiche(false);
      }
    });
  };

  const handleGenererPaie = () => {
    startTransition(async () => {
      setGeneratingPaie(true);
      try {
        const res = await fetch(`/api/rh/${enseignant.id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mois: moisActuel, annee: anneeActuelle }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Erreur");
        }
        toast.success(t("paySlipGenerated", { month: t(`months.${moisActuel - 1}`) }));
        window.location.reload();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t("genPayError"));
      } finally {
        setGeneratingPaie(false);
      }
    });
  };

  return (
    <Card className="border-0 shadow-sm hover:shadow-md transition-shadow">
      <CardContent className="p-5">
        {/* En-tête */}
        <div className="flex items-start gap-4">
          <Avatar className="h-11 w-11 flex-shrink-0">
            {enseignant.user.avatarUrl && (
              <AvatarFallback className="bg-amber-100 text-amber-700 text-sm font-semibold">
                {getInitials(enseignant.user.name)}
              </AvatarFallback>
            )}
            <AvatarFallback className="bg-amber-100 text-amber-700 text-sm font-semibold">
              {getInitials(enseignant.user.name)}
            </AvatarFallback>
          </Avatar>

          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-semibold text-sm text-gray-900 dark:text-white">
                  {enseignant.user.name}
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  {enseignant.specialite ?? t("subjectUndefined")}
                </p>
              </div>
              <div className="flex gap-1.5 flex-wrap justify-end">
                {contratConfig && (
                  <Badge className={cn("text-xs", contratConfig.color)}>
                    {t(contratConfig.labelKey)}
                  </Badge>
                )}
                <Badge className={cn(
                  "text-xs",
                  enseignant.user.isActive
                    ? "bg-green-50 text-green-700 border-green-200"
                    : "bg-gray-100 text-gray-500 border-gray-200"
                )}>
                  {enseignant.user.isActive ? t("active") : t("inactive")}
                </Badge>
              </div>
            </div>

            {/* Stats rapides */}
            <div className="flex flex-wrap gap-3 mt-2 text-xs text-gray-500">
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                <span className="font-medium text-gray-700 dark:text-gray-300">{heuresHebdo}h</span>/sem
              </span>
              <span className="flex items-center gap-1">
                <BookOpen className="w-3 h-3" />
                {t("slots", { count: enseignant.emploiTemps.length })}
              </span>
              {ficheRH?.salaireBase && (
                <span className="flex items-center gap-1">
                  <DollarSign className="w-3 h-3" />
                  {formatCurrency(ficheRH.salaireBase)}
                </span>
              )}
              {ficheRH?.grade && (
                <span className="flex items-center gap-1">
                  <Star className="w-3 h-3 text-yellow-500" />
                  {ficheRH.grade}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Classes principales */}
        {enseignant.classesPrincipales.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {enseignant.classesPrincipales.map((c) => (
              <Badge key={c.id} className="text-xs bg-primary/10 text-primary border-primary/20">
                {t("mainTeacher")} {c.nom}
              </Badge>
            ))}
          </div>
        )}

        {/* Affectations (classes + matières) */}
        {enseignant.affectations && enseignant.affectations.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {enseignant.affectations.map((a) => (
              <Badge key={a.id} className="text-xs bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-900/20 dark:text-teal-300">
                {a.classe.nom}
                {a.matiere && ` — ${a.matiere.nom}`}
              </Badge>
            ))}
          </div>
        )}

        {/* Bouton Gérer les affectations */}
        {canManageAffectations && classes.length > 0 && (
          <div className="mt-2">
            <GererAffectations
              enseignantId={enseignant.id}
              enseignantName={enseignant.user.name}
              classes={classes}
              matieres={matieres}
              canManage={canManageAffectations}
            />
          </div>
        )}

        {/* Emploi du temps résumé */}
        {enseignant.emploiTemps.length > 0 && (
          <div className="mt-3 space-y-1">
            {enseignant.emploiTemps.slice(0, 3).map((et, i) => (
              <div key={i} className="flex items-center gap-2 text-xs text-gray-500">
                <span className="w-2 h-2 rounded-full bg-primary/40 flex-shrink-0" />
                <span className="font-medium text-gray-600 dark:text-gray-400 capitalize">
                  {et.jour.charAt(0) + et.jour.slice(1).toLowerCase()}
                </span>
                <span>{et.heureDebut}–{et.heureFin}</span>
                <span>•</span>
                <span>{et.matiere.nom}</span>
                <span>•</span>
                <span>{et.classe.nom}</span>
              </div>
            ))}
            {enseignant.emploiTemps.length > 3 && (
              <p className="text-xs text-gray-400 pl-4">
                {t("moreSlots", { count: enseignant.emploiTemps.length - 3, s: enseignant.emploiTemps.length - 3 > 1 ? "s" : "" })}
              </p>
            )}
          </div>
        )}

        {/* Section paie (dépliable) */}
        <div className="mt-4 border-t border-gray-100 dark:border-gray-700 pt-3">
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center justify-between w-full text-xs font-medium text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
          >
            <span className="flex items-center gap-1">
              <FileText className="w-3.5 h-3.5" />
              {t("paySlips", { count: ficheRH?.bulletinsPaie.length ?? 0 })}
            </span>
            <span className="flex items-center gap-2">
              {!ficheRH && (
                <Badge className="text-xs bg-amber-50 text-amber-700 border-amber-200">
                  {t("noFicheRH")}
                </Badge>
              )}
              {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </span>
          </button>

          {expanded && (
            <div className="mt-2 space-y-2">
              {/* Bouton éditer la fiche RH */}
              {canWriteRH && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditingFiche(!editingFiche)}
                className="w-full gap-2 text-xs"
              >
                <Edit2 className="w-3.5 h-3.5" />
                {ficheRH ? t("editFicheRH") : t("createFicheRH")}
              </Button>
              )}

              {/* Formulaire d'édition de la fiche RH */}
              {editingFiche && (
                <div className="space-y-2 p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs text-gray-500">{t("contract")}</label>
                      <select
                        className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-xs"
                        value={ficheForm.typeContrat}
                        onChange={(e) => setFicheForm({ ...ficheForm, typeContrat: e.target.value })}
                      >
                        {(["CDI", "CDD", "VACATAIRE", "FONCTIONNAIRE", "STAGIAIRE"] as TypeContrat[]).map((c) => (
                          <option key={c} value={c}>{t(`contractTypes.${c}`)}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-gray-500">{t("salary")}</label>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="0"
                        value={ficheForm.salaireBase}
                        onChange={(e) => setFicheForm({ ...ficheForm, salaireBase: e.target.value })}
                        className="h-9 text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500">{t("hourlyRate")}</label>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="0"
                        value={ficheForm.tarifHoraire}
                        onChange={(e) => setFicheForm({ ...ficheForm, tarifHoraire: e.target.value })}
                        className="h-9 text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500">{t("grade")}</label>
                      <Input
                        placeholder="—"
                        value={ficheForm.grade}
                        onChange={(e) => setFicheForm({ ...ficheForm, grade: e.target.value })}
                        className="h-9 text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500">{t("diploma")}</label>
                      <Input
                        placeholder="—"
                        value={ficheForm.diplome}
                        onChange={(e) => setFicheForm({ ...ficheForm, diplome: e.target.value })}
                        className="h-9 text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500">{t("echelon")}</label>
                      <Input
                        type="number"
                        min="1"
                        value={ficheForm.echelon}
                        onChange={(e) => setFicheForm({ ...ficheForm, echelon: e.target.value })}
                        className="h-9 text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500">{t("bank")}</label>
                      <Input
                        placeholder="—"
                        value={ficheForm.banque}
                        onChange={(e) => setFicheForm({ ...ficheForm, banque: e.target.value })}
                        className="h-9 text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500">{t("rib")}</label>
                      <Input
                        placeholder="—"
                        value={ficheForm.rib}
                        onChange={(e) => setFicheForm({ ...ficheForm, rib: e.target.value })}
                        className="h-9 text-xs"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={handleSaveFiche}
                      disabled={savingFiche}
                      className="flex-1 gap-2 text-xs"
                    >
                      {savingFiche ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                      {tCommon("save")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setEditingFiche(false)}
                      className="text-xs"
                    >
                      {tCommon("cancel")}
                    </Button>
                  </div>
                </div>
              )}

              {/* Liste des bulletins de paie */}
              {ficheRH?.bulletinsPaie && ficheRH.bulletinsPaie.length > 0 ? (
                ficheRH.bulletinsPaie.map((bp) => (
                  <div
                    key={bp.id}
                    className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-800/50 rounded-lg text-xs"
                  >
                    <span className="text-gray-600 dark:text-gray-400">
                      {t(`months.${bp.mois - 1}`)} {bp.annee}
                    </span>
                    <span className="text-gray-500">{t("hoursDone", { count: bp.heuresEffectuees })}</span>
                    <span className="font-semibold text-gray-900 dark:text-white">
                      {formatCurrency(bp.netAPayer)}
                    </span>
                    <Badge className={cn(
                      "text-xs",
                      bp.isPaye
                        ? "bg-green-50 text-green-700 border-green-200"
                        : "bg-orange-50 text-orange-600 border-orange-200"
                    )}>
                      {bp.isPaye ? t("paid") : t("pending")}
                    </Badge>
                  </div>
                ))
              ) : (
                <p className="text-xs text-gray-400 py-2 text-center">{t("noPaySlip")}</p>
              )}

              <Button
                size="sm"
                variant="outline"
                onClick={handleGenererPaie}
                disabled={generatingPaie}
                className="w-full gap-2 text-xs mt-2"
              >
                {generatingPaie ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Calendar className="w-3.5 h-3.5" />
                )}
                {t("generatePaySlip", { month: t(`months.${moisActuel - 1}`) })}
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Composant principal ──────────────────────────────────────────────────────

interface AbsencePersonnelItem {
  id: string;
  date: Date;
  heureDebut: string | null;
  heureFin: string | null;
  type: string;
  statut: string;
  motif: string | null;
  commentaire: string | null;
  enseignant: { id: string; user: { name: string } };
  saisiePar: { name: string } | null;
}

interface CongePersonnelItem {
  id: string;
  type: string;
  statut: string;
  dateDebut: Date;
  dateFin: Date;
  nbJours: number;
  motif: string | null;
  enseignant: { id: string; user: { name: string } };
  demandePar: { name: string } | null;
  approuvePar: { name: string } | null;
}

interface RHViewProps {
  enseignants: EnseignantRH[];
  absencesPersonnel?: AbsencePersonnelItem[];
  congesPersonnel?: CongePersonnelItem[];
  classes?: { id: string; nom: string; niveau: string; siteId?: string | null }[];
  matieres?: { id: string; nom: string; code: string }[];
  canManageAffectations?: boolean;
  userRole?: string;
}

export function RHView({
  enseignants: initial,
  absencesPersonnel,
  congesPersonnel,
  classes = [],
  matieres = [],
  canManageAffectations = false,
  userRole,
}: RHViewProps) {
  const t = useTranslations("rh");
  const canWriteRH = hasPermission(userRole, "rh:write");
  const [enseignants, setEnseignants] = useState<EnseignantRH[]>(initial);
  const [search, setSearch] = useState("");
  const [filtreContrat, setFiltreContrat] = useState<TypeContrat | "TOUS">("TOUS");
  const [activeTab, setActiveTab] = useState<"personnel" | "absences" | "conges">("personnel");

  const stats = useMemo(() => {
    const totalHeures = enseignants.reduce((s, e) => s + calcHeuresHebdo(e.emploiTemps), 0);
    const avecFiche = enseignants.filter((e) => e.ficheRH).length;
    const masseTotal = enseignants.reduce((s, e) => s + (e.ficheRH?.salaireBase ?? 0), 0);
    return {
      total: enseignants.length,
      actifs: enseignants.filter((e) => e.user.isActive).length,
      totalHeures: Math.round(totalHeures * 10) / 10,
      avecFiche,
      masseTotal,
    };
  }, [enseignants]);

  const filtered = useMemo(() => {
    return enseignants.filter((e) => {
      const q = search.toLowerCase();
      const matchSearch = !q ||
        `${e.user.name} ${e.user.email} ${e.specialite ?? ""}`.toLowerCase().includes(q);
      const contrat = e.ficheRH?.typeContrat ?? e.typeContrat;
      const matchContrat = filtreContrat === "TOUS" || contrat === filtreContrat;
      return matchSearch && matchContrat;
    });
  }, [enseignants, search, filtreContrat]);

  const handleUpdate = (id: string, ficheRH: FicheRH) => {
    setEnseignants((prev) =>
      prev.map((e) => (e.id === id ? { ...e, ficheRH } : e))
    );
  };

  return (
    <div className="space-y-6">
      {/* Header actions */}
      <div className="flex justify-end">
        {canWriteRH && (
        <a href="/parametres">
          <Button size="sm" className="gap-2">
            <Users className="h-4 w-4" />
            {t("addTeacher")}
          </Button>
        </a>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500">{t("teachers")}</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white mt-0.5">{stats.total}</p>
                <p className="text-xs text-gray-400">{stats.actifs} {t("active")}</p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                <Users className="w-5 h-5 text-amber-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500">{t("hoursPerWeek")}</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white mt-0.5">{stats.totalHeures}h</p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                <Clock className="w-5 h-5 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500">{t("rhSheets")}</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white mt-0.5">{stats.avecFiche}</p>
                <p className="text-xs text-gray-400">{t("ofTotal", { total: stats.total })}</p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                <CheckCircle2 className="w-5 h-5 text-green-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500">{t("salaryMass")}</p>
                <p className="text-lg font-bold text-gray-900 dark:text-white mt-0.5">
                  {formatCurrency(stats.masseTotal)}
                </p>
                <p className="text-xs text-gray-400">{t("perMonth")}</p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                <DollarSign className="w-5 h-5 text-purple-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filtres */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder={t("searchTeacher")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 text-sm"
              />
            </div>
            <div className="flex gap-2 flex-wrap">
              {(["TOUS", "CDI", "CDD", "VACATAIRE", "FONCTIONNAIRE"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFiltreContrat(f)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                    filtreContrat === f
                      ? "bg-primary text-white"
                      : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200"
                  )}
                >
                  {f === "TOUS" ? t("all") : t(CONTRAT_CONFIG[f as TypeContrat].labelKey)}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Onglets */}
      <div className="flex gap-2 border-b border-gray-200 dark:border-gray-700">
        <button
          onClick={() => setActiveTab("personnel")}
          className={cn(
            "px-4 py-2 text-sm font-medium border-b-2 transition-colors",
            activeTab === "personnel"
              ? "border-primary text-primary"
              : "border-transparent text-gray-500 hover:text-gray-700"
          )}
        >
          <Users className="h-4 w-4 inline mr-1" />
          {t("teachers")}
        </button>
        <button
          onClick={() => setActiveTab("absences")}
          className={cn(
            "px-4 py-2 text-sm font-medium border-b-2 transition-colors",
            activeTab === "absences"
              ? "border-primary text-primary"
              : "border-transparent text-gray-500 hover:text-gray-700"
          )}
        >
          <CalendarX className="h-4 w-4 inline mr-1" />
          {t("staffAbsences")}
          {absencesPersonnel && absencesPersonnel.length > 0 && (
            <Badge variant="secondary" className="ml-1 text-xs">{absencesPersonnel.length}</Badge>
          )}
        </button>
        <button
          onClick={() => setActiveTab("conges")}
          className={cn(
            "px-4 py-2 text-sm font-medium border-b-2 transition-colors",
            activeTab === "conges"
              ? "border-primary text-primary"
              : "border-transparent text-gray-500 hover:text-gray-700"
          )}
        >
          <Plane className="h-4 w-4 inline mr-1" />
          {t("staffLeaves")}
          {congesPersonnel && congesPersonnel.length > 0 && (
            <Badge variant="secondary" className="ml-1 text-xs">{congesPersonnel.length}</Badge>
          )}
        </button>
      </div>

      {/* Contenu des onglets */}
      {activeTab === "personnel" && (
        <>
          {filtered.length === 0 ? (
            <Card className="border-0 shadow-sm">
              <CardContent className="py-16 text-center">
                <Briefcase className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                <p className="text-sm text-gray-500">{t("noTeacherFound")}</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filtered.map((e) => (
                <EnseignantRHCard
                  key={e.id}
                  enseignant={e}
                  onUpdate={handleUpdate}
                  classes={classes}
                  matieres={matieres}
                  canManageAffectations={canManageAffectations}
                  canWriteRH={canWriteRH}
                />
              ))}
            </div>
          )}
        </>
      )}

      {activeTab === "absences" && (
        <PersonnelAbsencesConges
          absences={absencesPersonnel ?? []}
          conges={[]}
          enseignants={enseignants.map((e) => ({ id: e.id, user: { name: e.user.name } }))}
        />
      )}

      {activeTab === "conges" && (
        <PersonnelAbsencesConges
          absences={[]}
          conges={congesPersonnel ?? []}
          enseignants={enseignants.map((e) => ({ id: e.id, user: { name: e.user.name } }))}
        />
      )}
    </div>
  );
}
