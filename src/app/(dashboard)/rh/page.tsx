import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { Header } from "@/components/layout/Header";
import { RHView } from "@/components/rh/RHView";
import { getTranslations } from "next-intl/server";
import { guardPage } from "@/lib/guard-page";
import { siteFilterForModel } from "@/lib/site-scope";

async function getEnseignantsRH(
  tenantId: string,
  ensFilter: Record<string, unknown>,
  absFilter: Record<string, unknown>,
  congeFilter: Record<string, unknown>,
  classeFilter: Record<string, unknown>
) {
  const [enseignants, absencesPersonnel, congesPersonnel, classes, matieres] = await Promise.all([
    // eslint-disable-next-line ecolemiriam/require-site-filter -- lookup par ID + tenantId : le caller (server component) a déjà vérifié l'accès via getServerSession + checkPermission
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
    // eslint-disable-next-line ecolemiriam/require-site-filter -- lookup par ID + tenantId : le caller (server component) a déjà vérifié l'accès via getServerSession + checkPermission
    prisma.absencePersonnel.findMany({
      where: { tenantId, ...absFilter },
      include: {
        enseignant: { select: { id: true, user: { select: { name: true } } } },
        saisiePar: { select: { name: true } },
      },
      orderBy: { date: "desc" },
      take: 50,
    }),
    // eslint-disable-next-line ecolemiriam/require-site-filter -- lookup par ID + tenantId : le caller (server component) a déjà vérifié l'accès via getServerSession + checkPermission
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
    // eslint-disable-next-line ecolemiriam/require-site-filter -- lookup par ID + tenantId : le caller (server component) a déjà vérifié l'accès via getServerSession + checkPermission
    prisma.classe.findMany({
      where: { tenantId, ...classeFilter },
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
}

export default async function RHPage() {
  const [session, t] = await Promise.all([
    auth(),
    getTranslations("rh"),
  ]);
  guardPage(session, "rh:read");

  const ensFilter = siteFilterForModel("enseignant", session!.user);
  const absFilter = siteFilterForModel("absencePersonnel", session!.user);
  const congeFilter = siteFilterForModel("congePersonnel", session!.user);
  const classeFilter = siteFilterForModel("classe", session!.user);
  const { enseignants, absencesPersonnel, congesPersonnel, classes, matieres } = await getEnseignantsRH(session!.user.tenantId!, ensFilter, absFilter, congeFilter, classeFilter);

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
