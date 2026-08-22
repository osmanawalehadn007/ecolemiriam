import { auth } from "@/lib/auth";
import { Header } from "@/components/layout/Header";
import { FournituresView } from "@/components/fournitures/FournituresView";
import { getTranslations } from "next-intl/server";
import { guardPage } from "@/lib/guard-page";
import prisma from "@/lib/prisma";
import { siteFilterForModel } from "@/lib/site-scope";

export const metadata = { title: "Fournitures scolaires | École Miriam" };

export default async function FournituresPage() {
  const [session, t] = await Promise.all([
    auth(),
    getTranslations("fournitures"),
  ]);
  const { tenantId, role } = guardPage(session, "fournitures:read");

  // Récupérer l'année courante du tenant
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { currentYear: true },
  });
  const currentYear = tenant?.currentYear ?? "2025-2026";

  // Récupérer les matières du tenant
  const siteFilter = siteFilterForModel("matiere", session!.user);
  const matieres = await prisma.matiere.findMany({
    where: { tenantId, ...siteFilter },
    select: { id: true, nom: true, code: true },
    orderBy: { nom: "asc" },
  });

  // Récupérer les niveaux distincts depuis les classes existantes
  const classeSiteFilter = siteFilterForModel("classe", session!.user);
  const classes = await prisma.classe.findMany({
    where: { tenantId, annee: currentYear, ...classeSiteFilter },
    select: { niveau: true },
    distinct: ["niveau"],
    orderBy: { niveau: "asc" },
  });
  const niveaux = classes.map((c) => c.niveau);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <Header
        title={t("title")}
        subtitle={t("subtitle")}
        userName={session!.user.name}
        userAvatar={session!.user.image ?? undefined}
      />
      <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
        <FournituresView
          role={role}
          tenantId={tenantId}
          currentYear={currentYear}
          matieres={matieres}
          niveaux={niveaux}
        />
      </div>
    </div>
  );
}
