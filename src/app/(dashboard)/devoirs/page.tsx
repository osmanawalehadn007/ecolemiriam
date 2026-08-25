import { auth } from "@/lib/auth";
import { guardPage } from "@/lib/guard-page";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { Header } from "@/components/layout/Header";
import { DevoirsView } from "@/components/devoirs/DevoirsView";
import { getTeacherScope, isTeacherRole } from "@/lib/teacher-classes";
import { siteFilterForModel } from "@/lib/site-scope";
import type { Role } from "@prisma/client";

export const metadata = { title: "Devoirs et rendus — École Miriam" };

export default async function DevoirsPage() {
  const session = await auth();
  if (!session?.user?.tenantId) redirect("/select-tenant");
  guardPage(session, "cahier-texte:read");

  const { tenantId, id: userId, role } = session.user;
  const scope = isTeacherRole(role as Role)
    ? await getTeacherScope(tenantId, userId, role as Role)
    : undefined;

  const isScoped = scope?.isRestricted && scope.classeIds.length > 0;
  const scopeDenyAll = scope?.isRestricted && scope.classeIds.length === 0;

  const devoirs = await prisma.devoir.findMany({
    where: {
      tenantId,
      ...(isScoped || scopeDenyAll ? {} : siteFilterForModel("devoir", session.user)),
      ...(isScoped
        ? { classeId: { in: scope.classeIds } }
        : scopeDenyAll
          ? { id: "__none__" }
          : {}),
    },
    include: {
      classe: { select: { nom: true, niveau: true } },
      matiere: { select: { nom: true } },
      seance: { select: { date: true } },
      donnePar: { select: { name: true } },
    },
    orderBy: { dateRemise: "asc" },
    take: 50,
  });

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <Header
        title="Devoirs et rendus"
        subtitle="Travaux donnés et suivi des remises"
        userName={session.user.name}
        userAvatar={session.user.image ?? undefined}
      />
      <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
        <DevoirsView devoirs={devoirs} />
      </div>
    </div>
  );
}
