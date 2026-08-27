"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  Calendar,
  Users,
  GraduationCap,
  Receipt,
  Zap,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  RefreshCw,
} from "lucide-react";
import { useTranslations } from "next-intl";
import {
  activerAnneePourReinscription,
  promouvoirEleves,
  genererFraisRenouvellement,
  procederReinscriptionComplete,
  type ApercuReinscription,
  type ResultatPromotion,
  type ResultatReinscriptionComplete,
} from "@/lib/actions/reinscription";
import { cn } from "@/lib/utils";
import type { Role } from "@prisma/client";

interface ReinscriptionViewProps {
  apercu: ApercuReinscription;
  userRole: Role;
}

type StepId = "annee" | "promotion" | "frais" | "mensualites" | "resultat";

const MOIS_NOMS = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];

export function ReinscriptionView({ apercu, userRole }: ReinscriptionViewProps) {
  const t = useTranslations("reinscription");
  const [isPending, startTransition] = useTransition();

  // État du wizard
  const [activeStep, setActiveStep] = useState<StepId>("annee");
  const [selectedAnneeId, setSelectedAnneeId] = useState<string>("");
  const [promouvoir, setPromouvoir] = useState(true);
  const [genererFrais, setGenererFrais] = useState(true);
  const [genererMensualites, setGenererMensualites] = useState(true);
  const [moisMensualites, setMoisMensualites] = useState(new Date().getMonth() + 1);
  const [inclureCantine, setInclureCantine] = useState(false);
  const [inclureTransport, setInclureTransport] = useState(false);

  // Résultats
  const [resultatPromotion, setResultatPromotion] = useState<ResultatPromotion | null>(null);
  const [resultatFrais, setResultatFrais] = useState<{ generated: number; skipped: number } | null>(null);
  const [resultatComplete, setResultatComplete] = useState<ResultatReinscriptionComplete | null>(null);

  const canManageParametres =
    userRole === "TENANT_ADMIN" ||
    userRole === "SUPER_ADMIN" ||
    userRole === "ACCOUNTANT";
  const canManageFinance =
    userRole === "TENANT_ADMIN" ||
    userRole === "SUPER_ADMIN" ||
    userRole === "ACCOUNTANT";

  // ── Actions individuelles ──

  function handleActiverAnnee() {
    if (!selectedAnneeId) {
      toast.error(t("selectAnneeFirst"));
      return;
    }
    startTransition(async () => {
      try {
        await activerAnneePourReinscription(selectedAnneeId);
        toast.success(t("anneeActivated"));
        setActiveStep("promotion");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("error"));
      }
    });
  }

  function handlePromouvoir() {
    startTransition(async () => {
      try {
        const result = await promouvoirEleves();
        setResultatPromotion(result);
        toast.success(t("promotionDone", { promus: result.promus, diplomes: result.diplomes, manuels: result.sansChangement }));
        setActiveStep("frais");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("error"));
      }
    });
  }

  function handleGenererFrais() {
    const annee = apercu.anneesDisponibles.find((a) => a.id === selectedAnneeId)?.libelle
      ?? apercu.anneeCourante?.libelle;
    if (!annee) {
      toast.error(t("noActiveAnnee"));
      return;
    }
    startTransition(async () => {
      try {
        const result = await genererFraisRenouvellement(annee);
        setResultatFrais(result);
        toast.success(t("fraisDone", { generated: result.generated, skipped: result.skipped }));
        setActiveStep("mensualites");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("error"));
      }
    });
  }

  function handleToutExecuter() {
    if (!selectedAnneeId) {
      toast.error(t("selectAnneeFirst"));
      return;
    }
    startTransition(async () => {
      try {
        const result = await procederReinscriptionComplete({
          anneeId: selectedAnneeId,
          promouvoir,
          genererFrais,
          genererMensualites,
          moisMensualites,
          inclureCantine,
          inclureTransport,
        });
        setResultatComplete(result);
        if (result.erreurs.length > 0) {
          toast.warning(t("completeWithErrors", { count: result.erreurs.length }));
        } else {
          toast.success(t("completeSuccess"));
        }
        setActiveStep("resultat");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("error"));
      }
    });
  }

  // ── Steps configuration ──
  const steps: { id: StepId; label: string; icon: typeof Calendar; done: boolean }[] = [
    { id: "annee", label: t("stepAnnee"), icon: Calendar, done: activeStep !== "annee" },
    { id: "promotion", label: t("stepPromotion"), icon: Users, done: ["frais", "mensualites", "resultat"].includes(activeStep) },
    { id: "frais", label: t("stepFrais"), icon: Receipt, done: ["mensualites", "resultat"].includes(activeStep) },
    { id: "mensualites", label: t("stepMensualites"), icon: Zap, done: activeStep === "resultat" },
    { id: "resultat", label: t("stepResultat"), icon: CheckCircle2, done: false },
  ];

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Stepper */}
      <div className="flex items-center justify-between bg-slate-900/40 rounded-xl p-4 border border-slate-800">
        {steps.map((step, i) => (
          <div key={step.id} className="flex items-center flex-1 last:flex-none">
            <button
              onClick={() => step.done && setActiveStep(step.id)}
              className={cn(
                "flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all",
                activeStep === step.id
                  ? "bg-primary/15 text-primary"
                  : step.done
                    ? "text-emerald-400 hover:bg-emerald-500/10 cursor-pointer"
                    : "text-slate-500"
              )}
            >
              <step.icon className="h-4 w-4" />
              {!step.done && (
                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-slate-700 text-xs">
                  {i + 1}
                </span>
              )}
              {step.done && <CheckCircle2 className="h-4 w-4" />}
              <span className="hidden md:inline">{step.label}</span>
            </button>
            {i < steps.length - 1 && (
              <div className={cn("flex-1 h-0.5 mx-2 rounded", step.done ? "bg-emerald-500/50" : "bg-slate-700")} />
            )}
          </div>
        ))}
      </div>

      {/* ── Étape 1 : Année scolaire ── */}
      {activeStep === "annee" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-primary" />
              {t("stepAnnee")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Année courante */}
            <div className="flex items-center gap-3 p-3 rounded-lg bg-primary/5 border border-primary/20">
              <CheckCircle2 className="h-5 w-5 text-primary" />
              <div>
                <p className="text-sm font-medium">{t("currentAnnee")}</p>
                <p className="text-lg font-bold">
                  {apercu.anneeCourante?.libelle ?? t("noAnnee")}
                </p>
              </div>
            </div>

            {/* Sélection nouvelle année */}
            <div className="space-y-2">
              <Label>{t("selectNewAnnee")}</Label>
              <div className="space-y-2">
                {apercu.anneesDisponibles.map((annee) => (
                  <label
                    key={annee.id}
                    className={cn(
                      "flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all",
                      selectedAnneeId === annee.id
                        ? "border-primary bg-primary/10"
                        : "border-border hover:bg-accent/30",
                      annee.isCurrent && "opacity-50"
                    )}
                  >
                    <input
                      type="radio"
                      name="annee"
                      value={annee.id}
                      checked={selectedAnneeId === annee.id}
                      onChange={(e) => setSelectedAnneeId(e.target.value)}
                      disabled={annee.isCurrent}
                      className="h-4 w-4"
                    />
                    <div className="flex-1">
                      <span className="text-sm font-medium">{annee.libelle}</span>
                      <span className="text-xs text-muted-foreground ml-2">
                        {new Date(annee.dateDebut).toLocaleDateString("fr-FR")} → {new Date(annee.dateFin).toLocaleDateString("fr-FR")}
                      </span>
                    </div>
                    {annee.isCurrent && <Badge variant="secondary">{t("active")}</Badge>}
                  </label>
                ))}
              </div>
              {apercu.anneesDisponibles.length === 0 && (
                <p className="text-sm text-muted-foreground">{t("noAnneesAvailable")}</p>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button onClick={handleActiverAnnee} disabled={isPending || !selectedAnneeId || !canManageParametres}>
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                {t("activateAndContinue")}
              </Button>
            </div>
            {!canManageParametres && (
              <p className="text-xs text-amber-500">{t("needParametresWrite")}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Étape 2 : Promotion ── */}
      {activeStep === "promotion" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" />
              {t("stepPromotion")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Stats globales */}
            <div className="grid grid-cols-3 gap-3">
              <div className="text-center p-4 rounded-lg bg-violet-500/10 border border-violet-500/20">
                <p className="text-2xl font-bold text-violet-400">{apercu.totalElevesActifs}</p>
                <p className="text-xs text-muted-foreground">{t("totalActifs")}</p>
              </div>
              <div className="text-center p-4 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <p className="text-2xl font-bold text-amber-400">{apercu.elevesSansPromotion.length}</p>
                <p className="text-xs text-muted-foreground">{t("manualNeeded")}</p>
              </div>
              <div className="text-center p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                <p className="text-2xl font-bold text-emerald-400">{apercu.elevesDiplomes.length}</p>
                <p className="text-xs text-muted-foreground">{t("willGraduate")}</p>
              </div>
            </div>

            {/* Détail par niveau */}
            <div className="space-y-2">
              <Label>{t("studentsByLevel")}</Label>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 border-b">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">{t("level")}</th>
                      <th className="text-center px-3 py-2 font-medium">{t("count")}</th>
                      <th className="text-left px-3 py-2 font-medium">{t("nextLevel")}</th>
                      <th className="text-left px-3 py-2 font-medium">{t("availableClasses")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {apercu.elevesParNiveau.map((row) => {
                      const classes = apercu.classesParNiveau.find((c) => c.niveau === row.niveauSuivant)?.classes ?? [];
                      return (
                        <tr key={row.niveau} className="border-b hover:bg-muted/30">
                          <td className="px-3 py-2 font-medium">{row.niveau}</td>
                          <td className="px-3 py-2 text-center">{row.count}</td>
                          <td className="px-3 py-2">
                            {row.niveauSuivant === null
                              ? <Badge variant="success">{t("graduated")}</Badge>
                              : row.niveauSuivant === undefined
                                ? <Badge variant="warning">{t("unknown")}</Badge>
                                : <span className="text-primary font-medium">{row.niveauSuivant}</span>}
                          </td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">
                            {row.niveauSuivant && row.niveauSuivant !== null
                              ? classes.length > 0
                                ? `${classes.length} ${t("classes")}: ${classes.map((c) => c.nom).join(", ")}`
                                : <span className="text-amber-500">{t("noClassesForLevel")}</span>
                              : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Élèves sans promotion auto */}
            {apercu.elevesSansPromotion.length > 0 && (
              <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  <p className="text-sm font-medium text-amber-600">
                    {t("manualStudents", { count: apercu.elevesSansPromotion.length })}
                  </p>
                </div>
                <p className="text-xs text-muted-foreground">{t("manualStudentsHint")}</p>
              </div>
            )}

            {/* Résultat promotion */}
            {resultatPromotion && (
              <div className="p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/20 space-y-2">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                  <p className="text-sm font-medium">{t("promotionResult")}</p>
                </div>
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div>{t("promoted")}: <strong>{resultatPromotion.promus}</strong></div>
                  <div>{t("graduated")}: <strong>{resultatPromotion.diplomes}</strong></div>
                  <div>{t("manual")}: <strong>{resultatPromotion.sansChangement}</strong></div>
                </div>
              </div>
            )}

            <div className="flex justify-between gap-2 pt-2">
              <Button variant="outline" onClick={() => setActiveStep("annee")}>
                {t("back")}
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setActiveStep("frais")}>
                  {t("skip")}
                </Button>
                <Button onClick={handlePromouvoir} disabled={isPending}>
                  {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
                  {t("promoteStudents")}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Étape 3 : Frais de renouvellement ── */}
      {activeStep === "frais" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Receipt className="h-5 w-5 text-primary" />
              {t("stepFrais")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Tarifs configurés */}
            <div className="space-y-2">
              <Label>{t("configuredTarifs")}</Label>
              {apercu.tarifsConfigures.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 border-b">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium">{t("level")}</th>
                        <th className="text-right px-3 py-2 font-medium">{t("monthlyFee")}</th>
                        <th className="text-right px-3 py-2 font-medium">{t("renewalFee")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {apercu.tarifsConfigures.map((tarif) => (
                        <tr key={tarif.niveau} className="border-b hover:bg-muted/30">
                          <td className="px-3 py-2 font-medium">{tarif.niveau}</td>
                          <td className="px-3 py-2 text-right">{tarif.mensualite.toLocaleString()} DJF</td>
                          <td className="px-3 py-2 text-right font-bold text-primary">
                            {tarif.fraisRenouvellement.toLocaleString()} DJF
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/20">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                    <p className="text-sm text-amber-600">{t("noTarifsForYear")}</p>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{t("configureTarifsHint")}</p>
                </div>
              )}
            </div>

            {resultatFrais && (
              <div className="p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                  <p className="text-sm font-medium">
                    {t("fraisResult", { generated: resultatFrais.generated, skipped: resultatFrais.skipped })}
                  </p>
                </div>
              </div>
            )}

            <div className="flex justify-between gap-2 pt-2">
              <Button variant="outline" onClick={() => setActiveStep("promotion")}>
                {t("back")}
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setActiveStep("mensualites")}>
                  {t("skip")}
                </Button>
                <Button onClick={handleGenererFrais} disabled={isPending || !canManageFinance || apercu.tarifsConfigures.length === 0}>
                  {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Receipt className="h-4 w-4" />}
                  {t("generateRenewalFees")}
                </Button>
              </div>
            </div>
            {!canManageFinance && <p className="text-xs text-amber-500">{t("needFinanceWrite")}</p>}
          </CardContent>
        </Card>
      )}

      {/* ── Étape 4 : Mensualités ── */}
      {activeStep === "mensualites" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-primary" />
              {t("stepMensualites")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t("month")}</Label>
                <select
                  value={moisMensualites}
                  onChange={(e) => setMoisMensualites(parseInt(e.target.value))}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {MOIS_NOMS.map((nom, i) => (
                    <option key={i} value={i + 1}>{nom}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>{t("options")}</Label>
                <div className="flex flex-col gap-2 pt-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={inclureCantine} onChange={(e) => setInclureCantine(e.target.checked)} className="h-4 w-4 rounded border-gray-300" />
                    <span className="text-sm">{t("includeCanteen")}</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={inclureTransport} onChange={(e) => setInclureTransport(e.target.checked)} className="h-4 w-4 rounded border-gray-300" />
                    <span className="text-sm">{t("includeTransport")}</span>
                  </label>
                </div>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-muted/50 text-xs text-muted-foreground">
              {t("mensualitesHint", { count: apercu.totalElevesActifs })}
            </div>

            <div className="flex justify-between gap-2 pt-2">
              <Button variant="outline" onClick={() => setActiveStep("frais")}>
                {t("back")}
              </Button>
              <Button onClick={() => setActiveStep("resultat")} variant="outline">
                {t("skip")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Étape 5 : Récapitulatif + exécution ── */}
      {activeStep === "resultat" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-primary" />
              {t("stepResultat")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!resultatComplete ? (
              <>
                {/* Récapitulatif des actions */}
                <div className="space-y-3">
                  <h3 className="text-sm font-medium">{t("summary")}</h3>

                  <label className="flex items-center gap-3 p-3 rounded-lg border cursor-pointer">
                    <input type="checkbox" checked={promouvoir} onChange={(e) => setPromouvoir(e.target.checked)} className="h-4 w-4" />
                    <Users className="h-4 w-4 text-violet-500" />
                    <div className="flex-1">
                      <p className="text-sm font-medium">{t("stepPromotion")}</p>
                      <p className="text-xs text-muted-foreground">
                        {apercu.totalElevesActifs} {t("students")} → {apercu.elevesDiplomes.length} {t("graduated")}
                      </p>
                    </div>
                  </label>

                  <label className="flex items-center gap-3 p-3 rounded-lg border cursor-pointer">
                    <input type="checkbox" checked={genererFrais} onChange={(e) => setGenererFrais(e.target.checked)} className="h-4 w-4" />
                    <Receipt className="h-4 w-4 text-emerald-500" />
                    <div className="flex-1">
                      <p className="text-sm font-medium">{t("stepFrais")}</p>
                      <p className="text-xs text-muted-foreground">
                        {apercu.tarifsConfigures.length} {t("tarifsConfigured")}
                      </p>
                    </div>
                  </label>

                  <label className="flex items-center gap-3 p-3 rounded-lg border cursor-pointer">
                    <input type="checkbox" checked={genererMensualites} onChange={(e) => setGenererMensualites(e.target.checked)} className="h-4 w-4" />
                    <Zap className="h-4 w-4 text-amber-500" />
                    <div className="flex-1">
                      <p className="text-sm font-medium">{t("stepMensualites")}</p>
                      <p className="text-xs text-muted-foreground">
                        {MOIS_NOMS[moisMensualites - 1]} {inclureCantine && `+ ${t("canteen")}`} {inclureTransport && `+ ${t("transport")}`}
                      </p>
                    </div>
                  </label>
                </div>

                <div className="flex justify-between gap-2 pt-4 border-t">
                  <Button variant="outline" onClick={() => setActiveStep("mensualites")}>
                    {t("back")}
                  </Button>
                  <Button
                    size="lg"
                    onClick={handleToutExecuter}
                    disabled={isPending || !selectedAnneeId}
                    className="gap-2"
                  >
                    {isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <RefreshCw className="h-5 w-5" />}
                    {t("executeAll")}
                  </Button>
                </div>
                {!selectedAnneeId && (
                  <p className="text-xs text-amber-500 text-center">{t("selectAnneeFirst")}</p>
                )}
              </>
            ) : (
              /* Résultats de l'exécution */
              <div className="space-y-4">
                {resultatComplete.erreurs.length > 0 && (
                  <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20">
                    <div className="flex items-center gap-2 mb-2">
                      <AlertTriangle className="h-5 w-5 text-destructive" />
                      <p className="text-sm font-medium text-destructive">{t("errorsOccurred")}</p>
                    </div>
                    <ul className="text-xs text-destructive/80 list-disc list-inside space-y-1">
                      {resultatComplete.erreurs.map((err, i) => (
                        <li key={i}>{err}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <ResultCard
                    icon={Calendar}
                    label={t("stepAnnee")}
                    success={resultatComplete.anneeActive}
                    value={resultatComplete.anneeActive ? t("done") : t("skipped")}
                  />
                  {resultatComplete.promotion && (
                    <ResultCard
                      icon={Users}
                      label={t("stepPromotion")}
                      success={true}
                      value={`${resultatComplete.promotion.promus} ${t("promoted")}, ${resultatComplete.promotion.diplomes} ${t("graduated")}`}
                    />
                  )}
                  {resultatComplete.fraisRenouvellement && (
                    <ResultCard
                      icon={Receipt}
                      label={t("stepFrais")}
                      success={true}
                      value={`${resultatComplete.fraisRenouvellement.generated} ${t("invoices")}`}
                    />
                  )}
                  {resultatComplete.mensualites && (
                    <ResultCard
                      icon={Zap}
                      label={t("stepMensualites")}
                      success={true}
                      value={`${resultatComplete.mensualites.generated} ${t("invoices")}`}
                    />
                  )}
                </div>

                <div className="flex justify-center pt-4">
                  <Button variant="outline" onClick={() => window.location.reload()}>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    {t("refresh")}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ResultCard({
  icon: Icon,
  label,
  success,
  value,
}: {
  icon: typeof Calendar;
  label: string;
  success: boolean;
  value: string;
}) {
  return (
    <div className={cn(
      "p-4 rounded-lg border",
      success ? "bg-emerald-500/10 border-emerald-500/20" : "bg-muted/30 border-border"
    )}>
      <div className="flex items-center gap-2 mb-1">
        <Icon className={cn("h-4 w-4", success ? "text-emerald-500" : "text-muted-foreground")} />
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
      </div>
      <p className={cn("text-sm font-bold", success ? "text-emerald-600" : "text-muted-foreground")}>
        {value}
      </p>
    </div>
  );
}
