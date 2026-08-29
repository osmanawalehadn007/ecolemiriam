import { auth } from "@/lib/auth";
import { guardPage } from "@/lib/guard-page";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { siteFilterForModel, mergeFilters } from "@/lib/site-scope";
import { anneeFilterForModel } from "@/lib/annee-scope";
import { getAnneeCouranteLibelle } from "@/lib/annee-scolaire";
import { Header } from "@/components/layout/Header";
import { GenerationComptesForm } from "@/components/eleves/GenerationComptesForm";

export default async function ComptesElevesPage() {
  const session = await auth();
  if (!session?.user?.tenantId) redirect("/select-tenant");
  guardPage(session, "eleves:write");


  const siteFilter = siteFilterForModel("classe", session.user);
  const anneeFilter = anneeFilterForModel(
    "classe",
    await getAnneeCouranteLibelle(session.user.tenantId),
  );
  const classes = await prisma.classe.findMany({
    where: mergeFilters({ tenantId: session.user.tenantId }, siteFilter, anneeFilter),
    select: { id: true, nom: true, niveau: true },
    orderBy: { nom: "asc" },
  });

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
