import React from "react";
import { auth } from "@/lib/auth";
import { guardPage } from "@/lib/guard-page";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { Header } from "@/components/layout/Header";
import { EmploiEnseignantView } from "@/components/emploi-du-temps/EmploiEnseignantView";
import { siteFilterForModel } from "@/lib/site-scope";
import { getTranslations } from "next-intl/server";

export default async function EmploiEnseignantPage() {
  const session = await auth();
  if (!session?.user?.tenantId) redirect("/select-tenant");
  guardPage(session, "emploi-du-temps:read");

  const t = await getTranslations("emploi");

  const enseignants = await prisma.enseignant.findMany({
    where: {
      tenantId: session.user.tenantId,
      ...siteFilterForModel("enseignant", session.user),
    },
    include: { user: { select: { name: true } } },
    orderBy: { user: { name: "asc" } },
  });

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
