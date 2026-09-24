"use client";

import { useState, useTransition, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Plus, Search, ClipboardList, CheckCircle2, XCircle,
  Clock, UserPlus, BookOpen, Phone, Mail, Calendar,
  Loader2, ChevronDown, ChevronUp, FileText, Star, FolderCheck,
  Banknote, Link as LinkIcon, AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { cn, formatDate } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { PiecesJustificativesUploader } from "./PiecesJustificativesUploader";
import { piecesRequisesPresentes } from "@/lib/admissions/pieces-justificatives";
import { enregistrerPaiement } from "@/lib/actions/facture";
import { PAYMENT_METHODS } from "@/lib/payment-methods";
import { optionsMoisScolarite, moisScolariteDefaut } from "@/lib/admissions/mois-scolarite";

// ─── Types ────────────────────────────────────────────────────────────────────

type StatutCandidature = "SOUMISE" | "DOSSIER_COMPLET" | "EN_EXAMEN" | "ADMIS" | "REFUSE" | "INSCRIT" | "ANNULE";
type LienParente = "PERE" | "MERE" | "TUTEUR" | "AUTRE";
type Sexe = "M" | "F";

interface Candidature {
  id: string;
  nom: string;
  prenom: string;
  dateNaissance: Date | string;
  sexe: Sexe;
  classeVoulue: string;
  annee: string;
  parentNom: string;
  parentPrenom: string;
  parentEmail: string | null;
  parentPhone: string;
  parentLien: LienParente;
  statut: StatutCandidature;
  dateExamen: Date | string | null;
  noteExamen: number | null;
  commentaire: string | null;
  motifRefus: string | null;
  documents?: { nom: string; url: string; type?: string }[] | null;
  factures?: {
    id: string;
    numero: string;
    libelle: string;
    montant: number;
    devise: string;
    statut: string;
    totalPaye: number;
  }[];
  createdAt: Date | string;
}

// ─── Config statuts ───────────────────────────────────────────────────────────

const STATUT_CONFIG: Record<StatutCandidature, { labelKey: string; color: string; icon: React.ReactNode }> = {
  SOUMISE: { labelKey: "statusSubmitted", color: "bg-blue-50 text-blue-700 border-blue-200", icon: <ClipboardList className="w-3 h-3" /> },
  DOSSIER_COMPLET: { labelKey: "statusDossierComplet", color: "bg-teal-50 text-teal-700 border-teal-200", icon: <FolderCheck className="w-3 h-3" /> },
  EN_EXAMEN: { labelKey: "statusExam", color: "bg-yellow-50 text-yellow-700 border-yellow-200", icon: <Clock className="w-3 h-3" /> },
  ADMIS: { labelKey: "statusAdmitted", color: "bg-green-50 text-green-700 border-green-200", icon: <CheckCircle2 className="w-3 h-3" /> },
  REFUSE: { labelKey: "statusRefused", color: "bg-red-50 text-red-700 border-red-200", icon: <XCircle className="w-3 h-3" /> },
  INSCRIT: { labelKey: "statusEnrolled", color: "bg-purple-50 text-purple-700 border-purple-200", icon: <UserPlus className="w-3 h-3" /> },
  ANNULE: { labelKey: "statusCancelled", color: "bg-gray-100 text-gray-500 border-gray-200", icon: <XCircle className="w-3 h-3" /> },
};

const WORKFLOW: StatutCandidature[] = ["SOUMISE", "DOSSIER_COMPLET", "EN_EXAMEN", "ADMIS", "INSCRIT"];

// ─── Formulaire de candidature ────────────────────────────────────────────────

function CandidatureForm({
  onClose,
  onCreated,
  classes,
  annee,
}: {
  onClose: () => void;
  onCreated: (c: Candidature) => void;
  classes: ClasseOption[];
  annee?: string;
}) {
  const t = useTranslations("admissions");
  // L'année vient du serveur (année courante du tenant). Le repli calendaire
  // ne sert que si aucune année scolaire n'est déclarée dans les paramètres.
  const anneeActuelle = annee ?? `${new Date().getFullYear()}-${new Date().getFullYear() + 1}`;
  // Plusieurs sites présents dans la liste ? Alors on affiche le site pour lever
  // toute ambiguïté entre classes homonymes.
  const multiSites = new Set(classes.map((c) => c.siteNom ?? "")).size > 1;
  const [form, setForm] = useState({
    nom: "", prenom: "", dateNaissance: "", sexe: "M" as Sexe,
    classeId: "", classeVoulue: "", annee: anneeActuelle,
    parentNom: "", parentPrenom: "", parentEmail: "", parentPhone: "",
    parentLien: "PERE" as LienParente,
  });
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      try {
        const res = await fetch("/api/admissions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
        if (!res.ok) throw new Error();
        const { candidature } = await res.json();
        toast.success(t("candidatureSaved"));
        onCreated(candidature);
        onClose();
      } catch {
        toast.error(t("saveError"));
      }
    });
  };

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-2xl max-h-[90vh] flex flex-col border-0 shadow-2xl">
        <CardHeader className="pb-4 flex-shrink-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <UserPlus className="w-5 h-5 text-primary" />
            {t("newCandidature")}
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-y-auto">
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Informations élève */}
            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                {t("studentInfo")}
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-600 mb-1 block">{t("lastName")}</label>
                  <Input value={form.nom} onChange={(e) => set("nom", e.target.value)} required placeholder="DIALLO" className="text-sm" />
                </div>
                <div>
                  <label className="text-xs text-gray-600 mb-1 block">{t("firstName")}</label>
                  <Input value={form.prenom} onChange={(e) => set("prenom", e.target.value)} required placeholder="Amadou" className="text-sm" />
                </div>
                <div>
                  <label className="text-xs text-gray-600 mb-1 block">{t("birthDate")}</label>
                  <Input type="date" value={form.dateNaissance} onChange={(e) => set("dateNaissance", e.target.value)} required className="text-sm" />
                </div>
                <div>
                  <label className="text-xs text-gray-600 mb-1 block">{t("gender")}</label>
                  <select
                    value={form.sexe}
                    onChange={(e) => set("sexe", e.target.value)}
                    className="w-full rounded-md border border-input px-3 py-2 text-sm bg-background"
                  >
                    <option value="M">{t("male")}</option>
                    <option value="F">{t("female")}</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-600 mb-1 block">{t("desiredClass")}</label>
                  {classes.length > 0 ? (
                    <select
                      value={form.classeId}
                      onChange={(e) => set("classeId", e.target.value)}
                      required
                      className="w-full rounded-md border border-input px-3 py-2 text-sm bg-background"
                    >
                      <option value="" disabled>
                        {t("selectClass")}
                      </option>
                      {multiSites ? (
                        // Grouper par site quand plusieurs sites sont présents :
                        // évite de sélectionner une classe d'un autre site par erreur.
                        Object.entries(
                          classes.reduce<Record<string, ClasseOption[]>>((acc, c) => {
                            const key = c.siteNom ?? t("unassignedSite");
                            (acc[key] ??= []).push(c);
                            return acc;
                          }, {})
                        ).map(([siteNom, siteClasses]) => (
                          <optgroup key={siteNom} label={siteNom}>
                            {siteClasses.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.nom}
                              </option>
                            ))}
                          </optgroup>
                        ))
                      ) : (
                        classes.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.nom}
                          </option>
                        ))
                      )}
                    </select>
                  ) : (
                    <Input value={form.classeVoulue} onChange={(e) => set("classeVoulue", e.target.value)} required placeholder="6ème, Terminale S…" className="text-sm" />
                  )}
                </div>
                <div>
                  <label className="text-xs text-gray-600 mb-1 block">{t("schoolYear")}</label>
                  {/* Année verrouillée : les classes proposées sont celles de
                      l'année courante du site. Laisser saisir une autre année
                      produisait une candidature rattachée à une classe d'une
                      année révolue. */}
                  <Input value={form.annee} readOnly disabled className="text-sm" />
                </div>
              </div>
            </div>

            {/* Informations parent */}
            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                {t("parentInfo")}
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-600 mb-1 block">{t("lastName")}</label>
                  <Input value={form.parentNom} onChange={(e) => set("parentNom", e.target.value)} required className="text-sm" />
                </div>
                <div>
                  <label className="text-xs text-gray-600 mb-1 block">{t("firstName")}</label>
                  <Input value={form.parentPrenom} onChange={(e) => set("parentPrenom", e.target.value)} required className="text-sm" />
                </div>
                <div>
                  <label className="text-xs text-gray-600 mb-1 block">{t("email")}</label>
                  <Input type="email" value={form.parentEmail} onChange={(e) => set("parentEmail", e.target.value)} placeholder={t("emailOptional")} className="text-sm" />
                </div>
                <div>
                  <label className="text-xs text-gray-600 mb-1 block">{t("phone")}</label>
                  <Input value={form.parentPhone} onChange={(e) => set("parentPhone", e.target.value)} required placeholder="+221 77 000 00 00" className="text-sm" />
                </div>
                <div>
                  <label className="text-xs text-gray-600 mb-1 block">{t("relationship")}</label>
                  <select
                    value={form.parentLien}
                    onChange={(e) => set("parentLien", e.target.value)}
                    className="w-full rounded-md border border-input px-3 py-2 text-sm bg-background"
                  >
                    <option value="PERE">{t("father")}</option>
                    <option value="MERE">{t("mother")}</option>
                    <option value="TUTEUR">{t("guardian")}</option>
                    <option value="AUTRE">{t("other")}</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <Button type="submit" disabled={isPending} className="flex-1 gap-2">
                {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                {t("saveCandidature")}
              </Button>
              <Button type="button" variant="outline" onClick={onClose}>
                {t("cancel")}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Carte candidature ────────────────────────────────────────────────────────

function CandidatureCard({
  candidature,
  onUpdate,
  userRole,
}: {
  candidature: Candidature;
  onUpdate: (updated: Candidature) => void;
  userRole?: string;
}) {
  const t = useTranslations("admissions");
  const [expanded, setExpanded] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [localDocs, setLocalDocs] = useState<{ nom: string; url: string; type?: string }[]>(candidature.documents ?? []);
  const [showPaiementModal, setShowPaiementModal] = useState(false);
  const [showAdmitModal, setShowAdmitModal] = useState(false);
  const config = STATUT_CONFIG[candidature.statut];

  const piecesStatut = piecesRequisesPresentes(localDocs);

  // Facture d'inscription (premier élément)
  const facture = candidature.factures?.[0];
  const facturePayee = facture && facture.montant > 0 && facture.totalPaye >= facture.montant;
  const factureRestant = facture ? facture.montant - facture.totalPaye : 0;

  // Indicateur de progression du dossier
  const progressionSteps = [
    { key: "SOUMISE", label: t("statusSubmitted"), done: WORKFLOW.indexOf(candidature.statut) >= 0 },
    { key: "DOSSIER_COMPLET", label: t("statusDossierComplet"), done: WORKFLOW.indexOf(candidature.statut) >= 1 },
    { key: "EN_EXAMEN", label: t("statusExam"), done: WORKFLOW.indexOf(candidature.statut) >= 2 },
    { key: "ADMIS", label: t("statusAdmitted"), done: WORKFLOW.indexOf(candidature.statut) >= 3 },
    { key: "PAIEMENT", label: t("stepPayment"), done: !!facturePayee },
    { key: "INSCRIT", label: t("statusEnrolled"), done: candidature.statut === "INSCRIT" },
  ];

  const handleStatut = (statut: StatutCandidature, extra?: Record<string, unknown>) => {
    startTransition(async () => {
      try {
        const res = await fetch(`/api/admissions/${candidature.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ statut, documents: localDocs, ...extra }),
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error ?? "Échec");
        }
        const { candidature: updated, eleveCreeId } = await res.json();
        onUpdate(updated);
        if (statut === "INSCRIT" && eleveCreeId) {
          toast.success(`${t("statusUpdated", { status: t(STATUT_CONFIG[statut].labelKey) })} — ${t("studentCreated")}`);
        } else {
          toast.success(t("statusUpdated", { status: t(STATUT_CONFIG[statut].labelKey) }));
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t("updateError"));
      }
    });
  };

  const handleSaveDocuments = () => {
    startTransition(async () => {
      try {
        const res = await fetch(`/api/admissions/${candidature.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ documents: localDocs }),
        });
        if (!res.ok) throw new Error("Échec de la sauvegarde");
        const { candidature: updated } = await res.json();
        onUpdate(updated);
        toast.success("Pièces justificatives sauvegardées");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Erreur de sauvegarde");
      }
    });
  };

  // Actions disponibles selon le statut
  // L'inscription finale (INSCRIT) est accessible au comptable (bout-en-bout)
  // La direction est notifiée automatiquement côté serveur lors de la finalisation.
  const canConfirmEnrollment =
    userRole === "TENANT_ADMIN" ||
    userRole === "SUPER_ADMIN" ||
    userRole === "ACCOUNTANT";
  const actions: { label: string; statut: StatutCandidature; variant?: string; disabled?: boolean }[] = [];
  if (candidature.statut === "SOUMISE") {
    // Marquer dossier complet (pièces vérifiées) — possible même si pas toutes les pièces
    actions.push({ label: t("markDossierComplet"), statut: "DOSSIER_COMPLET" });
    actions.push({ label: t("reject"), statut: "REFUSE", variant: "destructive" });
  }
  if (candidature.statut === "DOSSIER_COMPLET") {
    // Passer à l'examen — bloqué si pièces requises manquantes
    actions.push({
      label: piecesStatut.complet ? t("summonExam") : t("summonExamMissingDocs"),
      statut: "EN_EXAMEN",
      disabled: !piecesStatut.complet,
    });
    actions.push({ label: t("reject"), statut: "REFUSE", variant: "destructive" });
  }
  if (candidature.statut === "EN_EXAMEN") {
    actions.push({ label: t("admit"), statut: "ADMIS" });
    actions.push({ label: t("reject"), statut: "REFUSE", variant: "destructive" });
  }
  if (candidature.statut === "ADMIS" && canConfirmEnrollment) {
    if (!facture) {
      actions.push({
        label: t("confirmEnrollmentNoInvoice"),
        statut: "INSCRIT",
        disabled: true,
      });
    } else if (facturePayee) {
      actions.push({ label: t("confirmEnrollment"), statut: "INSCRIT" });
    } else {
      actions.push({
        label: t("confirmEnrollmentUnpaid"),
        statut: "INSCRIT",
        disabled: true,
      });
    }
  }

  return (
    <Card className="border-0 shadow-sm hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center flex-shrink-0">
              <BookOpen className="w-5 h-5 text-indigo-600" />
            </div>
            <div>
              <p className="font-semibold text-sm text-gray-900 dark:text-white">
                {candidature.prenom} {candidature.nom}
              </p>
              <p className="text-xs text-gray-500">
                {candidature.classeVoulue} · {candidature.annee}
              </p>
            </div>
          </div>
          <Badge className={cn("text-xs gap-1 flex-shrink-0", config.color)}>
            {config.icon} {t(config.labelKey)}
          </Badge>
        </div>

        {/* Infos parent */}
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <Phone className="w-3 h-3" />
            {candidature.parentPhone}
          </span>
          {candidature.parentEmail && (
            <span className="flex items-center gap-1">
              <Mail className="w-3 h-3" />
              {candidature.parentEmail}
            </span>
          )}
          <span className="flex items-center gap-1">
            <Calendar className="w-3 h-3" />
            {formatDate(candidature.createdAt)}
          </span>
          {candidature.noteExamen !== null && (
            <span className="flex items-center gap-1 font-medium text-gray-700 dark:text-gray-300">
              <Star className="w-3 h-3 text-yellow-500" />
              {candidature.noteExamen}/20
            </span>
          )}
        </div>

        {/* Motif refus */}
        {candidature.statut === "REFUSE" && candidature.motifRefus && (
          <div className="mt-2 px-3 py-2 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800 rounded-lg">
            <p className="text-xs text-red-600 dark:text-red-400">
              {t("motif", { reason: candidature.motifRefus })}
            </p>
          </div>
        )}

        {/* Commentaire */}
        {candidature.commentaire && (
          <p className="mt-2 text-xs text-gray-500 italic">{candidature.commentaire}</p>
        )}

        {/* Indicateur de progression du dossier */}
        {candidature.statut !== "REFUSE" && candidature.statut !== "ANNULE" && (
          <div className="mt-3 flex items-center gap-1 flex-wrap">
            {progressionSteps.map((step, i) => (
              <div key={step.key} className="flex items-center gap-1">
                <div className={cn(
                  "flex items-center gap-1 px-2 py-0.5 rounded-full text-xs",
                  step.done
                    ? "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                    : "bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500"
                )}>
                  {step.done ? (
                    <CheckCircle2 className="w-3 h-3" />
                  ) : (
                    <div className="w-3 h-3 rounded-full border border-current" />
                  )}
                  <span className="text-xs font-medium">{step.label}</span>
                </div>
                {i < progressionSteps.length - 1 && (
                  <div className={cn("w-3 h-px", step.done ? "bg-green-300" : "bg-gray-200")} />
                )}
              </div>
            ))}
          </div>
        )}

        {/* Facture d'inscription (visible à partir de ADMIS) */}
        {candidature.factures && candidature.factures.length > 0 && (
          <div className="mt-3 px-3 py-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-lg space-y-1">
            {candidature.factures.map((f) => {
              const restant = f.montant - f.totalPaye;
              const estPayee = f.montant > 0 && f.totalPaye >= f.montant;
              const fmt = (n: number) => new Intl.NumberFormat("fr-DJ", { style: "currency", currency: f.devise === "XOF" ? "DJF" : f.devise, maximumFractionDigits: 0 }).format(n);
              return (
                <div key={f.id} className="space-y-1">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText className="w-3 h-3 text-blue-600 flex-shrink-0" />
                      <a
                        href={`/facturation?numero=${encodeURIComponent(f.numero)}`}
                        className="font-medium text-blue-600 hover:underline flex items-center gap-1"
                      >
                        {f.numero}
                        <LinkIcon className="w-2.5 h-2.5" />
                      </a>
                      <span className="text-muted-foreground truncate hidden sm:inline">{f.libelle}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="font-semibold">{fmt(f.montant)}</span>
                      {estPayee ? (
                        <Badge className="bg-green-50 text-green-700 border-green-200 text-xs">
                          <CheckCircle2 className="w-3 h-3 mr-1" />
                          {t("invoicePaid")}
                        </Badge>
                      ) : (
                        <Badge className="bg-amber-50 text-amber-700 border-amber-200 text-xs">
                          {t("invoiceUnpaid")} ({fmt(restant)})
                        </Badge>
                      )}
                    </div>
                  </div>
                  {/* Barre de progression du paiement */}
                  {!estPayee && f.montant > 0 && (
                    <div className="w-full h-1.5 bg-amber-100 dark:bg-amber-900/30 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-green-500 rounded-full transition-all"
                        style={{ width: `${Math.min(100, (f.totalPaye / f.montant) * 100)}%` }}
                      />
                    </div>
                  )}
                  {/* Bouton encaisser + message */}
                  {candidature.statut === "ADMIS" && !estPayee && f.montant > 0 && (
                    <div className="flex items-center justify-between gap-2 pt-1">
                      <p className="text-xs text-amber-600">
                        {t("paymentRequiredBeforeEnrollment")}
                      </p>
                      <Button
                        size="sm"
                        className="h-7 text-xs gap-1 flex-shrink-0"
                        onClick={() => setShowPaiementModal(true)}
                        disabled={isPending}
                      >
                        <Banknote className="w-3 h-3" />
                        {t("collectPayment")}
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Modal d'encaissement inline */}
        {showPaiementModal && facture && (
          <PaiementInlineModal
            factureId={facture.id}
            factureNumero={facture.numero}
            montantTotal={facture.montant}
            totalPaye={facture.totalPaye}
            devise={facture.devise}
            onClose={() => setShowPaiementModal(false)}
            onPaid={() => {
              setShowPaiementModal(false);
              // Rafraîchir la page pour recharger les données de la candidature
              // (factures + paiements mis à jour)
              window.location.reload();
            }}
          />
        )}

        {/* Modal choix du mois de scolarité à l'admission */}
        {showAdmitModal && (
          <AdmitMoisModal
            eleveNom={`${candidature.prenom} ${candidature.nom}`}
            isPending={isPending}
            onClose={() => setShowAdmitModal(false)}
            onConfirm={(moisScolarite) => {
              setShowAdmitModal(false);
              handleStatut("ADMIS", { moisScolarite });
            }}
          />
        )}

        {/* Toggle pièces justificatives */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-3 flex items-center gap-1 text-xs text-blue-600 hover:underline"
        >
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          {t("piecesJustificatives")}
          {localDocs.length > 0 && (
            <span className="ml-1 text-muted-foreground">({localDocs.length})</span>
          )}
        </button>

        {/* Section pièces justificatives expandable */}
        {expanded && (
          <div className="mt-3 pt-3 border-t">
            <PiecesJustificativesUploader
              documents={localDocs}
              onChange={setLocalDocs}
            />
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="text-xs h-7"
                disabled={isPending}
                onClick={handleSaveDocuments}
              >
                {isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : t("saveDocuments")}
              </Button>
            </div>
          </div>
        )}

        {/* Actions */}
        {actions.length > 0 && (
          <div className="mt-3 flex gap-2 flex-wrap">
            {actions.map((a) => (
              <Button
                key={a.statut}
                size="sm"
                variant={a.variant === "destructive" ? "destructive" : "outline"}
                className="text-xs h-7"
                disabled={isPending || a.disabled}
                onClick={() => {
                  if (a.disabled) return;
                  // L'admission génère la facture → on demande d'abord le mois
                  // de scolarité à facturer.
                  if (a.statut === "ADMIS") setShowAdmitModal(true);
                  else handleStatut(a.statut);
                }}
              >
                {isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : a.label}
              </Button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Modal choix du mois de scolarité (admission) ─────────────────────────────

function AdmitMoisModal({
  eleveNom,
  isPending,
  onClose,
  onConfirm,
}: {
  eleveNom: string;
  isPending: boolean;
  onClose: () => void;
  onConfirm: (moisScolarite: string) => void;
}) {
  const t = useTranslations("admissions");
  // Options figées au montage (les 12 mois de l'année scolaire en cours).
  const options = useMemo(() => optionsMoisScolarite(), []);
  const [mois, setMois] = useState(() => moisScolariteDefaut());

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-md border-0 shadow-2xl">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <CheckCircle2 className="w-5 h-5 text-green-600" />
            {t("admitTitle")}
          </CardTitle>
          <p className="text-xs text-muted-foreground">{eleveNom}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{t("admitInvoiceHint")}</p>
          <div className="space-y-1.5">
            <Label className="text-xs">{t("tuitionMonth")}</Label>
            <select
              value={mois}
              onChange={(e) => setMois(e.target.value)}
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-3 pt-2">
            <Button
              type="button"
              disabled={isPending}
              onClick={() => onConfirm(mois)}
              className="flex-1 gap-2 bg-green-600 hover:bg-green-700"
            >
              {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {t("confirmAdmission")}
            </Button>
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
              {t("cancel")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Modal d'encaissement inline ──────────────────────────────────────────────

function PaiementInlineModal({
  factureId,
  factureNumero,
  montantTotal,
  totalPaye,
  devise,
  onClose,
  onPaid,
}: {
  factureId: string;
  factureNumero: string;
  montantTotal: number;
  totalPaye: number;
  devise: string;
  onClose: () => void;
  onPaid: () => void;
}) {
  const t = useTranslations("admissions");
  const tFact = useTranslations("facturation");
  const [isPending, startTransition] = useTransition();
  const restant = montantTotal - totalPaye;
  const fmt = (n: number) => new Intl.NumberFormat("fr-DJ", { style: "currency", currency: devise === "XOF" ? "DJF" : devise, maximumFractionDigits: 0 }).format(n);

  const [montant, setMontant] = useState(restant);
  const [methode, setMethode] = useState("espèces");
  const [reference, setReference] = useState("");

  function handlePaiement(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        await enregistrerPaiement(factureId, {
          montant,
          methode,
          reference: reference || undefined,
        });
        toast.success(t("paymentCollected"));
        onPaid();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("paymentError"));
      }
    });
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-md border-0 shadow-2xl">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Banknote className="w-5 h-5 text-green-600" />
            {t("collectPaymentTitle")}
          </CardTitle>
          <p className="text-xs text-muted-foreground">{factureNumero}</p>
        </CardHeader>
        <CardContent>
          {/* Résumé de la facture */}
          <div className="bg-muted/50 rounded-lg p-3 mb-4 space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{tFact("total")}</span>
              <span className="font-semibold">{fmt(montantTotal)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{t("alreadyPaid")}</span>
              <span className="font-semibold text-green-600">{fmt(totalPaye)}</span>
            </div>
            <div className="flex justify-between text-sm border-t pt-1 mt-1">
              <span className="text-muted-foreground font-medium">{t("remainingToPay")}</span>
              <span className="font-bold text-amber-600">{fmt(restant)}</span>
            </div>
          </div>

          <form onSubmit={handlePaiement} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">{t("paymentAmount")}</Label>
              <Input
                type="number"
                value={montant}
                onChange={(e) => setMontant(parseFloat(e.target.value) || 0)}
                min={0.01}
                max={restant}
                step="0.01"
                className="h-9"
                required
              />
              {montant < restant && (
                <p className="text-xs text-amber-600">{t("partialPaymentHint")}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">{t("paymentMethod")}</Label>
              <select
                value={methode}
                onChange={(e) => setMethode(e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {tFact(m.labelKey)}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">{t("paymentReference")}</Label>
              <Input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder={t("paymentReferencePlaceholder")}
                className="h-9"
              />
            </div>

            <div className="flex gap-3 pt-2">
              <Button type="submit" disabled={isPending} className="flex-1 gap-2 bg-green-600 hover:bg-green-700">
                {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Banknote className="w-4 h-4" />}
                {t("confirmPayment")}
              </Button>
              <Button type="button" variant="outline" onClick={onClose}>
                {t("cancel")}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Composant principal ──────────────────────────────────────────────────────

interface ClasseOption {
  id: string;
  nom: string;
  niveau?: string;
  siteId?: string | null;
  siteNom?: string | null;
}

interface AdmissionsViewProps {
  candidatures: Candidature[];
  userRole?: string;
  classes?: ClasseOption[];
  /** Année scolaire courante du tenant, résolue côté serveur. */
  annee?: string;
  userSiteId?: string | null;
  isTenantWide?: boolean;
}

export function AdmissionsView({ candidatures: initial, userRole, classes = [], annee, userSiteId = null, isTenantWide = false }: AdmissionsViewProps) {
  const t = useTranslations("admissions");
  const [candidatures, setCandidatures] = useState<Candidature[]>(initial);
  const [search, setSearch] = useState("");
  const [filtreStatut, setFiltreStatut] = useState<StatutCandidature | "TOUS">("TOUS");
  const [showForm, setShowForm] = useState(false);

  // Un admin tenant-wide sans site sélectionné voit toutes les classes de tous
  // les sites — c'est ambigu pour créer une candidature (la classe détermine le
  // site de l'élève). On l'invite à sélectionner un site d'abord.
  const needsSiteSelection = isTenantWide && !userSiteId;

  const stats = useMemo(() => ({
    total: candidatures.length,
    soumises: candidatures.filter((c) => c.statut === "SOUMISE").length,
    dossierComplet: candidatures.filter((c) => c.statut === "DOSSIER_COMPLET").length,
    enExamen: candidatures.filter((c) => c.statut === "EN_EXAMEN").length,
    admis: candidatures.filter((c) => c.statut === "ADMIS").length,
    inscrits: candidatures.filter((c) => c.statut === "INSCRIT").length,
    refuses: candidatures.filter((c) => c.statut === "REFUSE").length,
  }), [candidatures]);

  const filtered = useMemo(() => {
    return candidatures.filter((c) => {
      const q = search.toLowerCase();
      const matchSearch = !q ||
        `${c.nom} ${c.prenom} ${c.classeVoulue} ${c.parentPhone}`.toLowerCase().includes(q);
      const matchStatut = filtreStatut === "TOUS" || c.statut === filtreStatut;
      return matchSearch && matchStatut;
    });
  }, [candidatures, search, filtreStatut]);

  const handleCreated = (c: Candidature) => setCandidatures((prev) => [c, ...prev]);
  const handleUpdate = (updated: Candidature) =>
    setCandidatures((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));

  // Pipeline visuel (entonnoir)
  const pipelineStats = [
    { statut: "SOUMISE" as const, count: stats.soumises, icon: <ClipboardList className="w-4 h-4" /> },
    { statut: "DOSSIER_COMPLET" as const, count: stats.dossierComplet, icon: <FolderCheck className="w-4 h-4" /> },
    { statut: "EN_EXAMEN" as const, count: stats.enExamen, icon: <Clock className="w-4 h-4" /> },
    { statut: "ADMIS" as const, count: stats.admis, icon: <CheckCircle2 className="w-4 h-4" /> },
    { statut: "INSCRIT" as const, count: stats.inscrits, icon: <UserPlus className="w-4 h-4" /> },
  ];

  return (
    <div className="space-y-6">
      {showForm && (
        <CandidatureForm onClose={() => setShowForm(false)} onCreated={handleCreated} classes={classes} annee={annee} />
      )}

      {/* En-tête */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{t("title")}</h2>
          <p className="text-sm text-gray-500">{t("totalCandidatures", { count: stats.total, s: stats.total > 1 ? "s" : "" })}</p>
        </div>
        <Button onClick={() => setShowForm(true)} disabled={needsSiteSelection} className="gap-2">
          <Plus className="w-4 h-4" />
          {t("newCandidature")}
        </Button>
      </div>

      {/* Avertissement : sélectionner un site avant de créer une candidature */}
      {needsSiteSelection && (
        <div className="flex items-start gap-3 p-4 rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800">
          <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
              {t("selectSiteFirst")}
            </p>
          </div>
        </div>
      )}

      {/* Pipeline */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {pipelineStats.map((p) => {
          const cfg = STATUT_CONFIG[p.statut];
          return (
            <button
              key={p.statut}
              onClick={() => setFiltreStatut(filtreStatut === p.statut ? "TOUS" : p.statut)}
              className={cn(
                "p-4 rounded-xl border text-left transition-all",
                filtreStatut === p.statut
                  ? "border-primary shadow-sm bg-primary/5"
                  : "border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800/50 hover:border-primary/30"
              )}
            >
              <div className="flex items-center justify-between mb-2">
                <span className={cn("p-1.5 rounded-lg", cfg.color.split(" ").slice(0, 2).join(" "))}>
                  {p.icon}
                </span>
                <span className="text-2xl font-bold text-gray-900 dark:text-white">{p.count}</span>
              </div>
              <p className="text-xs font-medium text-gray-500">{t(cfg.labelKey)}</p>
            </button>
          );
        })}
      </div>

      {/* Refusés & Annulés */}
      <div className="flex gap-4 text-sm">
        <span className="text-gray-500">
          <span className="font-medium text-red-500">{stats.refuses}</span> {t("refused", { s: stats.refuses > 1 ? "s" : "" })}
        </span>
        <span className="text-gray-300">|</span>
        <span className="text-gray-500">
          <span className="font-medium text-gray-400">
            {candidatures.filter((c) => c.statut === "ANNULE").length}
          </span>{" "}
          {t("cancelled", { s: candidatures.filter((c) => c.statut === "ANNULE").length > 1 ? "s" : "" })}
        </span>
      </div>

      {/* Recherche */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <Input
          placeholder={t("searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 text-sm"
        />
      </div>

      {/* Liste */}
      {filtered.length === 0 ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="py-16 text-center">
            <ClipboardList className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">{t("noCandidatures")}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((c) => (
            <CandidatureCard key={c.id} candidature={c} onUpdate={handleUpdate} userRole={userRole} />
          ))}
        </div>
      )}
    </div>
  );
}
