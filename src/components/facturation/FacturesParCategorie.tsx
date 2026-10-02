"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, List } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FacturesTable } from "./FacturesTable";
import {
  grouperFactures,
  type CategorieFacture,
  type CompteurFactures,
} from "@/lib/facturation/categories";

type FactureItem = Awaited<ReturnType<typeof import("@/lib/actions/facture").getFacturesForTenant>>[number];

const CLE_CATEGORIE: Record<CategorieFacture, string> = {
  MATERNELLE: "categoryMaternelle",
  PRIMAIRE: "categoryPrimaire",
  COLLEGE: "categoryCollege",
  LYCEE: "categoryLycee",
  ADMISSION: "categoryAdmission",
  AUTRE: "categoryOther",
};

/** Carré arrondi : factures payées (vert) / restant à payer (rouge). */
function Compteur({ compteur }: { compteur: CompteurFactures }) {
  const t = useTranslations("facturation");
  return (
    <div
      className="mt-3 flex items-center justify-center gap-2 rounded-xl border bg-muted/40 px-4 py-3"
      title={`${compteur.payees} ${t("kpiPaid")} / ${compteur.impayees} ${t("kpiUnpaid")}`}
    >
      <span className="text-3xl font-bold tabular-nums text-green-600">{compteur.payees}</span>
      <span className="text-2xl font-bold text-muted-foreground">/</span>
      <span className="text-3xl font-bold tabular-nums text-red-600">{compteur.impayees}</span>
    </div>
  );
}

function CarteGroupe({
  titre,
  sousTitre,
  compteur,
  onClick,
}: {
  titre: string;
  sousTitre: string;
  compteur: CompteurFactures;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl border bg-card p-4 text-left shadow-sm transition-all hover:border-primary hover:shadow-md"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">{titre}</span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </div>
      <p className="text-xs text-muted-foreground">{sousTitre}</p>
      <Compteur compteur={compteur} />
    </button>
  );
}

export function FacturesParCategorie({ factures }: { factures: FactureItem[] }) {
  const t = useTranslations("facturation");
  const groupes = useMemo(() => grouperFactures(factures), [factures]);
  const [categorie, setCategorie] = useState<CategorieFacture | null>(null);
  const [classe, setClasse] = useState<string | null>(null);
  const [toutes, setToutes] = useState(false);

  const groupe = groupes.find((g) => g.categorie === categorie) ?? null;
  const groupeClasse = groupe?.classes.find((c) => c.classe === classe) ?? null;

  if (toutes) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" className="gap-1" onClick={() => setToutes(false)}>
          <ChevronLeft className="h-4 w-4" />
          {t("backToCategories")}
        </Button>
        <FacturesTable factures={factures} />
      </div>
    );
  }

  const legende = (
    <p className="text-xs text-muted-foreground">
      <span className="font-semibold text-green-600">{t("kpiPaid")}</span>
      {" / "}
      <span className="font-semibold text-red-600">{t("kpiUnpaid")}</span>
    </p>
  );

  // Niveau 3 : factures d'une classe
  if (groupe && groupeClasse) {
    return (
      <div className="space-y-4">
        <nav className="flex items-center gap-1 text-sm">
          <Button variant="ghost" size="sm" className="gap-1" onClick={() => { setCategorie(null); setClasse(null); }}>
            <ChevronLeft className="h-4 w-4" />
            {t("allCategories")}
          </Button>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
          <Button variant="ghost" size="sm" onClick={() => setClasse(null)}>
            {t(CLE_CATEGORIE[groupe.categorie])}
          </Button>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
          <span className="px-2 font-medium">{groupeClasse.classe}</span>
        </nav>
        <FacturesTable factures={groupeClasse.factures} />
      </div>
    );
  }

  // Niveau 2 : classes d'une catégorie
  if (groupe) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <nav className="flex items-center gap-1 text-sm">
            <Button variant="ghost" size="sm" className="gap-1" onClick={() => setCategorie(null)}>
              <ChevronLeft className="h-4 w-4" />
              {t("allCategories")}
            </Button>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
            <span className="px-2 font-medium">{t(CLE_CATEGORIE[groupe.categorie])}</span>
          </nav>
          {legende}
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {groupe.classes.map((c) => (
            <CarteGroupe
              key={c.classe}
              titre={c.classe}
              sousTitre={t("invoiceCount", { count: c.factures.length })}
              compteur={c.compteur}
              onClick={() => setClasse(c.classe)}
            />
          ))}
        </div>
      </div>
    );
  }

  // Niveau 1 : catégories présentes dans l'établissement
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {legende}
        <Button variant="outline" size="sm" className="gap-2" onClick={() => setToutes(true)}>
          <List className="h-4 w-4" />
          {t("showAllInvoices", { count: factures.length })}
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {groupes.map((g) => (
          <CarteGroupe
            key={g.categorie}
            titre={t(CLE_CATEGORIE[g.categorie])}
            sousTitre={t("classAndInvoiceCount", { classes: g.classes.length, count: g.factures.length })}
            compteur={g.compteur}
            onClick={() => setCategorie(g.categorie)}
          />
        ))}
      </div>
    </div>
  );
}
