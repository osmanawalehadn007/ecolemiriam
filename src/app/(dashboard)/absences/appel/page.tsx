import { guardStaff } from "@/lib/guard-page";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { siteFilterForModel, type SessionSiteClaims } from "@/lib/site-scope";
import { Header } from "@/components/layout/Header";
import { AppelInterface } from "@/components/absences/AppelInterface";
import { getTeacherScope, isTeacherRole } from "@/lib/teacher-classes";

async function getClasses(
  tenantId: string,
  claims: SessionSiteClaims,
  scope?: { classeIds: string[]; isRestricted: boolean }
) {
  // Restriction enseignant : seules SES classes (celles de son emploi du temps
  // et/ou dont il est prof principal) sont proposées à l'appel.
  const teacherClasseFilter =
    scope?.isRestricted && scope.classeIds.length > 0
      ? { id: { in: scope.classeIds } }
      : scope?.isRestricted
        ? { id: "__none__" }
        : {};

  return prisma.classe.findMany({
    where: { tenantId, ...siteFilterForModel("classe", claims), ...teacherClasseFilter },
    include: {
      eleves: {
        where: { statut: "ACTIF", ...siteFilterForModel("eleve", claims) },
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
  if (!session?.user?.tenantId) redirect("/login");
  guardStaff(session, "absences:read");

  const scope = isTeacherRole(session.user.role)
    ? await getTeacherScope(session.user.tenantId, session.user.id, session.user.role)
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
