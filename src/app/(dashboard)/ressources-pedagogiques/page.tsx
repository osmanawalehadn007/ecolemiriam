import { auth } from "@/lib/auth";
import { guardPage } from "@/lib/guard-page";
import { redirect } from "next/navigation";
import { Header } from "@/components/layout/Header";
import { CoursView } from "@/components/cours/CoursView";
import { SiteTabs } from "@/components/sites/SiteTabs";
import { getTranslations } from "next-intl/server";
import { getSitesForUserCached } from "@/lib/sites-cached";
import { getSiteColorMap } from "@/lib/site-colors";

export const metadata = { title: "Ressources pédagogiques — École Miriam" };

export default async function RessourcesPedagogiquesPage({
  searchParams,
}: {
  searchParams: Promise<{ siteId?: string }>;
}) {
  const [session, t, tCommon, sp] = await Promise.all([
    auth(),
    getTranslations("cours"),
    getTranslations("common"),
    searchParams,
  ]);

  if (!session?.user?.tenantId) redirect("/select-tenant");
  guardPage(session, "cours:read");

  const tenantId = session.user.tenantId;
  const sessionSiteId = (session.user as { siteId?: string | null }).siteId ?? null;
  const { siteId } = sp;

  const isTenantAdmin =
    session.user.role === "TENANT_ADMIN" || session.user.role === "SUPER_ADMIN";

  const [sites, siteColors] = await Promise.all([
    getSitesForUserCached(tenantId, session.user.id, isTenantAdmin),
    getSiteColorMap(tenantId),
  ]);

  const activeSite = (() => {
    if (!siteId) return sessionSiteId ? sessionSiteId : "all";
    if (siteId === "all") {
      if (sessionSiteId) return sessionSiteId;
      return isTenantAdmin ? "all" : (sessionSiteId ?? "all");
    }
    return sites.some((s) => s.id === siteId) ? siteId : (sessionSiteId ?? "all");
  })();

  const currentSiteName =
    activeSite === "all"
      ? tCommon("allSites")
      : (sites.find((s) => s.id === activeSite)?.nom ?? "Site inconnu");

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <Header
        title="Ressources pédagogiques"
        subtitle={t("subtitle")}
        site={currentSiteName}
        userName={session.user.name}
        userAvatar={session.user.image ?? undefined}
      />
      <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin">
        <SiteTabs
          sites={sites.map((s) => ({ id: s.id, nom: s.nom }))}
          siteColors={siteColors}
          activeSiteId={activeSite}
          className="mb-2"
        />
        <CoursView siteColors={siteColors} activeSite={activeSite} />
      </div>
    </div>
  );
}
