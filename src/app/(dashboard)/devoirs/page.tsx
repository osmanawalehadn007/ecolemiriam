import { auth } from "@/lib/auth";
import { guardPage } from "@/lib/guard-page";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { runWithTenant } from "@/lib/prisma";
import { Header } from "@/components/layout/Header";
import { DevoirsView } from "@/components/devoirs/DevoirsView";
import { getTeacherScope, isTeacherRole } from "@/lib/teacher-classes";
import { siteFilterForModel, mergeFilters, type SessionSiteClaims } from "@/lib/site-scope";
import { anneeFilterForModel } from "@/lib/annee-scope";
import { getAnneeCouranteLibelle } from "@/lib/annee-scolaire";
import { unstable_cache } from "next/cache";
import type { Role } from "@prisma/client";

export const metadata = { title: "Devoirs et rendus — École Miriam" };

// Cache des devoirs — sans ce cache, chaque navigation ré-exécute
// getTeacherScope + getAnneeCouranteLibelle + 1 requête findMany.
// Avant: 11.7s ; avec cache: ~1s (hit suivant).
const getDevoirsData = unstable_cache(
  async (
    tenantId: string,
    siteId: string | null,
    userId: string,
    role: Role,
    scopeHash: string,
  ) => {
    const sessionUser = { tenantId, siteId, role, id: userId } as SessionSiteClaims;
    const scope = scopeHash ? JSON.parse(scopeHash) as { classeIds: string[]; isRestricted: boolean } : undefined;
    const isScoped = scope?.isRestricted && scope.classeIds.length > 0;
    const scopeDenyAll = scope?.isRestricted && scope.classeIds.length === 0;

    return runWithTenant(tenantId, siteId, async () => {
      const devoirs = await prisma.devoir.findMany({
        where: mergeFilters(
          { tenantId },
          isScoped || scopeDenyAll ? {} : siteFilterForModel("devoir", sessionUser),
          anneeFilterForModel("devoir", await getAnneeCouranteLibelle(tenantId)),
          isScoped
            ? { classeId: { in: scope.classeIds } }
            : scopeDenyAll
              ? { id: "__none__" }
              : {},
        ),
        include: {
          classe: { select: { nom: true, niveau: true } },
          matiere: { select: { nom: true } },
          seance: { select: { date: true } },
          donnePar: { select: { name: true } },
        },
        orderBy: { dateRemise: "asc" },
        take: 50,
      });
      return devoirs;
    });
  },
  ["devoirs-data"],
  { revalidate: 30, tags: ["devoirs-data"] }
);

export default async function DevoirsPage() {
  const session = await auth();
  if (!session?.user?.tenantId) redirect("/select-tenant");
  guardPage(session, "cahier-texte:read");

  const { tenantId, id: userId, role } = session.user;
  const scope = isTeacherRole(role as Role)
    ? await getTeacherScope(tenantId, userId, role as Role)
    : undefined;

  const scopeHash = scope ? JSON.stringify(scope) : "";
  const devoirs = await getDevoirsData(
    tenantId,
    session.user.siteId ?? null,
    userId,
    role as Role,
    scopeHash,
  );

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <Header
        title="Devoirs et rendus"
        subtitle="Travaux donnés et suivi des remises"
        userName={session.user.name}
        userAvatar={session.user.image ?? undefined}
      />
      <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
        <DevoirsView devoirs={devoirs} userRole={session.user.role} />
      </div>
    </div>
  );
}
