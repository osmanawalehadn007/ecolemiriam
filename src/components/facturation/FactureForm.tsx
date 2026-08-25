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
import { ArrowLeft, Loader2, Save, Sparkles } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { createFacture, type FactureFormData } from "@/lib/actions/facture";
import { StudentSearch } from "./StudentSearch";
import { useTranslations } from "next-intl";

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

const MOIS_NOMS = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];

const FormSchema = z.object({
  eleveId: z.string().min(1, "formErrStudent"),
  libelle: z.string().min(1, "formErrLabel"),
  montant: z.number().min(0.01, "formErrAmount"),
});

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
  const [factureType, setFactureType] = useState<FactureType>("MENSUALITE");
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [form, setForm] = useState<FactureFormData>({
    eleveId: eleveIdPreselected ?? "",
    libelle: "",
    montant: 0,
    devise: "DJF",
    mois: null,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [selectedClasseId, setSelectedClasseId] = useState("");

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

  // Trouver le tarif correspondant au niveau de l'élève sélectionné
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

  // Auto-remplir le montant et le libellé quand le type ou l'élève change
  function autoFillFromTarif(type: FactureType, eleveId: string) {
    const eleve = eleves.find((e) => e.id === eleveId);
    if (!eleve?.classe?.niveau) return;
    const tarif = tarifs.find(
      (t) => t.niveau.toLowerCase() === eleve.classe!.niveau.toLowerCase()
    );
    if (!tarif) return;

    const moisNom = MOIS_NOMS[selectedMonth - 1];
    const moisKey = `${selectedYear}-${String(selectedMonth).padStart(2, "0")}`;
    let montant = 0;
    let libelle = "";

    switch (type) {
      case "MENSUALITE":
        montant = tarif.mensualite;
        libelle = `Scolarité ${moisNom} ${selectedYear}`;
        setForm((prev) => ({ ...prev, montant, libelle, mois: moisKey, devise: tarif.devise }));
        break;
      case "INSCRIPTION":
        montant = tarif.fraisInscription;
        libelle = `Frais d'inscription ${selectedYear}-${selectedYear + 1}`;
        setForm((prev) => ({ ...prev, montant, libelle, mois: null, devise: tarif.devise }));
        break;
      case "RENOUVELLEMENT":
        montant = tarif.fraisRenouvellement;
        libelle = `Frais de renouvellement ${selectedYear}-${selectedYear + 1}`;
        setForm((prev) => ({ ...prev, montant, libelle, mois: null, devise: tarif.devise }));
        break;
      case "CANTINE":
        montant = tarif.fraisCantine ?? 0;
        libelle = `Cantine ${moisNom} ${selectedYear}`;
        setForm((prev) => ({ ...prev, montant, libelle, mois: moisKey, devise: tarif.devise }));
        break;
      case "TRANSPORT":
        montant = tarif.fraisTransport ?? 0;
        libelle = `Transport ${moisNom} ${selectedYear}`;
        setForm((prev) => ({ ...prev, montant, libelle, mois: moisKey, devise: tarif.devise }));
        break;
      case "LIBRE":
        // Ne pas auto-remplir pour le mode libre
        break;
    }
  }

  // Quand l'élève change, auto-remplir si pas en mode libre
  useEffect(() => {
    if (form.eleveId && factureType !== "LIBRE") {
      autoFillFromTarif(factureType, form.eleveId);
    }
  }, [form.eleveId, factureType]); // eslint-disable-line react-hooks/exhaustive-deps

  // Quand le mois ou l'année change, re-remplir si mensualité/cantine/transport
  useEffect(() => {
    if (form.eleveId && ["MENSUALITE", "CANTINE", "TRANSPORT"].includes(factureType)) {
      autoFillFromTarif(factureType, form.eleveId);
    }
  }, [selectedMonth, selectedYear]); // eslint-disable-line react-hooks/exhaustive-deps

  function updateField<K extends keyof FactureFormData>(field: K, value: FactureFormData[K]) {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: "" }));
  }

  function handleTypeChange(type: FactureType) {
    setFactureType(type);
    if (form.eleveId && type !== "LIBRE") {
      autoFillFromTarif(type, form.eleveId);
    } else if (type === "LIBRE") {
      setForm((prev) => ({ ...prev, montant: 0, libelle: "", mois: null }));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});

    const parsed = FormSchema.safeParse(form);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      parsed.error.issues.forEach((issue) => {
        next[issue.path[0]] = t(issue.message);
      });
      setErrors(next);
      toast.error(t("formErrors"));
      return;
    }

    setIsPending(true);
    try {
      const result = await createFacture(form);
      toast.success(t("formCreated"));
      router.push(`/facturation/${result.id}`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("genericError"));
    } finally {
      setIsPending(false);
    }
  }

  const inputClass = (field: string) => cn("h-10", errors[field] && "border-destructive");

  const typeOptions: { value: FactureType; labelKey: string }[] = [
    { value: "MENSUALITE", labelKey: "typeMensualite" },
    { value: "INSCRIPTION", labelKey: "typeInscription" },
    { value: "RENOUVELLEMENT", labelKey: "typeRenouvellement" },
    { value: "CANTINE", labelKey: "typeCantine" },
    { value: "TRANSPORT", labelKey: "typeTransport" },
    { value: "LIBRE", labelKey: "typeLibre" },
  ];

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <Button asChild variant="outline" size="sm" className="gap-2">
          <Link href="/facturation">
            <ArrowLeft className="h-4 w-4" />
            {t("formBack")}
          </Link>
        </Button>
        <Button type="submit" size="sm" className="gap-2" disabled={isPending}>
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {t("formCreate")}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("formNewInvoice")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Type de facture */}
          <div className="space-y-1.5">
            <Label>{t("formType")}</Label>
            <div className="flex flex-wrap gap-2">
              {typeOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handleTypeChange(opt.value)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-sm font-medium border transition-all",
                    factureType === opt.value
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-input bg-background hover:bg-muted/50"
                  )}
                >
                  {t(opt.labelKey)}
                </button>
              ))}
            </div>
          </div>

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
                    updateField("eleveId", "");
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
                  onChange={(id) => updateField("eleveId", id)}
                  placeholder={t("studentSearchPlaceholder")}
                  emptyMessage={t("noStudentFound")}
                  className={cn(errors.eleveId && "[&_input]:border-destructive")}
                />
              </div>
            </div>
            {errors.eleveId && <p className="text-xs text-destructive">{errors.eleveId}</p>}
          </div>

          {/* Info tarif trouvé */}
          {selectedEleve && matchedTarif && factureType !== "LIBRE" && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-primary/5 border border-primary/20">
              <Sparkles className="h-4 w-4 text-primary flex-shrink-0" />
              <div className="text-sm">
                <span className="text-muted-foreground">{t("tarifFound")}: </span>
                <span className="font-semibold">
                  {matchedTarif.mensualite.toLocaleString()} {matchedTarif.devise}/{t("month")}
                </span>
                <span className="text-muted-foreground ml-2">({matchedTarif.niveau})</span>
              </div>
            </div>
          )}
          {selectedEleve && !matchedTarif && factureType !== "LIBRE" && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">
              {t("noTarifFound")}
            </div>
          )}

          {/* Sélection mois (pour mensualité, cantine, transport) */}
          {["MENSUALITE", "CANTINE", "TRANSPORT"].includes(factureType) && (
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

          {/* Libellé */}
          <div className="space-y-1.5">
            <Label htmlFor="libelle">{t("formLabel")}</Label>
            <Input
              id="libelle"
              placeholder={t("formLabelPlaceholder")}
              value={form.libelle}
              onChange={(e) => updateField("libelle", e.target.value)}
              className={inputClass("libelle")}
            />
            {errors.libelle && <p className="text-xs text-destructive">{errors.libelle}</p>}
          </div>

          {/* Montant + devise */}
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5 col-span-2">
              <Label htmlFor="montant">{t("formAmount")}</Label>
              <Input
                id="montant"
                type="number"
                min="0"
                step="0.01"
                value={form.montant || ""}
                onChange={(e) => updateField("montant", parseFloat(e.target.value) || 0)}
                className={inputClass("montant")}
              />
              {errors.montant && <p className="text-xs text-destructive">{errors.montant}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="devise">{t("formDevise")}</Label>
              <Input
                id="devise"
                value={form.devise}
                onChange={(e) => updateField("devise", e.target.value)}
                className="h-10"
              />
            </div>
          </div>

          {/* Résumé */}
          {form.montant > 0 && form.eleveId && form.libelle && (
            <div className="p-4 rounded-lg bg-muted/30 border">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">{t("formSummary")}</p>
                  <p className="font-semibold text-sm mt-1">{form.libelle}</p>
                  <p className="text-xs text-muted-foreground">
                    {selectedEleve && `${selectedEleve.prenom} ${selectedEleve.nom} · ${selectedEleve.classe?.nom ?? "N/A"}`}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold">{form.montant.toLocaleString()} {form.devise}</p>
                  {form.mois && <Badge variant="secondary" className="text-xs mt-1">{form.mois}</Badge>}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </form>
  );
}
