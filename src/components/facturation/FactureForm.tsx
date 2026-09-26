"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { ArrowLeft, AlertTriangle, Info, Loader2, Save } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { createFacture, type FactureFormData } from "@/lib/actions/facture";
import { getTarifPourEleve, type TarifEleve } from "@/lib/actions/facturation-avancee";
import type { TypeFrais } from "@/lib/tarifs";
import { StudentSearch } from "./StudentSearch";
import { useTranslations } from "next-intl";

interface EleveOption {
  id: string;
  nom: string;
  prenom: string;
  matricule: string;
  classe: { id: string; nom: string } | null;
}

interface ClasseOption {
  id: string;
  nom: string;
}

const FormSchema = z
  .object({
    eleveId: z.string().min(1, "formErrStudent"),
    libelle: z.string().min(1, "formErrLabel"),
    montant: z.number().min(0, "formErrAmount"),
    echeance: z.string().optional(),
    typeFrais: z.enum(["MENSUALITE", "INSCRIPTION", "RENOUVELLEMENT"]).optional(),
  })
  .refine((v) => v.typeFrais !== undefined || v.montant >= 0.01, {
    message: "formErrAmount",
    path: ["montant"],
  });

export function FactureForm({
  eleves,
  classes,
  eleveIdPreselected,
  annee,
}: {
  eleves: EleveOption[];
  classes: ClasseOption[];
  eleveIdPreselected?: string;
  annee?: string;
}) {
  const t = useTranslations("facturation");
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const [form, setForm] = useState<FactureFormData>({
    eleveId: eleveIdPreselected ?? "",
    libelle: "",
    montant: 0,
    devise: "DJF",
    echeance: "",
    typeFrais: undefined,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [selectedClasseId, setSelectedClasseId] = useState("");
  const [tarif, setTarif] = useState<TarifEleve | null>(null);
  const [tarifLoading, setTarifLoading] = useState(false);

  const typeFrais = form.typeFrais;

  useEffect(() => {
    if (eleveIdPreselected) {
      const eleve = eleves.find((e) => e.id === eleveIdPreselected);
      if (eleve?.classe?.id) setSelectedClasseId(eleve.classe.id);
    }
  }, [eleveIdPreselected, eleves]);

  /**
   * Tarif du niveau de la classe de l'élève, relu depuis la grille dès qu'un
   * type de frais est choisi : le montant affiché est celui que le serveur
   * appliquera (`createFacture` le relit de toute façon).
   */
  useEffect(() => {
    let cancelled = false;
    const eleveConnu = eleves.some((e) => e.id === form.eleveId);

    if (!typeFrais || !eleveConnu) {
      setTarif(null);
      return;
    }

    setTarifLoading(true);
    getTarifPourEleve(form.eleveId, typeFrais)
      .then((resultat) => {
        if (cancelled) return;
        setTarif(resultat);
        if (resultat) {
          setForm((prev) => ({
            ...prev,
            montant: resultat.montant,
            devise: resultat.devise,
            libelle:
              prev.libelle.trim().length > 0 || !annee
                ? prev.libelle
                : typeFrais === "INSCRIPTION"
                  ? t("feeLabelInscription", { annee })
                  : typeFrais === "RENOUVELLEMENT"
                    ? t("feeLabelRenewal", { annee })
                    : prev.libelle,
          }));
        }
      })
      .catch(() => {
        if (!cancelled) setTarif(null);
      })
      .finally(() => {
        if (!cancelled) setTarifLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // `t` est stable pour une locale donnée.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.eleveId, typeFrais, eleves, annee]);

  const filteredEleves = useMemo(() => {
    if (!selectedClasseId) return eleves;
    return eleves.filter((e) => e.classe?.id === selectedClasseId);
  }, [eleves, selectedClasseId]);

  function updateField<K extends keyof FactureFormData>(field: K, value: FactureFormData[K]) {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: "" }));
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

    // Aucune facture tarifée sans tarif : le serveur refuserait, on l'annonce
    // dès le formulaire.
    if (form.typeFrais && !tarif) {
      setErrors({ montant: t("formErrTarif") });
      toast.error(t("formErrTarif"));
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
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5 md:col-span-2">
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

          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="typeFrais">{t("formFeeType")}</Label>
            <select
              id="typeFrais"
              value={typeFrais ?? "LIBRE"}
              onChange={(e) => {
                const valeur = e.target.value;
                if (valeur === "LIBRE") {
                  setTarif(null);
                  updateField("typeFrais", undefined);
                } else {
                  updateField("typeFrais", valeur as TypeFrais);
                }
              }}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="MENSUALITE">{t("feeMonthly")}</option>
              <option value="INSCRIPTION">{t("feeInscription")}</option>
              <option value="RENOUVELLEMENT">{t("feeRenewal")}</option>
              <option value="LIBRE">{t("feeFree")}</option>
            </select>

            {tarifLoading && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t("tarifLoading")}
              </p>
            )}

            {!tarifLoading && tarif && (
              <p
                id="tarif-applique"
                className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400"
              >
                <Info className="h-3.5 w-3.5" />
                {t("tarifApplied", {
                  niveau: tarif.niveau,
                  montant: new Intl.NumberFormat("fr-DJ", { maximumFractionDigits: 0 }).format(
                    tarif.montant
                  ),
                  devise: tarif.devise,
                  source: tarif.propreAuSite ? t("tarifSourceSite") : t("tarifSourceGlobal"),
                })}
              </p>
            )}

            {!tarifLoading && typeFrais && !tarif && form.eleveId && (
              <p className="flex items-center gap-1.5 text-xs text-destructive">
                <AlertTriangle className="h-3.5 w-3.5" />
                {t("tarifMissing")}
              </p>
            )}
          </div>

          <div className="space-y-1.5 md:col-span-2">
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

          <div className="space-y-1.5">
            <Label htmlFor="montant">{t("formAmount")}</Label>
            <Input
              id="montant"
              type="number"
              min="0"
              step="0.01"
              value={form.montant || ""}
              onChange={(e) => updateField("montant", parseFloat(e.target.value) || 0)}
              readOnly={!!tarif}
              aria-describedby={tarif ? "tarif-applique" : undefined}
              className={cn(inputClass("montant"), tarif && "bg-muted cursor-not-allowed")}
            />
            {errors.montant && <p className="text-xs text-destructive">{errors.montant}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="echeance">{t("formDueDate")}</Label>
            <Input
              id="echeance"
              type="date"
              value={form.echeance ?? ""}
              onChange={(e) => updateField("echeance", e.target.value)}
            />
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
