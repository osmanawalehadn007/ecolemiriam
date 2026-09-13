import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { runWithTenant } from "@/lib/prisma";
import { Header } from "@/components/layout/Header";
import { RHView } from "@/components/rh/RHView";
import { getTranslations } from "next-intl/server";
import { guardPage } from "@/lib/guard-page";
import { siteFilterForModel, mergeFilters, type SessionSiteClaims } from "@/lib/site-scope";
import { anneeFilterForModel } from "@/lib/annee-scope";
import { getAnneeCouranteLibelle } from "@/lib/annee-scolaire";
import { unstable_cache } from "next/cache";
import type { Role } from "@prisma/client";

// Cache des données RH — sans ce cache, chaque navigation ré-exécute
// 5 requêtes prisma en parallèle (enseignants, absences, congés, classes, matières).
const getEnseignantsRH = unstable_cache(
  async (tenantId: string, siteId: string | null, role: Role) => {
    const sessionUser = { tenantId, siteId, role } as SessionSiteClaims;
    const ensFilter = siteFilterForModel("enseignant", sessionUser);
    const absFilter = siteFilterForModel("absencePersonnel", sessionUser);
    const congeFilter = siteFilterForModel("congePersonnel", sessionUser);
    const classeFilter = siteFilterForModel("classe", sessionUser);

    return runWithTenant(tenantId, siteId, async () => {
      const [enseignants, absencesPersonnel, congesPersonnel, classes, matieres] = await Promise.all([
         
        prisma.enseignant.findMany({
          where: { tenantId, ...ensFilter },
          include: {
            user: {
              select: {
                id: true, name: true, email: true, avatarUrl: true,
                phone: true, isActive: true, lastLoginAt: true,
              },
            },
            ficheRH: {
              include: {
                // eslint-disable-next-line ecolemiriam/require-site-filter -- include filtré par le where parent (tenantId sur la table racine)
                bulletinsPaie: {
                  orderBy: [{ annee: "desc" }, { mois: "desc" }],
                  take: 3,
                },
              },
            },
            // eslint-disable-next-line ecolemiriam/require-site-filter -- include filtré par le where parent (tenantId sur la table racine)
            emploiTemps: {
              select: {
                jour: true, heureDebut: true, heureFin: true,
                matiere: { select: { nom: true, couleur: true } },
                classe: { select: { nom: true } },
              },
            },
            // eslint-disable-next-line ecolemiriam/require-site-filter -- include filtré par le where parent (tenantId sur la table racine)
            classesPrincipales: {
              select: { id: true, nom: true, niveau: true },
            },
            affectations: {
              include: {
                classe: { select: { id: true, nom: true, niveau: true } },
                matiere: { select: { id: true, nom: true, code: true } },
              },
            },
          },
          orderBy: { user: { name: "asc" } },
        }),
         
        prisma.absencePersonnel.findMany({
          where: { tenantId, ...absFilter },
          include: {
            enseignant: { select: { id: true, user: { select: { name: true } } } },
            saisiePar: { select: { name: true } },
          },
          orderBy: { date: "desc" },
          take: 50,
        }),
         
        prisma.congePersonnel.findMany({
          where: { tenantId, ...congeFilter },
          include: {
            enseignant: { select: { id: true, user: { select: { name: true } } } },
            demandePar: { select: { name: true } },
            approuvePar: { select: { name: true } },
          },
          orderBy: { createdAt: "desc" },
          take: 50,
        }),
        // Classes pour le dialog d'affectation
         
        prisma.classe.findMany({
          where: mergeFilters(
            { tenantId },
            classeFilter,
            anneeFilterForModel("classe", await getAnneeCouranteLibelle(tenantId)),
          ),
          select: { id: true, nom: true, niveau: true, siteId: true },
          orderBy: { nom: "asc" },
        }),
        // Matières pour le dialog d'affectation
        // eslint-disable-next-line ecolemiriam/require-site-filter -- lookup par ID + tenantId : le caller (server component) a déjà vérifié l'accès via getServerSession + checkPermission
        prisma.matiere.findMany({
          where: { tenantId },
          select: { id: true, nom: true, code: true },
          orderBy: { nom: "asc" },
        }),
      ]);

      return { enseignants, absencesPersonnel, congesPersonnel, classes, matieres };
    });
  },
  ["rh-data"],
  { revalidate: 30, tags: ["rh-data"] }
);

export default async function RHPage() {
  const [session, t] = await Promise.all([
    auth(),
    getTranslations("rh"),
  ]);
  guardPage(session, "rh:read");

  const { enseignants, absencesPersonnel, congesPersonnel, classes, matieres } = await getEnseignantsRH(
    session!.user.tenantId!,
    session!.user.siteId ?? null,
    session!.user.role as Role,
  );

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <Header
        title={t("title")}
        subtitle={t("subtitle")}
        userName={session!.user.name}
        userAvatar={session!.user.image ?? undefined}
      />
      <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
        <RHView
          enseignants={enseignants}
          absencesPersonnel={absencesPersonnel}
          congesPersonnel={congesPersonnel}
          classes={classes}
          matieres={matieres}
          canManageAffectations={["SUPER_ADMIN", "TENANT_ADMIN", "PRINCIPAL", "ACCOUNTANT"].includes(session!.user.role)}
          userRole={session!.user.role}
        />
      </div>
    </div>
  );
}
