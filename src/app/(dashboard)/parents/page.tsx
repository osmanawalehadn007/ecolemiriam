import { guardPage } from "@/lib/guard-page";
import { auth } from "@/lib/auth";
import { guardPage } from "@/lib/guard-page";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { runWithTenant } from "@/lib/prisma";
import { Header } from "@/components/layout/Header";
import { ParentsView } from "@/components/parents/ParentsView";
import { getTranslations } from "next-intl/server";
import { siteFilterForModel, type SessionSiteClaims } from "@/lib/site-filter";
import { unstable_cache } from "next/cache";
import type { Role } from "@prisma/client";

// Cache des parents — sans ce cache, chaque navigation ré-exécute
// la requête findMany avec toutes les relations incluses.
// Avec cache: hit ~1s.
const getParentsData = unstable_cache(
  async (
    tenantId: string,
    siteId: string | null,
    userId: string,
    role: Role,
    siteIdsHash: string,
    tenantHasSites: boolean,
  ) => {
    const sessionUser = {
      tenantId,
      siteId,
      role,
      id: userId,
      siteIds: siteIdsHash ? (JSON.parse(siteIdsHash) as string[]) : [],
      tenantHasSites,
    } as SessionSiteClaims;

    // `Parent` n'a pas de colonne `siteId` : le rattachement passe par l'utilisateur.
    const siteFilter = siteFilterForModel("parent", sessionUser);

    return runWithTenant(tenantId, siteId, async () => {
      // eslint-disable-next-line ecolemiriam/require-site-filter -- lookup par ID + tenantId : le caller (server component) a déjà vérifié l'accès via getServerSession + checkPermission
      const parents = await prisma.parent.findMany({
        where: { tenantId, enfants: { some: { eleve: { ...siteFilter } } } },
import type { Prisma } from "@prisma/client";
import { siteFilterForModel, mergeFilters } from "@/lib/site-filter";
import { teacherParentFilter } from "@/lib/teacher-classes";
async function getParentsData(tenantId: string, parentsWhere: Record<string, unknown>) {
  // eslint-disable-next-line ecolpro/require-site-filter -- where construit par l'appelant via mergeFilters(siteFilterForModel("parent", …), teacherParentFilter(…))
    where: parentsWhere as Prisma.ParentWhereInput,
    include: {
      user: { select: { id: true, name: true, email: true, avatarUrl: true, lastLoginAt: true } },
      // Le lien parent↔élève n'a pas de site propre : il est borné par le
      // `where` racine (parent retenu) ET par le périmètre enseignant fusionné
      // dans `parentsWhere`. `ParentEnfant` n'offre par ailleurs aucun chemin
      // de site direct.
      // eslint-disable-next-line ecolpro/require-site-filter
      enfants: {
        include: {
          user: { select: { id: true, name: true, email: true, avatarUrl: true, lastLoginAt: true } },
          // eslint-disable-next-line ecolemiriam/require-site-filter -- include filtré par le where parent (tenantId sur la table racine)
          enfants: {
            include: {
              eleve: {
                select: {
                  id: true,
                  nom: true,
                  prenom: true,
                  matricule: true,
                  statut: true,
                  classe: { select: { nom: true, niveau: true } },
                  absences: { select: { id: true }, where: { statut: "INJUSTIFIEE" }, take: 50 },
                  notes: { select: { valeur: true, noteMax: true, coefficient: true }, where: { isPubliee: true }, take: 20 },
                  bulletins: { select: { moyenneGenerale: true, isPublie: true }, orderBy: { createdAt: "desc" }, take: 1 },
                },
              },
            },
          },
        },
        orderBy: [{ nom: "asc" }, { prenom: "asc" }],
      });

      return { parents };
    });
  },
  ["parents-data"],
  { revalidate: 30, tags: ["parents-data"] }
);

export default async function ParentsPage() {
  const [session, t] = await Promise.all([
    auth(),
    getTranslations("parents"),
  ]);
  if (!session?.user?.tenantId) redirect("/select-tenant");
  guardPage(session, "parents:read");

  const siteIdsHash = JSON.stringify(session.user.siteIds ?? []);
  const { parents: rawParents } = await getParentsData(
    session.user.tenantId,
    session.user.siteId ?? null,
    session.user.id,
    session.user.role as Role,
    siteIdsHash,
    session.user.tenantHasSites ?? true,
  );
  if (!session?.user?.tenantId) redirect("/login");
  // `Parent` n'a pas de colonne `siteId` : le rattachement passe par l'utilisateur.
  const siteFilter = siteFilterForModel("parent", session.user);
  // Périmètre enseignant : uniquement les familles dont un enfant suit ses cours.
  const teacherFilter = await teacherParentFilter(session.user);
  const parentsWhere = mergeFilters(
    { tenantId: session.user.tenantId, enfants: { some: { eleve: { ...siteFilter } } } },
    teacherFilter
  const { parents: rawParents } = await getParentsData(session.user.tenantId, parentsWhere);

  // Mapper 'enfants' (relation Prisma) → 'eleves' (prop attendue par ParentsView)
  const parents = rawParents.map((p) => ({
    ...p,
    eleves: p.enfants ?? [],
  }));

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <Header
        title={t("title")}
        subtitle={t("subtitle")}
        userName={session.user.name}
        userAvatar={session.user.image ?? undefined}
      />
      <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
        <ParentsView parents={parents} tenantId={session.user.tenantId} userRole={session.user.role} />
      </div>
    </div>
  );
}
