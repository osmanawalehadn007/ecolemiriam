import { auth } from "@/lib/auth";
import { Header } from "@/components/layout/Header";
import { FacturationActions } from "@/components/facturation/FacturationActions";
import { FacturesViewToggleClient } from "@/components/facturation/FacturesViewToggleClient";
import { getFacturesForTenant } from "@/lib/actions/facture";
import { getTranslations } from "next-intl/server";
import { guardPage } from "@/lib/guard-page";
import { getAnneeCouranteLibelle } from "@/lib/annee-scolaire";

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

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <Header
        title={t("title")}
        subtitle={t("subtitle")}
        userName={session!.user.name}
        userAvatar={session!.user.image ?? undefined}
      />
      <div className="flex-1 overflow-y-auto p-6 scrollbar-thin space-y-4">
        <FacturationActions currentYear={anneeCourante} userRole={session!.user.role} />
        <FacturesViewToggleClient factures={factures} userRole={session!.user.role} />
      </div>
    </div>
  );
}
