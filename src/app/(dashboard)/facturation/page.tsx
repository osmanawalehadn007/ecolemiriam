import { auth } from "@/lib/auth";
import { Header } from "@/components/layout/Header";
import { FacturationActions } from "@/components/facturation/FacturationActions";
import { FacturesViewToggleClient } from "@/components/facturation/FacturesViewToggleClient";
import { getFacturesForTenant } from "@/lib/actions/facture";
import { getTranslations } from "next-intl/server";
import { guardPage } from "@/lib/guard-page";
import { getAnneeCouranteLibelle } from "@/lib/annee-scolaire";
import prisma from "@/lib/prisma";
import { mergeFilters, siteFilterForModel } from "@/lib/site-scope";
import { anneeFilterForModel } from "@/lib/annee-scope";

export default async function FacturationPage() {
  const [session, t] = await Promise.all([
    auth(),
    getTranslations("facturation"),
  ]);
  guardPage(session, "finance:read");

  const factures = await getFacturesForTenant();
  // Année réelle du tenant : le libellé était écrit en dur (« 2025-2026 »),
  // il désignait donc une année révolue depuis la rentrée.
  const anneeCourante =
    (await getAnneeCouranteLibelle(session!.user.tenantId!)) ??
    `${new Date().getFullYear()}-${new Date().getFullYear() + 1}`;

  // Les options cantine / transport ne facturent que ce que la grille déclare.
  // On le dit AVANT que l'opérateur coche : une option cochée sans montant
  // n'ajoute rien, et c'est exactement le genre de silence qu'on veut éviter.
  const tarifsGrille = await prisma.tarifNiveau.findMany({
    where: mergeFilters(
      { tenantId: session!.user.tenantId! },
      siteFilterForModel("tarifNiveau", session!.user),
      anneeFilterForModel("tarifNiveau", anneeCourante),
    ),
    select: { fraisCantine: true, fraisTransport: true, actif: true },
  });
  const optionsDisponibles = {
    cantine: tarifsGrille.some((tarif) => tarif.actif && tarif.fraisCantine != null),
    transport: tarifsGrille.some((tarif) => tarif.actif && tarif.fraisTransport != null),
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <Header
        title={t("title")}
        subtitle={t("subtitle")}
        userName={session!.user.name}
        userAvatar={session!.user.image ?? undefined}
      />
      <div className="flex-1 overflow-y-auto p-6 scrollbar-thin space-y-4">
        <FacturationActions
          currentYear={anneeCourante}
          userRole={session!.user.role}
          optionsDisponibles={optionsDisponibles}
        />
        <FacturesViewToggleClient factures={factures} userRole={session!.user.role} />
      </div>
    </div>
  );
}
