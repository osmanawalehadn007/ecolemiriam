import { guardPage } from "@/lib/guard-page";
import React from "react";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { Header } from "@/components/layout/Header";
import { EmploiDuTempsView } from "@/components/emploi-du-temps/EmploiDuTempsView";
import { fuzzyFind } from "@/lib/text-match";
import { getTranslations } from "next-intl/server";
import { siteFilterForModel, type SessionSiteClaims } from "@/lib/site-scope";
import { getSitesForUser } from "@/lib/actions/eleve";
import { getSiteColorMap } from "@/lib/site-colors";
import { isTeacherRole, resolveTeacherScope } from "@/lib/teacher-classes";
import type { Role } from "@prisma/client";

// Les fragments d'isolation sont construits ici, au plus près des requêtes :
// passés en paramètres, ils n'étaient plus rattachables à leur origine, ni par
// un relecteur ni par l'analyse statique.
//
// Pour un enseignant, `scope` restreint en plus sur SES classes et SES
// créneaux : consulter le planning de l'établissement ne doit pas exposer le
// service de ses collègues ni les effectifs des classes voisines.
async function getEmploiData(
  tenantId: string,
  claims: SessionSiteClaims,
  scope: { classeIds: string[]; isRestricted: boolean },
  enseignantId: string | null
) {
  const restrictClasseIds = scope.isRestricted
    ? (scope.classeIds.length > 0 ? scope.classeIds : ["__ecolpro_no_teacher_scope__"])
    : null;

  const [classes, matieres, enseignants, emplois, salles, disponibilites] = await Promise.all([
    prisma.classe.findMany({
      where: {
        tenantId,
        ...siteFilterForModel("classe", claims),
        ...(restrictClasseIds && { id: { in: restrictClasseIds } }),
      },
      select: { id: true, nom: true, niveau: true },
      orderBy: { nom: "asc" },
    }),
    prisma.matiere.findMany({
      where: { tenantId, ...siteFilterForModel("matiere", claims) },
      select: { id: true, nom: true, code: true, couleur: true, coefficient: true },
      orderBy: { nom: "asc" },
    }),
    prisma.enseignant.findMany({
      where: {
        tenantId,
        ...siteFilterForModel("enseignant", claims),
        // Un enseignant ne voit que sa propre fiche dans les sélecteurs.
        ...(enseignantId && scope.isRestricted ? { id: enseignantId } : {}),
      },
      include: { user: { select: { name: true } } },
      orderBy: { user: { name: "asc" } },
    }),
    prisma.emploiTemps.findMany({
      where: {
        tenantId,
        ...siteFilterForModel("emploiTemps", claims),
        // Son planning uniquement : les créneaux des collègues ne le concernent pas.
        ...(scope.isRestricted && enseignantId ? { enseignantId } : {}),
      },
      include: {
        matiere: { select: { nom: true, code: true, couleur: true } },
        classe: { select: { nom: true } },
        enseignant: { select: { id: true, user: { select: { name: true } } } },
      },
      orderBy: [{ jour: "asc" }, { heureDebut: "asc" }],
    }),
    prisma.salle.findMany({
      where: { tenantId, ...siteFilterForModel("salle", claims) },
      select: { id: true, nom: true, capacite: true, type: true },
      orderBy: { nom: "asc" },
    }),
    prisma.disponibiliteEnseignant.findMany({
      where: {
        tenantId,
        ...siteFilterForModel("disponibiliteEnseignant", claims),
        ...(scope.isRestricted && enseignantId ? { enseignantId } : {}),
      },
      select: { id: true, enseignantId: true, jour: true, heureDebut: true, heureFin: true },
    }),
  ]);
  // flou que le moteur de génération — teacherPoolFor). Sans la spécialité,
  // une matière jamais planifiée n'offrirait aucun enseignant dans les
  // listes déroulantes. Volontairement PAS de repli sur "tous les
  // enseignants" : on ne propose jamais un prof d'une autre matière.
  const matiereToEnseignants: Record<string, { id: string; user: { name: string | null } }[]> = {};
  function addEnseignant(matiereId: string, ens: { id: string; user: { name: string | null } }) {
    if (!matiereToEnseignants[matiereId]) matiereToEnseignants[matiereId] = [];
    if (!matiereToEnseignants[matiereId].some((e) => e.id === ens.id)) {
      matiereToEnseignants[matiereId].push({ id: ens.id, user: ens.user });
    }
  }
  for (const emp of emplois) {
    if (emp.enseignantId && emp.matiereId && emp.enseignant) {
      addEnseignant(emp.matiereId, emp.enseignant);
    }
  }
  // fuzzyFind matcherait toute matière contre une spécialité vide
  // (n.includes("") est toujours vrai) — on exclut donc les profs sans spécialité.
  const enseignantsAvecSpecialite = enseignants
    .filter((e) => e.specialite && e.specialite.trim() !== "")
    .map((e) => ({ id: e.id, nom: e.specialite! }));
  for (const matiere of matieres) {
    const bySpecialite = fuzzyFind(enseignantsAvecSpecialite, matiere.nom);
    const ids = new Set(bySpecialite.map((e) => e.id));
    for (const ens of enseignants) {
      if (ids.has(ens.id)) addEnseignant(matiere.id, ens);
    }
  }

  return { classes, matieres, enseignants, emplois, matiereToEnseignants, salles, disponibilites };
}

