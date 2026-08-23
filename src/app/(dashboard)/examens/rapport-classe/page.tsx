import { auth } from "@/lib/auth";
import { guardPage } from "@/lib/guard-page";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { siteFilterForModel } from "@/lib/site-scope";
import { getTeacherScope, isTeacherRole } from "@/lib/teacher-classes";
import type { Role } from "@prisma/client";
import { Header } from "@/components/layout/Header";
import { RapportClasseTable } from "@/components/examens/RapportClasseTable";

export default async function RapportClassePage() {
  const session = await auth();
  if (!session?.user?.tenantId) redirect("/select-tenant");
  guardPage(session, "examens:read");

  // Filtrer par classes de l'enseignant si applicable
  const scope = isTeacherRole(session.user.role as Role)
    ? await getTeacherScope(session.user.tenantId!, session.user.id, session.user.role as Role)
    : undefined;

  const siteFilter = siteFilterForModel("classe", session.user);
  const [classes, periodes] = await Promise.all([
    prisma.classe.findMany({
      where: {
        tenantId: session.user.tenantId,
        ...siteFilter,
        ...(scope?.isRestricted && scope.classeIds.length > 0
          ? { id: { in: scope.classeIds } }
          : scope?.isRestricted
            ? { id: "__none__" }
            : {}),
      },
      select: { id: true, nom: true, niveau: true },
      orderBy: { nom: "asc" },
    }),
    prisma.periode.findMany({
      where: { annee: { tenantId: session.user.tenantId } },
      select: { id: true, nom: true, numero: true, isCurrent: true },
      orderBy: { numero: "asc" },
    }),
  ]);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <Header
        title="Rapport de Classe Matriciel"
        subtitle="Tableau récapitulatif des notes par classe et période"
        userName={session.user.name}
        userAvatar={session.user.image ?? undefined}
      />
      <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
        <RapportClasseTable classes={classes} periodes={periodes} />
      </div>
    </div>
  );
}
