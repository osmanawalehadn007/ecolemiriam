"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DateHeure } from "@/components/ui/DateHeure";
import { cn, demiJournee } from "@/lib/utils";
import { getPaymentMethodLabelKey } from "@/lib/payment-methods";
import { ChevronDown, Sun, Sunset } from "lucide-react";

export interface PaiementJour {
  id: string;
  montant: number;
  devise: string;
  methode: string;
  reference: string | null;
  date: string | Date;
  facture: { numero: string; eleve: { nom: string; prenom: string | null } | null };
  enregistrePar: { name: string | null } | null;
}

export interface DepenseJour {
  id: string;
  categorie: string;
  description: string | null;
  montant: number;
  devise: string;
  date: string | Date;
  createdBy: { name: string | null } | null;
}

type Moment = "matin" | "apres_midi";

// Deux codes couleur : ambre pour le matin, indigo pour l'après-midi.
const STYLES: Record<Moment, { carte: string; titre: string; entete: string; pastille: string }> = {
  matin: {
    carte: "border-amber-300 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/20",
    titre: "text-amber-800 dark:text-amber-300",
    entete: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
    pastille: "bg-amber-500",
  },
  apres_midi: {
    carte: "border-indigo-300 bg-indigo-50/60 dark:border-indigo-800 dark:bg-indigo-950/20",
    titre: "text-indigo-800 dark:text-indigo-300",
    entete: "bg-indigo-100 text-indigo-900 dark:bg-indigo-900/40 dark:text-indigo-200",
    pastille: "bg-indigo-500",
  },
};

const somme = (l: { montant: number }[]) => l.reduce((n, x) => n + x.montant, 0);

/**
 * Vue d'une journée précise : encaissements et dépenses classés en matinée
 * (avant 13 h) et après-midi (à partir de 13 h), avec un solde par demi-journée
 * au milieu et le solde de la journée.
 */
