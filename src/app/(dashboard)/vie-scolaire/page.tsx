import { auth } from "@/lib/auth";
import { runWithTenant, rlsBatch } from "@/lib/prisma";
import { Header } from "@/components/layout/Header";
import { VieScolaireView } from "@/components/vie-scolaire/VieScolaireView";
import { getTranslations } from "next-intl/server";
import { guardPage } from "@/lib/guard-page";
import { siteFilterForModel, mergeFilters, type SessionSiteClaims } from "@/lib/site-scope";
import { getTeacherScope, isTeacherRole } from "@/lib/teacher-classes";
import { anneeFilterForModel } from "@/lib/annee-scope";
import { getAnneeCouranteLibelle } from "@/lib/annee-scolaire";
import { unstable_cache } from "next/cache";
import type { Role } from "@prisma/client";

// Cache des données vie-scolaire — sans ce cache, chaque navigation
// ré-exécute 3 requêtes SQL + getAnneeCouranteLibelle + getTeacherScope.
// Avant: 16.6s ; avec cache: ~1s (hit suivant).
const getVieScolaireData = unstable_cache(
  async (
    tenantId: string,
    siteId: string | null,
    userId: string,
    role: Role,
    scopeHash: string,
  ) => {
    const sessionUser = { tenantId, siteId, role, id: userId } as SessionSiteClaims;
    const incFilter = siteFilterForModel("incident", sessionUser);
    const eleveFilter = siteFilterForModel("eleve", sessionUser);
    const classeFilter = siteFilterForModel("classe", sessionUser);

    // Reconstruire le scope depuis le hash (sérialisé)
    const scope = scopeHash ? JSON.parse(scopeHash) as { classeIds: string[]; isRestricted: boolean } : undefined;

    return runWithTenant(tenantId, siteId, async () => {
      const teacherClasseFilter = scope?.isRestricted && scope.classeIds.length > 0
        ? { id: { in: scope.classeIds } }
        : scope?.isRestricted
          ? { id: "__none__" as const }
          : {};

      const anneeFilter = anneeFilterForModel(
        "classe",
        await getAnneeCouranteLibelle(tenantId),
      );

      const [incidents, eleves, classes] = await rlsBatch((db) => [
         
        db.incident.findMany({
          where: {
            tenantId, ...incFilter,
            ...(scope?.isRestricted && scope.classeIds.length > 0
              ? { eleve: { classeId: { in: scope.classeIds } } }
              : scope?.isRestricted
                ? { id: "__none__" as const }
                : {}),
          },
          include: {
            eleve: { select: { id: true, nom: true, prenom: true, matricule: true, classe: { select: { nom: true } } } },
            rapportePar: { select: { name: true } },
            sanctions: true,
          },
          orderBy: { date: "desc" },
          take: 100,
        }),
         
        db.eleve.findMany({
          where: {
            tenantId, statut: "ACTIF", ...eleveFilter,
            ...(scope?.isRestricted && scope.classeIds.length > 0
              ? { classeId: { in: scope.classeIds } }
              : scope?.isRestricted
                ? { id: "__none__" as const }
                : {}),
          },
          select: { id: true, nom: true, prenom: true, matricule: true, classe: { select: { nom: true } } },
          orderBy: [{ nom: "asc" }, { prenom: "asc" }],
        }),
         
        db.classe.findMany({
          where: mergeFilters(
            { tenantId, ...teacherClasseFilter },
            classeFilter,
            anneeFilter,
          ),
          select: { id: true, nom: true },
          orderBy: { nom: "asc" },
        }),
      ]);

      return { incidents, eleves, classes };
    });
  },
  ["vie-scolaire-data"],
  { revalidate: 30, tags: ["vie-scolaire-data"] }
);

export default async function VieScolairePage() {
  const [session, t] = await Promise.all([
    auth(),
    getTranslations("vieScolaire"),
  ]);
  guardPage(session, "vie-scolaire:read");

  // Filtrer par classes de l'enseignant si applicable
  const scope = isTeacherRole(session!.user.role as Role)
    ? await getTeacherScope(session!.user.tenantId!, session!.user.id, session!.user.role as Role)
    : undefined;

  const scopeHash = scope ? JSON.stringify(scope) : "";
  const { incidents, eleves, classes } = await getVieScolaireData(
    session!.user.tenantId!,
    session!.user.siteId ?? null,
    session!.user.id,
    session!.user.role as Role,
    scopeHash,
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
        <VieScolaireView
          incidents={incidents}
          eleves={eleves}
          classes={classes}
          currentUserId={session!.user.id}
          tenantId={session!.user.tenantId!}
          userRole={session!.user.role}
        />
      </div>
    </div>
  );
}
