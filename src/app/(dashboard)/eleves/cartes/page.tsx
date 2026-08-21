import { auth } from "@/lib/auth";
import { guardPage } from "@/lib/guard-page";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { siteFilterForModel } from "@/lib/site-scope";
import { getTeacherScope, isTeacherRole } from "@/lib/teacher-classes";
import type { Role } from "@prisma/client";
import { Header } from "@/components/layout/Header";
import { CartesScolairesForm } from "@/components/eleves/CartesScolairesForm";

export default async function CartesScolairesPage() {
  const session = await auth();
  if (!session?.user?.tenantId) redirect("/login");
  guardPage(session, "eleves:read");

  // Filtrer par classes de l'enseignant si applicable
  const scope = isTeacherRole(session.user.role as Role)
    ? await getTeacherScope(session.user.tenantId!, session.user.id, session.user.role as Role)
    : undefined;

  const siteFilter = siteFilterForModel("classe", session.user);
  const classes = await prisma.classe.findMany({
    where: {
      tenantId: session.user.tenantId,
      ...siteFilter,
      ...(scope?.isRestricted && scope.classeIds.length > 0
        ? { id: { in: scope.classeIds } }
        : scope?.isRestricted
          ? { id: "__none__" }
          : {}),
    },
    select: {
      id: true, nom: true, niveau: true,
      eleves: {
        where: { statut: "ACTIF" },
        select: { id: true, nom: true, prenom: true, matricule: true, dateNaissance: true, photoUrl: true },
        orderBy: { prenom: "asc" },
      },
    },
    orderBy: { nom: "asc" },
  });

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <Header
        title="Cartes Scolaires"
        subtitle="Générer et imprimer les cartes scolaires des élèves"
        userName={session.user.name}
        userAvatar={session.user.image ?? undefined}
      />
      <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
        <CartesScolairesForm classes={classes} />
      </div>
    </div>
  );
}