export function JourneeSection({
  paiements,
  depenses,
  currency,
  formatMontant,
}: {
  paiements: PaiementJour[];
  depenses: DepenseJour[];
  currency: string;
  formatMontant: (value: number, devise: string) => string;
}) {
  const t = useTranslations("finances");
  const tMoyen = useTranslations("facturation");
  // Les détails d'une demi-journée restent repliés : seuls les totaux sont visibles.
  const [ouvert, setOuvert] = useState<Record<Moment, boolean>>({ matin: false, apres_midi: false });

  const parMoment = (m: Moment) => ({
    paiements: paiements.filter((p) => demiJournee(p.date) === m),
    depenses: depenses.filter((d) => demiJournee(d.date) === m),
  });
  const matin = parMoment("matin");
  const apresMidi = parMoment("apres_midi");

  const total = (m: { paiements: PaiementJour[]; depenses: DepenseJour[] }) => ({
    recettes: somme(m.paiements),
    depenses: somme(m.depenses),
    solde: somme(m.paiements) - somme(m.depenses),
  });
  const tMatin = total(matin);
  const tApresMidi = total(apresMidi);
  const tJour = {
    recettes: tMatin.recettes + tApresMidi.recettes,
    depenses: tMatin.depenses + tApresMidi.depenses,
    solde: tMatin.solde + tApresMidi.solde,
  };

  const libelleMoyen = (id: string) => {
    const cle = getPaymentMethodLabelKey(id);
    return cle === "method" ? id : tMoyen(cle);
  };
  const couleurSolde = (n: number) => (n >= 0 ? "text-green-600" : "text-red-600");

  const bloc = (moment: Moment, donnees: typeof matin, totaux: typeof tMatin) => {
    const st = STYLES[moment];
    const Icone = moment === "matin" ? Sun : Sunset;
    return (
      <Card key={moment} className={cn("border-2", st.carte)} data-moment={moment}>
        <CardHeader className="p-0">
          <button
            type="button"
            aria-expanded={ouvert[moment]}
            onClick={() => setOuvert((o) => ({ ...o, [moment]: !o[moment] }))}
            className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-6 py-4 text-left"
          >
            <span className={cn("flex items-center gap-2 text-base font-semibold", st.titre)}>
              <Icone className="h-4 w-4" />
              {t(moment === "matin" ? "dayMorning" : "dayAfternoon")}
            </span>
            <span className="text-sm">
              {t("dayReceived")} <strong>{formatMontant(totaux.recettes, currency)}</strong> ({donnees.paiements.length})
            </span>
            <span className="text-sm">
              {t("daySpent")} <strong>{formatMontant(totaux.depenses, currency)}</strong> ({donnees.depenses.length})
            </span>
            <span className={cn("text-sm font-semibold", couleurSolde(totaux.solde))}>
              {t(moment === "matin" ? "dayBalanceMorning" : "dayBalanceAfternoon")} : {formatMontant(totaux.solde, currency)}
            </span>
            <span className={cn("ml-auto flex items-center gap-1 text-xs", st.titre)}>
              {t(ouvert[moment] ? "dayHideDetails" : "daySeeDetails")}
              <ChevronDown className={cn("h-4 w-4 transition-transform", ouvert[moment] && "rotate-180")} />
            </span>
          </button>
        </CardHeader>
        {ouvert[moment] && (
        <CardContent className="space-y-4 border-t pt-4">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">{t("dayReceipts")} ({donnees.paiements.length})</p>
            {donnees.paiements.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">{t("dayNoReceipts")}</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border bg-background">
                <table className="w-full text-sm">
                  <thead className={cn("text-xs", st.entete)}>
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">{t("date")}</th>
                      <th className="px-3 py-2 text-left font-medium">{t("student")}</th>
                      <th className="px-3 py-2 text-left font-medium">{t("invoice")}</th>
                      <th className="px-3 py-2 text-left font-medium">{t("method")} / {t("reference")}</th>
                      <th className="px-3 py-2 text-left font-medium">{t("recordedBy")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("amount")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {donnees.paiements.map((p) => (
                      <tr key={p.id} className="border-t">
                        <td className="px-3 py-2"><DateHeure value={p.date} /></td>
                        <td className="px-3 py-2">{p.facture.eleve ? `${p.facture.eleve.prenom ?? ""} ${p.facture.eleve.nom}`.trim() : "—"}</td>
                        <td className="px-3 py-2 text-muted-foreground">{p.facture.numero}</td>
                        <td className="px-3 py-2">
                          {libelleMoyen(p.methode)}
                          {p.reference && <span className="ml-2 font-mono text-xs text-muted-foreground">{p.reference}</span>}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{p.enregistrePar?.name ?? "—"}</td>
                        <td className="px-3 py-2 text-right font-medium whitespace-nowrap">{formatMontant(p.montant, p.devise)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div>
            <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">{t("dayExpenses")} ({donnees.depenses.length})</p>
            {donnees.depenses.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">{t("dayNoExpenses")}</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border bg-background">
                <table className="w-full text-sm">
                  <thead className={cn("text-xs", st.entete)}>
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">{t("date")}</th>
                      <th className="px-3 py-2 text-left font-medium">{t("category")}</th>
                      <th className="px-3 py-2 text-left font-medium">{t("description")}</th>
                      <th className="px-3 py-2 text-left font-medium">{t("recordedBy")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("amount")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {donnees.depenses.map((d) => (
                      <tr key={d.id} className="border-t">
                        <td className="px-3 py-2"><DateHeure value={d.date} /></td>
                        <td className="px-3 py-2">{d.categorie}</td>
                        <td className="px-3 py-2 text-muted-foreground">{d.description ?? "—"}</td>
                        <td className="px-3 py-2 text-muted-foreground">{d.createdBy?.name ?? "—"}</td>
                        <td className="px-3 py-2 text-right font-medium whitespace-nowrap text-red-600">{formatMontant(d.montant, d.devise)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </CardContent>
        )}
      </Card>
    );
  };

  const cartesSolde: { cle: string; label: string; valeur: number; style?: string; gras?: boolean }[] = [
    { cle: "matin", label: t("dayBalanceMorning"), valeur: tMatin.solde, style: STYLES.matin.carte },
    { cle: "apres_midi", label: t("dayBalanceAfternoon"), valeur: tApresMidi.solde, style: STYLES.apres_midi.carte },
    { cle: "jour", label: t("dayBalanceTotal"), valeur: tJour.solde, style: "border-slate-400 bg-slate-100 dark:bg-slate-800/60", gras: true },
  ];

  return (
    <div className="space-y-4" data-testid="journee">
      {bloc("matin", matin, tMatin)}

      {/* Soldes : un par demi-journée, puis celui de la journée */}
      <div className="grid gap-3 sm:grid-cols-3">
        {cartesSolde.map((c) => (
          <div key={c.cle} className={cn("rounded-xl border-2 px-4 py-3 text-center", c.style)} data-solde={c.cle}>
            <p className="text-xs font-medium text-muted-foreground">{c.label}</p>
            <p className={cn("mt-1 font-bold", c.gras ? "text-2xl" : "text-xl", couleurSolde(c.valeur))}>
              {formatMontant(c.valeur, currency)}
            </p>
          </div>
        ))}
      </div>

      {bloc("apres_midi", apresMidi, tApresMidi)}
    </div>
  );
}
