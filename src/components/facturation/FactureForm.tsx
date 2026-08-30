"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Loader2, Save, Sparkles, AlertCircle, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { createFacturesCombinees, getExistingFacturesForEleve, type FacturesCombineesData } from "@/lib/actions/facture";
import { StudentSearch } from "./StudentSearch";
import { useTranslations } from "next-intl";
import { niveauToLabel } from "@/lib/niveau";

interface EleveOption {
  id: string;
  nom: string;
  prenom: string;
  matricule: string;
  classe: { id: string; nom: string; niveau: string } | null;
}

interface ClasseOption {
  id: string;
  nom: string;
  niveau: string;
}

interface TarifOption {
  id: string;
  niveau: string;
  mensualite: number;
  fraisInscription: number;
  fraisRenouvellement: number;
  fraisCantine: number | null;
  fraisTransport: number | null;
  devise: string;
}

type FactureType = "MENSUALITE" | "INSCRIPTION" | "RENOUVELLEMENT" | "CANTINE" | "TRANSPORT" | "LIBRE";

interface ExistingFacture {
  id: string;
  type: FactureType;
  mois: string | null;
  statut: string;
  numero: string;
  montant: number;
}

const MOIS_NOMS = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];

const TYPES_MENSUELS: FactureType[] = ["MENSUALITE", "CANTINE", "TRANSPORT"];
const TYPE_EXCLUSIVE: Record<FactureType, FactureType[]> = {
  MENSUALITE: [],
  INSCRIPTION: ["RENOUVELLEMENT"],
  RENOUVELLEMENT: ["INSCRIPTION"],
  CANTINE: [],
  TRANSPORT: [],
  LIBRE: [],
};

