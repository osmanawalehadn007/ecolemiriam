import { auth } from "@/lib/auth";
import { guardPage } from "@/lib/guard-page";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { siteFilterForModel, type SessionSiteClaims } from "@/lib/site-scope";
import { getTeacherScope, isTeacherRole } from "@/lib/teacher-classes";
import type { Role } from "@prisma/client";
import { Header } from "@/components/layout/Header";
import { AppelInterface } from "@/components/absences/AppelInterface";

async function getClasses(
  tenantId: string,
  claims: SessionSiteClaims,
  scope?: { classeIds: string[]; isRestricted: boolean }
) {
  // Pour les enseignants restreints : filtrer par scope (classeIds) SANS
  // filtre de site, car un enseignant peut enseigner dans des classes
  // situées sur des sites auxquels il n'est pas rattaché.
  const isScoped = scope?.isRestricted && scope.classeIds.length > 0;
  const scopeDenyAll = scope?.isRestricted && scope.classeIds.length === 0;

  // eslint-disable-next-line ecolemiriam/require-site-filter -- teacher scope: classeIds is the security boundary for restricted teachers, not siteId
  return prisma.classe.findMany({
    where: {
      tenantId,
      ...(isScoped || scopeDenyAll ? {} : siteFilterForModel("classe", claims)),
      ...(isScoped
        ? { id: { in: scope.classeIds } }
        : scopeDenyAll
          ? { id: "__none__" }
          : {}),
    },
    include: {
      // eslint-disable-next-line ecolemiriam/require-site-filter -- eleves filtered via classe scope (classeIds), not site
      eleves: {
        where: {
          statut: "ACTIF",
          ...(isScoped || scopeDenyAll ? {} : siteFilterForModel("eleve", claims)),
        },
        select: {
          id: true, nom: true, prenom: true,
          photoUrl: true, sexe: true, matricule: true,
        },
        orderBy: [{ nom: "asc" }, { prenom: "asc" }],
      },
    },
    orderBy: { nom: "asc" },
  });
}

export default async function AppelPage() {
  const session = await auth();
  if (!session?.user?.tenantId) redirect("/select-tenant");
  guardPage(session, "absences:write");

  // Filtrer par classes de l'enseignant si applicable
  const scope = isTeacherRole(session.user.role as Role)
    ? await getTeacherScope(session.user.tenantId!, session.user.id, session.user.role as Role)
    : undefined;

  const classes = await getClasses(session.user.tenantId, session.user, scope);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <Header
        title="Faire l'appel"
        subtitle={`${new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" }).format(new Date())}`}
        userName={session.user.name}
        userAvatar={session.user.image ?? undefined}
      />
      <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
        <AppelInterface classes={classes} tenantId={session.user.tenantId} />
      </div>
    </div>
  );
}
