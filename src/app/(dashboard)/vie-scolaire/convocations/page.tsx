import { guardPage } from "@/lib/guard-page";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { siteFilterForModel } from "@/lib/site-scope";
import { Header } from "@/components/layout/Header";
import { ConvocationForm } from "@/components/vie-scolaire/ConvocationForm";

export default async function ConvocationsPage() {
  const session = await auth();
  if (!session?.user?.tenantId) redirect("/login");
  guardPage(session, "vie-scolaire:write");


  const siteFilter = siteFilterForModel("classe", session.user);
  const [classes, tenant] = await Promise.all([
    prisma.classe.findMany({
      where: { tenantId: session.user.tenantId, ...siteFilter },
      include: {
        // Élèves d'une classe déjà bornée par le filtre de site ci-dessus.
        // eslint-disable-next-line ecolpro/require-site-filter
        eleves: {
          where: { statut: "ACTIF" },
          select: {
            id: true, nom: true, prenom: true, matricule: true,
            // eslint-disable-next-line ecolpro/require-site-filter
            parents: { include: { parent: { select: { id: true, nom: true, prenom: true, phone: true, email: true } } } },
          },
          orderBy: { nom: "asc" },
        },
      },
      orderBy: { nom: "asc" },
    }),
    prisma.tenant.findUnique({
      where: { id: session.user.tenantId },
      select: { name: true, city: true, chefEtablissement: true, currentYear: true },
    }),
  ]);

  if (!tenant) redirect("/login");

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <Header
        title="Convocation des Parents"
        subtitle="Générer et imprimer des convocations pour les parents d'élèves"
        userName={session.user.name}
        userAvatar={session.user.image ?? undefined}
      />
      <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
        <ConvocationForm classes={classes} tenant={tenant} />
      </div>
    </div>
  );
}
