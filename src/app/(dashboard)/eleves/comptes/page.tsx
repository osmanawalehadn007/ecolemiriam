import { auth } from "@/lib/auth";
import { guardPage } from "@/lib/guard-page";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { runWithTenant } from "@/lib/prisma";
import { siteFilterForModel, mergeFilters, type SessionSiteClaims } from "@/lib/site-scope";
import { anneeFilterForModel } from "@/lib/annee-scope";
import { getAnneeCouranteLibelle } from "@/lib/annee-scolaire";
import { Header } from "@/components/layout/Header";
import { GenerationComptesForm } from "@/components/eleves/GenerationComptesForm";
import { unstable_cache } from "next/cache";
import type { Role } from "@prisma/client";

// Cache des classes pour la génération de comptes — sans ce cache, chaque
// navigation ré-exécute getAnneeCouranteLibelle + 1 requête findMany.
const getElevesComptesData = unstable_cache(
  async (tenantId: string, siteId: string | null, role: Role) => {
    const sessionUser = { tenantId, siteId, role } as SessionSiteClaims;

    return runWithTenant(tenantId, siteId, async () => {
      const siteFilter = siteFilterForModel("classe", sessionUser);
      const anneeFilter = anneeFilterForModel(
        "classe",
        await getAnneeCouranteLibelle(tenantId),
      );
      const classes = await prisma.classe.findMany({
        where: mergeFilters({ tenantId }, siteFilter, anneeFilter),
        select: { id: true, nom: true, niveau: true },
        orderBy: { nom: "asc" },
      });
      return classes;
    });
  },
  ["eleves-comptes-data"],
  { revalidate: 30, tags: ["eleves-comptes-data"] }
);

export default async function ComptesElevesPage() {
  const session = await auth();
  if (!session?.user?.tenantId) redirect("/select-tenant");
  guardPage(session, "eleves:write");

  const { tenantId, role } = session.user;
  const classes = await getElevesComptesData(
    tenantId,
    session.user.siteId ?? null,
    role as Role,
  );

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <Header
        title="Comptes Élèves"
        subtitle="Génération en masse de comptes utilisateurs pour les élèves"
        userName={session.user.name}
        userAvatar={session.user.image ?? undefined}
      />
      <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
        <GenerationComptesForm classes={classes} />
      </div>
    </div>
  );
}
