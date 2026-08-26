import { auth } from "@/lib/auth";
import { Header } from "@/components/layout/Header";
import { FacturationActions } from "@/components/facturation/FacturationActions";
import { FacturesViewToggleClient } from "@/components/facturation/FacturesViewToggleClient";
import { getFacturesForTenant } from "@/lib/actions/facture";
import { getTranslations } from "next-intl/server";
import { guardPage } from "@/lib/guard-page";

export default async function FacturationPage() {
  const [session, t] = await Promise.all([
    auth(),
    getTranslations("facturation"),
  ]);
  guardPage(session, "finance:read");

  const factures = await getFacturesForTenant();

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <Header
        title={t("title")}
        subtitle={t("subtitle")}
        userName={session!.user.name}
        userAvatar={session!.user.image ?? undefined}
      />
      <div className="flex-1 overflow-y-auto p-6 scrollbar-thin space-y-4">
        <FacturationActions currentYear="2025-2026" userRole={session!.user.role} />
        <FacturesViewToggleClient factures={factures} userRole={session!.user.role} />
      </div>
    </div>
  );
}
