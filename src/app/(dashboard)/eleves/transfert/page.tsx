import { auth } from "@/lib/auth";
import { guardPage } from "@/lib/guard-page";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { runWithTenant } from "@/lib/prisma";
import { siteFilterForModel, mergeFilters, type SessionSiteClaims } from "@/lib/site-scope";
import { anneeFilterForModel } from "@/lib/annee-scope";
import { getAnneeCouranteLibelle } from "@/lib/annee-scolaire";
import { Header } from "@/components/layout/Header";
import { TransfertClasseForm } from "@/components/eleves/TransfertClasseForm";
import { unstable_cache } from "next/cache";
import type { Role } from "@prisma/client";

// Cache des classes pour le transfert — sans ce cache, chaque navigation
// ré-exécute getAnneeCouranteLibelle + 1 requête findMany.
const getElevesTransfertData = unstable_cache(
  async (tenantId: string, siteId: string | null, role: Role) => {
    const sessionUser = { tenantId, siteId, role } as SessionSiteClaims;

    return runWithTenant(tenantId, siteId, async () => {
      const siteFilter = siteFilterForModel("classe", sessionUser);
      // Un transfert vise toujours une classe de l'année en cours : proposer les
      // classes des années révolues y déplacerait des élèves hors de leur cursus.
      const anneeFilter = anneeFilterForModel(
        "classe",
        await getAnneeCouranteLibelle(tenantId),
      );
      const classes = await prisma.classe.findMany({
        where: mergeFilters({ tenantId }, siteFilter, anneeFilter),
        select: {
          id: true, nom: true, niveau: true,
          eleves: {
            where: { statut: "ACTIF" },
            select: { id: true, nom: true, prenom: true, matricule: true },
            orderBy: { prenom: "asc" },
          },
        },
        orderBy: { nom: "asc" },
      });
      return classes;
    });
  },
  ["eleves-transfert-data"],
  { revalidate: 30, tags: ["eleves-transfert-data"] }
);

export default async function TransfertClassePage() {
  const session = await auth();
  if (!session?.user?.tenantId) redirect("/select-tenant");
  guardPage(session, "eleves:write");

  const { tenantId, role } = session.user;
  const classes = await getElevesTransfertData(
    tenantId,
    session.user.siteId ?? null,
    role as Role,
  );

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <Header
        title="Changement de Classe"
        subtitle="Transfert d'élèves entre classes en masse"
        userName={session.user.name}
        userAvatar={session.user.image ?? undefined}
      />
      <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
        <TransfertClasseForm classes={classes} />
      </div>
    </div>
  );
}