export default async function EmploiDuTempsPage() {
  const session = await auth();
  if (!session?.user?.tenantId) redirect("/login");
  guardPage(session, "emploi-du-temps:read");

  const [t, tCommon, sites, siteColors] = await Promise.all([
    getTranslations("emploi"),
    getTranslations("common"),
    getSitesForUser(),
    getSiteColorMap(session.user.tenantId),
  ]);

  // Périmètre de l'enseignant connecté : ses classes et sa propre fiche.
  const role = session.user.role as Role;
  const teacherScope = await resolveTeacherScope(session.user);
  // Fiche de l'utilisateur connecté lui-même (userId = soi) : la requête ne
  // peut viser qu'une seule ligne, celle de la session.
  let teacherEnseignantId: string | null = null;
  if (isTeacherRole(role)) {
    // eslint-disable-next-line ecolpro/require-site-filter
    const monProfil = await prisma.enseignant.findFirst({
      where: { userId: session.user.id, tenantId: session.user.tenantId },
      select: { id: true },
    });
    teacherEnseignantId = monProfil?.id ?? null;
  }

  const { classes, matieres, enseignants, emplois, matiereToEnseignants, salles, disponibilites } = await getEmploiData(
    session.user.tenantId, session.user, teacherScope, teacherEnseignantId
  );

  const currentSiteId = (session.user as { siteId?: string | null }).siteId ?? null;
  const currentSiteName = currentSiteId
    ? (sites.find((s) => s.id === currentSiteId)?.nom ?? "Site inconnu")
    : session.user.role === "TENANT_ADMIN" || session.user.role === "SUPER_ADMIN"
      ? tCommon("allSites")
      : "Aucun site";
  const currentSiteColor = currentSiteId ? siteColors[currentSiteId] : undefined;

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <Header
        title={t("title")}
        subtitle={t("subtitle")}
        site={currentSiteName}
        siteColor={currentSiteColor}
        userName={session.user.name}
        userAvatar={session.user.image ?? undefined}
      />
      <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
        <EmploiDuTempsView
          classes={classes}
          matieres={matieres}
          enseignants={enseignants}
          emplois={emplois as unknown as React.ComponentProps<typeof EmploiDuTempsView>["emplois"]}
          matiereToEnseignants={matiereToEnseignants}
          salles={salles}
          disponibilites={disponibilites}
          tenantId={session.user.tenantId}
          readOnly={teacherScope.isRestricted}
        />
      </div>
    </div>
  );
}
