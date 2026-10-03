import { auth } from "@/lib/auth";
import { guardPage } from "@/lib/guard-page";
import { redirect } from "next/navigation";
import { Header } from "@/components/layout/Header";
import { FactureForm } from "@/components/facturation/FactureForm";
import prisma from "@/lib/prisma";
import { siteFilterForModel, mergeFilters } from "@/lib/site-scope";
import { getAnneeCouranteLibelle } from "@/lib/annee-scolaire";
import { anneeFilterForModel } from "@/lib/annee-scope";

export default async function NouvelleFacturePage({
  searchParams,
}: {
  searchParams: Promise<{ eleveId?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.tenantId) redirect("/select-tenant");
  guardPage(session, "finance:write");

  // Année courante du tenant (table `annees_scolaires`) plutôt qu'un calcul
  // calendaire local : les deux divergent dès qu'un établissement décale sa
  // rentrée, et la grille tarifaire lue ci-dessous serait alors introuvable.
  const anneeActuelle =
    (await getAnneeCouranteLibelle(session.user.tenantId)) ??
    `${new Date().getFullYear()}-${new Date().getFullYear() + 1}`;
  const anneeFilter = anneeFilterForModel("classe", anneeActuelle);
  const siteFilter = siteFilterForModel("eleve", session.user);
  const [eleves, classes, tarifs] = await Promise.all([
    prisma.eleve.findMany({
      where: { tenantId: session.user.tenantId, ...siteFilter, statut: "ACTIF" },
      select: {
        id: true,
        nom: true,
        prenom: true,
        matricule: true,
        siteId: true,
        classe: { select: { id: true, nom: true, niveau: true, siteId: true } },
      },
      orderBy: [{ nom: "asc" }],
    }),
    prisma.classe.findMany({
      // mergeFilters : les fragments de site et d'année encapsulent tous deux
      // leur prédicat dans `AND`. Étalés dans le même objet, le second
      // écraserait le premier et le filtre de site disparaîtrait.
      where: mergeFilters(
        { tenantId: session.user.tenantId },
        siteFilterForModel("classe", session.user),
        anneeFilter,
      ),
      select: { id: true, nom: true, niveau: true },
      orderBy: { nom: "asc" },
    }),
    prisma.tarifNiveau.findMany({
      where: { tenantId: session.user.tenantId, annee: anneeActuelle, actif: true },
    }),
  ]);

  const params = await searchParams;

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <Header
        title="Nouvelle facture"
        subtitle="Créer une facture pour un élève"
        userName={session.user.name}
        userAvatar={session.user.image ?? undefined}
      />
      <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
        <FactureForm eleves={eleves} classes={classes} tarifs={tarifs} eleveIdPreselected={params.eleveId} />
      </div>
    </div>
  );
}
