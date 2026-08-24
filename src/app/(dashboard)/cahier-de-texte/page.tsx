import { auth } from "@/lib/auth";
import { guardPage } from "@/lib/guard-page";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { Header } from "@/components/layout/Header";
import { CahierTextView } from "@/components/cahier-texte/CahierTextView";
import { getTranslations } from "next-intl/server";
import { roleHasPermission } from "@/lib/rbac";
import { siteFilterForModel } from "@/lib/site-scope";
import { getTeacherScope, isTeacherRole } from "@/lib/teacher-classes";
import type { Role } from "@prisma/client";

export const metadata = { title: "Cahier de texte — École Miriam" };

export default async function CahierTextePage() {
  const session = await auth();
  if (!session?.user?.tenantId) redirect("/select-tenant");
  const { tenantId, role } = guardPage(session, "cahier-texte:read");

  const [t, siteFilter] = await Promise.all([
    getTranslations("cahierTexte"),
    Promise.resolve(siteFilterForModel("cahierTexte", session.user)),
  ]);

  // Filtrer par classes de l'enseignant si applicable
  const scope = isTeacherRole(role as Role)
    ? await getTeacherScope(tenantId, session.user.id, role as Role)
    : undefined;

  const teacherClasseFilter = scope?.isRestricted && scope.classeIds.length > 0
    ? { classeId: { in: scope.classeIds } }
    : scope?.isRestricted
      ? { id: "__none__" as const }
      : {};

  // Pour les enseignants restreints : filtrer les entrées par classeId
  // (scope) SANS filtre de site, car un enseignant peut enseigner dans
  // des classes situées sur des sites auxquels il n'est pas rattaché.
  // Le scope (classeIds) est la sécurité, pas le site.
  const entryWhere = scope?.isRestricted && scope.classeIds.length > 0
    ? { tenantId, ...teacherClasseFilter }
    : scope?.isRestricted
      ? { tenantId, id: "__none__" as const }
      : { tenantId, ...siteFilter };

  const [entries, classes, matieres, enseignants] = await Promise.all([
    prisma.cahierTexte.findMany({
      where: entryWhere,
      include: {
        classe: { select: { nom: true, niveau: true } },
        matiere: { select: { nom: true, code: true } },
        enseignant: {
          select: { id: true, specialite: true, user: { select: { name: true } } },
        },
        saisiePar: { select: { name: true } },
        commentaires: {
          include: { auteur: { select: { name: true, role: true } } },
          orderBy: { createdAt: "asc" },
        },
        devoirsLiees: {
          select: {
            id: true,
            description: true,
            type: true,
            dateRemise: true,
            statut: true,
          },
          orderBy: { dateRemise: "asc" },
        },
      },
      orderBy: { date: "desc" },
      take: 100,
    }),
    // eslint-disable-next-line ecolemiriam/require-site-filter -- lookup par ID + tenantId : le caller (server component) a déjà vérifié l'accès via getServerSession + checkPermission
    prisma.classe.findMany({
      where: {
        tenantId,
        ...(scope?.isRestricted && scope.classeIds.length > 0
          ? { id: { in: scope.classeIds } }
          : scope?.isRestricted
            ? { id: "__none__" }
            : {}),
      },
      select: { id: true, nom: true, niveau: true },
      orderBy: { nom: "asc" },
    }),
    // eslint-disable-next-line ecolemiriam/require-site-filter -- lookup par ID + tenantId : le caller (server component) a déjà vérifié l'accès via getServerSession + checkPermission
    prisma.matiere.findMany({
      where: {
        tenantId,
        ...(scope?.isRestricted && scope.matiereIds.length > 0
          ? { id: { in: scope.matiereIds } }
          : {}),
      },
      select: { id: true, nom: true, code: true },
      orderBy: { nom: "asc" },
    }),
    // eslint-disable-next-line ecolemiriam/require-site-filter -- lookup par ID + tenantId : le caller (server component) a déjà vérifié l'accès via getServerSession + checkPermission
    prisma.enseignant.findMany({
      where: { tenantId },
      select: { id: true, specialite: true, user: { select: { name: true } } },
      orderBy: { user: { name: "asc" } },
    }),
  ]);

  const canWrite = roleHasPermission(role as Role, "cahier-texte:write");
  const canDelete = roleHasPermission(role as Role, "cahier-texte:delete");
  // Tout rôle avec cahier-texte:read peut commenter (COUNSELOR, PRINCIPAL, etc.)
  const canComment = roleHasPermission(role as Role, "cahier-texte:read");

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <Header
        title={t("title")}
        subtitle={t("subtitle")}
        userName={session.user.name}
        userAvatar={session.user.image ?? undefined}
      />
      <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
        <CahierTextView
          classes={classes}
          matieres={matieres}
          enseignants={enseignants}
          initialEntries={entries.map((e) => ({
            ...e,
            date: e.date.toISOString(),
            fichiers: e.fichiers as unknown as { nom: string; type: string; taille: number; dataUrl: string }[] | null,
            contenuStructure: (e.contenuStructure as unknown as import("@/components/cahier-texte/ContenuStructureEditor").ContenuStructure | null) ?? null,
            commentaires: (e.commentaires ?? []).map((c) => ({
              ...c,
              createdAt: c.createdAt.toISOString(),
            })),
            devoirsLiees: (e.devoirsLiees ?? []).map((d) => ({
              ...d,
              dateRemise: d.dateRemise.toISOString(),
            })),
          }))}
          canWrite={canWrite}
          canDelete={canDelete}
          canComment={canComment}
          currentUserId={session.user.id}
          currentUserRole={role}
        />
      </div>
    </div>
  );
}