export function FactureForm({
  eleves,
  classes,
  tarifs,
  eleveIdPreselected,
}: {
  eleves: EleveOption[];
  classes: ClasseOption[];
  tarifs: TarifOption[];
  eleveIdPreselected?: string;
}) {
  const t = useTranslations("facturation");
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const [selectedServices, setSelectedServices] = useState<FactureType[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [form, setForm] = useState<{ eleveId: string }>({
    eleveId: eleveIdPreselected ?? "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [selectedClasseId, setSelectedClasseId] = useState("");
  const [existing, setExisting] = useState<ExistingFacture[]>([]);
  const [existingLoading, setExistingLoading] = useState(false);

  useEffect(() => {
    if (eleveIdPreselected) {
      const eleve = eleves.find((e) => e.id === eleveIdPreselected);
      if (eleve?.classe?.id) setSelectedClasseId(eleve.classe.id);
    }
  }, [eleveIdPreselected, eleves]);

  const filteredEleves = useMemo(() => {
    if (!selectedClasseId) return eleves;
    return eleves.filter((e) => e.classe?.id === selectedClasseId);
  }, [eleves, selectedClasseId]);

  const selectedEleve = useMemo(
    () => eleves.find((e) => e.id === form.eleveId),
    [eleves, form.eleveId]
  );

  const matchedTarif = useMemo(() => {
    if (!selectedEleve?.classe?.niveau) return null;
    return tarifs.find(
      (t) => t.niveau.toLowerCase() === selectedEleve.classe!.niveau.toLowerCase()
    ) ?? null;
  }, [tarifs, selectedEleve]);

  // Charger les factures existantes de l'élève sélectionné
  useEffect(() => {
    if (!form.eleveId) {
      setExisting([]);
      return;
    }
    setExistingLoading(true);
    getExistingFacturesForEleve(form.eleveId)
      .then((data) => setExisting(data as ExistingFacture[]))
      .catch(() => setExisting([]))
      .finally(() => setExistingLoading(false));
  }, [form.eleveId]);

  const existingByKey = useMemo(() => {
    const map = new Map<string, ExistingFacture>();
    for (const f of existing) {
      const key = TYPES_MENSUELS.includes(f.type) && f.mois ? `${f.type}:${f.mois}` : f.type;
      map.set(key, f);
    }
    return map;
  }, [existing]);

  const moisKey = useMemo(() => `${selectedYear}-${String(selectedMonth).padStart(2, "0")}`, [selectedYear, selectedMonth]);

  // Bloque un service s'il est déjà facturé (non annulé) — et définit son statut
  function getExistingFor(type: FactureType, mois?: string) {
    const key = TYPES_MENSUELS.includes(type) && mois ? `${type}:${mois}` : type;
    return existingByKey.get(key) ?? null;
  }

  function isLocked(type: FactureType, mois?: string) {
    const f = getExistingFor(type, mois);
    if (!f) return false;
    return f.statut !== "ANNULEE";
  }

  function isPaid(f: ExistingFacture | null) {
    return f?.statut === "PAYEE";
  }

  function handleStudentChange(eleveId: string) {
    setForm({ eleveId });
    setSelectedServices([]);
    setErrors({});
    const eleve = eleves.find((e) => e.id === eleveId);
    if (eleve?.classe?.id) setSelectedClasseId(eleve.classe.id);
  }

  function toggleService(type: FactureType) {
    setSelectedServices((prev) => {
      if (prev.includes(type)) {
        return prev.filter((s) => s !== type);
      }

      // Exclusions mutuelles : inscription / réinscription
      const exclusive = TYPE_EXCLUSIVE[type];
      const next = [...prev.filter((s) => !exclusive.includes(s)), type];

      // Si on active une inscription/réinscription, on supprime l'autre
      return next;
    });
  }

  // Construction des factures à créer à partir des services sélectionnés
  const drafts = useMemo(() => {
    if (!selectedEleve || !matchedTarif) return [];
    const moisNom = MOIS_NOMS[selectedMonth - 1];

    const result: { type: FactureType; libelle: string; montant: number; devise: string; mois: string | null }[] = [];

    for (const service of selectedServices) {
      let libelle = "";
      let montant = 0;
      let mois: string | null = null;

      switch (service) {
        case "MENSUALITE":
          montant = matchedTarif.mensualite;
          libelle = `Scolarité ${moisNom} ${selectedYear}`;
          mois = moisKey;
          break;
        case "INSCRIPTION":
          montant = matchedTarif.fraisInscription;
          libelle = `Frais d'inscription ${selectedYear}-${selectedYear + 1}`;
          break;
        case "RENOUVELLEMENT":
          montant = matchedTarif.fraisRenouvellement;
          libelle = `Frais de réinscription ${selectedYear}-${selectedYear + 1}`;
          break;
        case "CANTINE":
          montant = matchedTarif.fraisCantine ?? 0;
          libelle = `Cantine ${moisNom} ${selectedYear}`;
          mois = moisKey;
          break;
        case "TRANSPORT":
          montant = matchedTarif.fraisTransport ?? 0;
          libelle = `Transport ${moisNom} ${selectedYear}`;
          mois = moisKey;
          break;
        case "LIBRE":
          continue; // Pas de draft automatique pour le type libre
      }

      const key = TYPES_MENSUELS.includes(service) && mois ? `${service}:${mois}` : service;
      const existingFor = existingByKey.get(key) ?? null;
      const locked = existingFor !== null && existingFor.statut !== "ANNULEE";

      if (montant > 0 && !locked) {
        result.push({ type: service, libelle, montant, devise: matchedTarif.devise, mois });
      }
    }

    return result;
  }, [selectedServices, selectedEleve, matchedTarif, selectedMonth, selectedYear, moisKey, existingByKey]);

  const totalAmount = useMemo(() => drafts.reduce((sum, d) => sum + d.montant, 0), [drafts]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});

    if (!form.eleveId) {
      setErrors({ eleveId: t("formErrStudent") });
      toast.error(t("formErrors"));
      return;
    }

    if (selectedServices.length === 0) {
      toast.error(t("selectAtLeastOneService"));
      return;
    }

    if (drafts.length === 0) {
      toast.error(t("noDraftInvoices"));
      return;
    }

    const payload: FacturesCombineesData = {
      eleveId: form.eleveId,
      factures: drafts.map((d) => ({
        type: d.type,
        libelle: d.libelle,
        montant: d.montant,
        devise: d.devise,
        mois: d.mois,
      })),
    };

    setIsPending(true);
    try {
      const result = await createFacturesCombinees(payload);
      if (result.success && result.created.length > 0) {
        toast.success(t("formCreatedPlural", { count: result.created.length }));
        router.push(`/facturation/${result.created[0].id}`);
        router.refresh();
      } else {
        toast.error(t("allServicesAlreadyInvoiced"));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("genericError"));
    } finally {
      setIsPending(false);
    }
  }

  const serviceOptions: { value: FactureType; labelKey: string; requiresMonth: boolean }[] = [
    { value: "MENSUALITE", labelKey: "typeMensualite", requiresMonth: true },
    { value: "INSCRIPTION", labelKey: "typeInscription", requiresMonth: false },
    { value: "RENOUVELLEMENT", labelKey: "typeRenouvellement", requiresMonth: false },
    { value: "CANTINE", labelKey: "typeCantine", requiresMonth: true },
    { value: "TRANSPORT", labelKey: "typeTransport", requiresMonth: true },
  ];

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <Button asChild variant="outline" size="sm" className="gap-2">
          <Link href="/facturation">
            <ArrowLeft className="h-4 w-4" />
            {t("formBack")}
          </Link>
        </Button>
        <Button type="submit" size="sm" className="gap-2" disabled={isPending || drafts.length === 0}>
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {t("formCreate")}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("formNewInvoice")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Sélection classe + élève */}
          <div className="space-y-1.5">
            <Label htmlFor="eleveId">{t("formStudent")}</Label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div className={cn("sm:col-span-1", classes.length === 0 && "hidden")}>
                <select
                  id="classeFilter"
                  value={selectedClasseId}
                  onChange={(e) => {
                    setSelectedClasseId(e.target.value);
                    handleStudentChange("");
                  }}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">{t("allClasses")}</option>
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nom}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <StudentSearch
                  students={filteredEleves}
                  value={form.eleveId}
                  onChange={handleStudentChange}
                  placeholder={t("studentSearchPlaceholder")}
                  emptyMessage={t("noStudentFound")}
                  className={cn(errors.eleveId && "[&_input]:border-destructive")}
                />
              </div>
            </div>
            {errors.eleveId && <p className="text-xs text-destructive">{errors.eleveId}</p>}
          </div>

          {/* Info tarif trouvé */}
          {selectedEleve && matchedTarif && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-primary/5 border border-primary/20">
              <Sparkles className="h-4 w-4 text-primary flex-shrink-0" />
              <div className="text-sm">
                <span className="text-muted-foreground">{t("tarifFound")}: </span>
                <span className="font-semibold">
                  {matchedTarif.mensualite.toLocaleString()} {matchedTarif.devise}/{t("month")}
                </span>
                <span className="text-muted-foreground ml-2">({niveauToLabel(matchedTarif.niveau)})</span>
              </div>
            </div>
          )}
          {selectedEleve && !matchedTarif && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">
              {t("noTarifFound")}
            </div>
          )}

          {/* Sélection mois (si au moins un service mensuel est sélectionné) */}
          {selectedServices.some((s) => TYPES_MENSUELS.includes(s)) && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>{t("formMonth")}</Label>
                <select
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(parseInt(e.target.value))}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {MOIS_NOMS.map((nom, i) => (
                    <option key={i} value={i + 1}>{nom}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>{t("formYear")}</Label>
                <Input
                  type="number"
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(parseInt(e.target.value) || new Date().getFullYear())}
                  className="h-10"
                />
              </div>
            </div>
          )}

          {/* Services cliquables */}
          <div className="space-y-1.5">
            <Label>{t("servicesToInvoice")}</Label>
            {existingLoading && (
              <p className="text-xs text-muted-foreground">{t("loadingExistingInvoices")}...</p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {serviceOptions.map((opt) => {
                const isSelected = selectedServices.includes(opt.value);
                const existingFor = getExistingFor(opt.value, opt.requiresMonth ? moisKey : undefined);
                const locked = isLocked(opt.value, opt.requiresMonth ? moisKey : undefined);
                const paid = isPaid(existingFor);

                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => !locked && toggleService(opt.value)}
                    disabled={locked || existingLoading}
                    className={cn(
                      "relative flex flex-col items-start gap-1 p-3 rounded-lg border text-left transition-all",
                      isSelected && !locked
                        ? "border-primary bg-primary/10 text-primary"
                        : locked
                          ? "border-muted bg-muted/40 text-muted-foreground cursor-not-allowed"
                          : "border-input bg-background hover:bg-muted/50",
                      locked && "opacity-80"
                    )}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span className="font-medium text-sm">{t(opt.labelKey)}</span>
                      {isSelected && !locked && <CheckCircle2 className="h-4 w-4" />}
                      {locked && paid && <AlertCircle className="h-4 w-4 text-amber-600" />}
                    </div>
                    {locked && existingFor && (
                      <span className="text-[10px] leading-tight text-muted-foreground">
                        {paid
                          ? t("invoiceAlreadyPaid", { numero: existingFor.numero })
                          : t("invoiceAlreadyPending", { numero: existingFor.numero })}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">{t("inscriptionRenouvellementExclusive")}</p>
          </div>

          {/* Résumé des factures à créer */}
          {drafts.length > 0 && (
            <div className="p-4 rounded-lg bg-muted/30 border space-y-2">
              <p className="text-xs text-muted-foreground">{t("formSummary")}</p>
              {drafts.map((d) => (
                <div key={d.type} className="flex items-center justify-between text-sm">
                  <div>
                    <span className="font-medium">{d.libelle}</span>
                    {d.mois && <Badge variant="secondary" className="text-[10px] ml-2">{d.mois}</Badge>}
                  </div>
                  <span className="font-semibold">{d.montant.toLocaleString()} {d.devise}</span>
                </div>
              ))}
              <div className="pt-2 border-t flex items-center justify-between">
                <span className="text-sm">{t("totalToInvoice")}</span>
                <span className="text-lg font-bold">{totalAmount.toLocaleString()} {drafts[0]?.devise}</span>
              </div>
            </div>
          )}

          {drafts.length === 0 && selectedServices.length > 0 && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              {t("selectedServicesAlreadyInvoiced")}
            </div>
          )}
        </CardContent>
      </Card>
    </form>
  );
}
