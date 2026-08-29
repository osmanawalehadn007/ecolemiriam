import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { guardPage } from "@/lib/guard-page";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Header } from "@/components/layout/Header";
import { TarifsManager } from "@/components/parametres/TarifsManager";
import { getTarifsForTenant } from "@/lib/actions/facturation-avancee";
import { getSitesForSettings } from "@/lib/actions/parametres";
import { getAnneeCouranteLibelle } from "@/lib/annee-scolaire";
import { siteFilterForModel } from "@/lib/site-scope";

export default async function TarifsPage() {
  const [session, t] = await Promise.all([
    auth(),
    getTranslations("parametres"),
  ]);
  if (!session?.user) redirect("/login");
  if (!session.user.tenantId) redirect("/select-tenant");
  guardPage(session, "finance:read");

  const tenantId = session.user.tenantId;

  const siteFilter = siteFilterForModel("classe", session.user);

  // Résolue avant la requête : les niveaux tarifés sont ceux des classes de
  // l'année en cours, pas ceux d'une année révolue.
  const anneeCourante = await getAnneeCouranteLibelle(tenantId);

  const [tarifs, sites, classes] = await Promise.all([
    getTarifsForTenant(),
    getSitesForSettings(),
    prisma.classe.findMany({
      where: { tenantId, ...siteFilter, ...(anneeCourante ? { annee: anneeCourante } : {}) },
      select: { id: true, nom: true, niveau: true, siteId: true },
      orderBy: [{ niveau: "asc" }, { nom: "asc" }],
    }),
  ]);

  // Année par défaut : année courante du système, sinon année calendaire
  const anneeDefaut = anneeCourante ?? `${new Date().getFullYear()}-${new Date().getFullYear() + 1}`;

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <Header
        title={t("tarifsTitle")}
        subtitle={t("tarifsSubtitle")}
        userName={session.user.name}
        userAvatar={session.user.image ?? undefined}
      />
      <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
        <TarifsManager
          tarifs={tarifs}
          sites={sites}
          userRole={session.user.role}
          classes={classes}
          anneeCourante={anneeDefaut}
        />
      </div>
    </div>
  );
}
