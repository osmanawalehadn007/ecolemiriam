import { guardPage } from "@/lib/guard-page";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Header } from "@/components/layout/Header";
import { FactureForm } from "@/components/facturation/FactureForm";
import prisma from "@/lib/prisma";
import { siteFilterForModel } from "@/lib/site-scope";
import { getAnneeCouranteLibelle } from "@/lib/annee-scolaire";

export default async function NouvelleFacturePage({
  searchParams,
}: {
  searchParams: Promise<{ eleveId?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.tenantId) redirect("/login");
  guardPage(session, "finance:write");

  const siteFilter = siteFilterForModel("eleve", session.user);
  const [eleves, classes] = await Promise.all([
    prisma.eleve.findMany({
      where: { tenantId: session.user.tenantId, ...siteFilter, statut: "ACTIF" },
      select: {
        id: true,
        nom: true,
        prenom: true,
        matricule: true,
        classe: { select: { id: true, nom: true } },
      },
      orderBy: [{ nom: "asc" }],
    }),
    prisma.classe.findMany({
      where: { tenantId: session.user.tenantId, ...siteFilterForModel("classe", session.user) },
      select: { id: true, nom: true },
      orderBy: { nom: "asc" },
    }),
  ]);

  const params = await searchParams;
  // Année scolaire de l'établissement : sert au libellé pré-rempli des frais
  // d'inscription/renouvellement (le tarif, lui, est résolu côté serveur).
  const annee = await getAnneeCouranteLibelle(session.user.tenantId);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <Header
        title="Nouvelle facture"
        subtitle="Créer une facture pour un élève"
        userName={session.user.name}
        userAvatar={session.user.image ?? undefined}
      />
      <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
        <FactureForm
          eleves={eleves}
          classes={classes}
          eleveIdPreselected={params.eleveId}
          annee={annee ?? undefined}
        />
      </div>
    </div>
  );
}
