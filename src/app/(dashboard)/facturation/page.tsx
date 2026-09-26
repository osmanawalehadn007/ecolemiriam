import { auth } from "@/lib/auth";
import { Header } from "@/components/layout/Header";
import { FacturesTable } from "@/components/facturation/FacturesTable";
import { FacturationActions } from "@/components/facturation/FacturationActions";
import { getFacturesForTenant } from "@/lib/actions/facture";
import { getAnneeCouranteLibelle, anneeScolaireParDefaut } from "@/lib/annee-scolaire";
import { getTranslations } from "next-intl/server";
import { guardPage } from "@/lib/guard-page";

export default async function FacturationPage() {
  const [session, t] = await Promise.all([
    auth(),
    getTranslations("facturation"),
  ]);
  guardPage(session, "finance:read");

  // L'année passée au générateur de mensualités était codée en dur
  // (« 2025-2026 ») : aucune grille tarifaire de l'année en cours n'était donc
  // jamais trouvée, et la génération ignorait silencieusement tous les élèves.
  const [factures, anneeCourante] = await Promise.all([
    getFacturesForTenant(),
    getAnneeCouranteLibelle(session!.user.tenantId),
  ]);

  const stats = {
    total: factures.length,
    enAttente: factures.filter((f) => f.statut === "EN_ATTENTE").length,
    payees: factures.filter((f) => f.statut === "PAYEE").length,
    enRetard: factures.filter((f) => f.statut === "EN_RETARD").length,
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
        <FacturationActions currentYear={anneeCourante ?? anneeScolaireParDefaut()} />
        <FacturesTable factures={factures} />
      </div>
    </div>
  );
}
