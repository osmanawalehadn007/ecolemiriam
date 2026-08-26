import { auth } from "@/lib/auth";
import { guardPage } from "@/lib/guard-page";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Header } from "@/components/layout/Header";
import { TarifsManager } from "@/components/parametres/TarifsManager";
import { getTarifsForTenant } from "@/lib/actions/facturation-avancee";
import { getSitesForSettings } from "@/lib/actions/parametres";

export default async function TarifsPage() {
  const [session, t] = await Promise.all([
    auth(),
    getTranslations("parametres"),
  ]);
  if (!session?.user) redirect("/login");
  if (!session.user.tenantId) redirect("/select-tenant");
  guardPage(session, "finance:read");

  const [tarifs, sites] = await Promise.all([
    getTarifsForTenant(),
    getSitesForSettings(),
  ]);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <Header
        title={t("tarifsTitle")}
        subtitle={t("tarifsSubtitle")}
        userName={session.user.name}
        userAvatar={session.user.image ?? undefined}
      />
      <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
        <TarifsManager tarifs={tarifs} sites={sites} userRole={session.user.role} />
      </div>
    </div>
  );
}
