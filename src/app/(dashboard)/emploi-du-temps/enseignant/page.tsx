import React from "react";
import { auth } from "@/lib/auth";
import { guardPage } from "@/lib/guard-page";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { runWithTenant } from "@/lib/prisma";
import { Header } from "@/components/layout/Header";
import { EmploiEnseignantView } from "@/components/emploi-du-temps/EmploiEnseignantView";
import { siteFilterForModel, type SessionSiteClaims } from "@/lib/site-scope";
import { getTranslations } from "next-intl/server";
import { unstable_cache } from "next/cache";

// Cache de la liste des enseignants — sans ce cache, chaque navigation
// ré-exécute le findMany. Avant: ~Nms ; avec cache: ~1s (hit suivant).
const getEmploiEnseignantData = unstable_cache(
  async (
    tenantId: string,
    siteId: string | null,
    userId: string,
    role: string,
    siteIdsHash: string,
    tenantHasSites: boolean,
  ) => {
    const siteIds = siteIdsHash ? (JSON.parse(siteIdsHash) as string[]) : null;
    const sessionUser = {
      tenantId,
      siteId,
      role,
      id: userId,
      siteIds,
      tenantHasSites,
    } as SessionSiteClaims;

    return runWithTenant(tenantId, siteId, async () => {
      const enseignants = await prisma.enseignant.findMany({
        where: {
          tenantId,
          ...siteFilterForModel("enseignant", sessionUser),
        },
        include: { user: { select: { name: true } } },
        orderBy: { user: { name: "asc" } },
      });
      return enseignants;
    });
  },
  ["emploi-temps-enseignant-data"],
  { revalidate: 30, tags: ["emploi-temps-enseignant-data"] }
);

export default async function EmploiEnseignantPage() {
  const session = await auth();
  if (!session?.user?.tenantId) redirect("/select-tenant");
  guardPage(session, "emploi-du-temps:read");

  const t = await getTranslations("emploi");

  const tenantId = session.user.tenantId;
  const siteId = session.user.siteId ?? null;
  const userId = session.user.id;
  const role = session.user.role;
  const siteIds = (session.user as { siteIds?: string[] | null }).siteIds ?? null;
  const tenantHasSites = (session.user as { tenantHasSites?: boolean }).tenantHasSites ?? false;
  const siteIdsHash = siteIds ? JSON.stringify(siteIds) : "";

  const enseignants = await getEmploiEnseignantData(
    tenantId,
    siteId,
    userId,
    role,
    siteIdsHash,
    tenantHasSites,
  );

  return (
    <div className="space-y-6">
      <Header
        title={t("teacherSchedule")}
        subtitle={t("teacherScheduleDesc")}
      />
      <EmploiEnseignantView enseignants={enseignants} />
    </div>
  );
}
