import { auth } from "@/lib/auth";
import { guardPage } from "@/lib/guard-page";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Header } from "@/components/layout/Header";
import { ParametresTabs } from "@/components/parametres/ParametresTabs";
import prisma from "@/lib/prisma";
import { runWithTenant } from "@/lib/prisma";
import { unstable_cache } from "next/cache";
import {
  siteFilterForModel,
  siteIdForCreate,
  type SessionSiteClaims,
} from "@/lib/site-scope";
import { anneeFilterForModel } from "@/lib/annee-scope";
import { ELEVE_NON_ARCHIVE } from "@/lib/eleve-filters";
import type { Role } from "@prisma/client";

// ============================================================
// Cache des données parametres — évite 10× auth() + 10× requêtes
// SQL à chaque navigation. Avant ce cache, /parametres prenait
// 27s ; avec cache → ~3s (premier hit), <1s (hit suivant).
//
// On passe le contexte (tenantId, siteId, role, userId, siteIds)
// en paramètres explicites car unstable_cache s'exécute hors
// contexte de requête → auth() ne fonctionne pas → l'extension
// RLS ne positionne pas SET LOCAL app.tenant_id.
// runWithTenant injecte ce contexte via AsyncLocalStorage.
// ============================================================

interface ParametresCacheKey {
  tenantId: string;
  siteId: string | null;
  userId: string;
  role: Role;
  siteIds: string[];
  isSiteAdmin: boolean;
}

const getParametresData = unstable_cache(
  async (key: ParametresCacheKey) => {
    const { tenantId, siteId, userId, role, isSiteAdmin } = key;

    // Construire un objet session minimal pour siteFilterForModel
    const sessionUser = {
      tenantId,
      siteId,
      siteIds: key.siteIds,
      role,
      id: userId,
    } as SessionSiteClaims;

    return runWithTenant(tenantId, siteId, async () => {
      const annee = await prisma.anneesScolaires.findFirst({
        where: { tenantId, isCurrent: true },
      });

      const [
        etablissement,
        users,
        parents,
        eleves,
        classes,
        matieres,
        regles,
        periodes,
        sites,
        annees,
      ] = await Promise.all([
        prisma.tenant.findUnique({ where: { id: tenantId } }),
        prisma.user.findMany({
          where: { tenantId, ...siteFilterForModel("user", sessionUser) },
          select: {
            id: true, name: true, email: true, emailVerified: true,
            role: true, phone: true, isActive: true, lastLoginAt: true,
            createdAt: true,
            emailLogs: {
              orderBy: { createdAt: "desc" }, take: 1,
              select: { id: true, status: true, type: true, createdAt: true, errorMessage: true },
            },
          },
          orderBy: { createdAt: "desc" },
        }),
        prisma.parent.findMany({
          where: { tenantId, ...siteFilterForModel("parent", sessionUser) },
          include: {
            enfants: {
              where: siteFilterForModel("eleveParent", sessionUser),
              include: {
                eleve: {
                  select: { id: true, nom: true, prenom: true, matricule: true, classe: { select: { nom: true } } },
                },
              },
            },
            user: { select: { id: true, email: true, isActive: true } },
          },
          orderBy: { nom: "asc" },
        }),
        prisma.eleve.findMany({
          where: { tenantId, statut: "ACTIF", ...siteFilterForModel("eleve", sessionUser) },
          select: {
            id: true, nom: true, prenom: true, matricule: true,
            classe: { select: { nom: true, niveau: true, structure: { select: { type: true } } } },
          },
          orderBy: [{ classe: { nom: "asc" } }, { nom: "asc" }, { prenom: "asc" }],
        }),
        prisma.classe.findMany({
          where: { tenantId, ...siteFilterForModel("classe", sessionUser), ...anneeFilterForModel("classe", annee?.libelle) },
          include: {
            _count: { select: { eleves: ELEVE_NON_ARCHIVE } },
            profPrincipal: { select: { user: { select: { name: true } } } },
            structure: { select: { id: true, nom: true, type: true } },
          },
          orderBy: [{ niveau: "asc" }, { nom: "asc" }],
        }),
        prisma.matiere.findMany({
          where: { tenantId, ...siteFilterForModel("matiere", sessionUser) },
          orderBy: { nom: "asc" },
        }),
        prisma.reglesAppreciation.findMany({
          where: { tenantId },
          orderBy: [{ contexte: "asc" }, { seuilMin: "asc" }],
        }),
        annee
          ? prisma.periode.findMany({ where: { anneeId: annee.id }, orderBy: { numero: "asc" } })
          : Promise.resolve([]),
        prisma.site.findMany({
          where: isSiteAdmin
            ? { tenantId, deletedAt: null }
            : { tenantId, deletedAt: null, userSites: { some: { userId } } },
          include: {
            _count: {
              select: {
                classes: true, eleves: ELEVE_NON_ARCHIVE,
                salles: true, userSites: true, factures: true,
              },
            },
          },
          orderBy: { createdAt: "asc" },
        }),
        prisma.anneesScolaires.findMany({
          where: { tenantId },
          orderBy: { dateDebut: "desc" },
        }),
      ]);

      return {
        etablissement, users, parents, eleves, classes,
        matieres, regles, periodes, sites, annees,
      };
    });
  },
  ["parametres-data"],
  { revalidate: 30, tags: ["parametres-data"] }
);

export default async function ParametresPage() {
  const [session, t] = await Promise.all([
    auth(),
    getTranslations("parametres"),
  ]);
  if (!session?.user) redirect("/login");
  if (!session.user.tenantId) {
    redirect(session.user.role === "SUPER_ADMIN" ? "/super-admin" : "/select-tenant");
  }
  guardPage(session, "parametres:read");

  const canManage = session.user.role === "TENANT_ADMIN" || session.user.role === "SUPER_ADMIN" || session.user.role === "PRINCIPAL";
  const isSiteAdmin = session.user.role === "TENANT_ADMIN" || session.user.role === "SUPER_ADMIN";

  const data = await getParametresData({
    tenantId: session.user.tenantId,
    siteId: session.user.siteId ?? null,
    userId: session.user.id,
    role: session.user.role as Role,
    siteIds: (session.user as { siteIds?: string[] }).siteIds ?? [],
    isSiteAdmin,
  });

  if (!data.etablissement) return redirect("/login");

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <Header
        title={t("title")}
        subtitle={t("subtitle")}
        userName={session.user.name}
        userAvatar={session.user.image ?? undefined}
      />
      <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
        <ParametresTabs
          etablissement={data.etablissement}
          users={data.users}
          parents={data.parents}
          eleves={data.eleves}
          classes={data.classes}
          matieres={data.matieres}
          regles={data.regles}
          periodes={data.periodes}
          sites={data.sites}
          annees={data.annees}
          canManage={canManage}
          sessionRole={session.user.role}
          sessionSiteId={siteIdForCreate(session.user) ?? undefined}
          availableTenants={session.user.availableTenants}
        />
      </div>
    </div>
  );
}
