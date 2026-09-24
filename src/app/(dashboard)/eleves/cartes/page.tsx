import { guardPage } from "@/lib/guard-page";
import { auth } from "@/lib/auth";
import { guardPage } from "@/lib/guard-page";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { runWithTenant } from "@/lib/prisma";
import { siteFilterForModel, mergeFilters, type SessionSiteClaims } from "@/lib/site-scope";
import { anneeFilterForModel } from "@/lib/annee-scope";
import { getAnneeCouranteLibelle } from "@/lib/annee-scolaire";
import { getTeacherScope, isTeacherRole } from "@/lib/teacher-classes";
import type { Role } from "@prisma/client";
import { Header } from "@/components/layout/Header";
import { CartesScolairesForm } from "@/components/eleves/CartesScolairesForm";
import { unstable_cache } from "next/cache";

// Cache des classes pour les cartes scolaires — sans ce cache, chaque
// navigation ré-exécute getTeacherScope + getAnneeCouranteLibelle + 1 requête findMany.
const getElevesCartesData = unstable_cache(
  async (
    tenantId: string,
    siteId: string | null,
    role: Role,
    scopeHash: string,
  ) => {
    const sessionUser = { tenantId, siteId, role } as SessionSiteClaims;
    const scope = scopeHash ? JSON.parse(scopeHash) as { classeIds: string[]; isRestricted: boolean } : undefined;
    const isScoped = scope?.isRestricted && scope.classeIds.length > 0;
    const scopeDenyAll = scope?.isRestricted && scope.classeIds.length === 0;

    return runWithTenant(tenantId, siteId, async () => {
      const siteFilter = siteFilterForModel("classe", sessionUser);
      const anneeFilter = anneeFilterForModel(
        "classe",
        await getAnneeCouranteLibelle(tenantId),
      );
      // eslint-disable-next-line ecolemiriam/require-site-filter -- siteFilter est appliqué conditionnellement via mergeFilters selon le scope enseignant
      const classes = await prisma.classe.findMany({
        where: mergeFilters(
          { tenantId },
          isScoped || scopeDenyAll ? {} : siteFilter,
          anneeFilter,
          isScoped
            ? { id: { in: scope.classeIds } }
            : scopeDenyAll
              ? { id: "__none__" }
              : {},
        ),
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
      return classes;
    });
  },
  ["eleves-cartes-data"],
  { revalidate: 30, tags: ["eleves-cartes-data"] }
);

export default async function CartesScolairesPage() {
  const session = await auth();
  if (!session?.user?.tenantId) redirect("/select-tenant");
  if (!session?.user?.tenantId) redirect("/login");
  guardPage(session, "eleves:read");

  // Filtrer par classes de l'enseignant si applicable
  const { tenantId, id: userId, role } = session.user;
  const scope = isTeacherRole(role as Role)
    ? await getTeacherScope(tenantId, userId, role as Role)
    : undefined;

  const scopeHash = scope ? JSON.stringify(scope) : "";
  const classes = await getElevesCartesData(
    tenantId,
    session.user.siteId ?? null,
    role as Role,
    scopeHash,
  );

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
