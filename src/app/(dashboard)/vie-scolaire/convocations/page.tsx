import { auth } from "@/lib/auth";
import { rlsBatch } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { siteFilterForModel, mergeFilters } from "@/lib/site-scope";
import { guardPage } from "@/lib/guard-page";
import { getTeacherScope, isTeacherRole } from "@/lib/teacher-classes";
import { anneeFilterForModel } from "@/lib/annee-scope";
import { getAnneeCouranteLibelle } from "@/lib/annee-scolaire";
import type { Role } from "@prisma/client";
import { Header } from "@/components/layout/Header";
import { ConvocationForm } from "@/components/vie-scolaire/ConvocationForm";

export default async function ConvocationsPage() {
  const session = await auth();
  if (!session?.user?.tenantId) redirect("/select-tenant");

  guardPage(session, "vie-scolaire:read");

  // Filtrer par classes de l'enseignant si applicable
  const scope = isTeacherRole(session.user.role as Role)
    ? await getTeacherScope(session.user.tenantId!, session.user.id, session.user.role as Role)
    : undefined;

  const siteFilter = siteFilterForModel("classe", session.user);
  const anneeFilter = anneeFilterForModel(
    "classe",
    await getAnneeCouranteLibelle(session.user.tenantId!),
  );
  const tenantIdBatch = session.user.tenantId;
  const [classes, tenant] = await rlsBatch((db) => [
    db.classe.findMany({
      where: mergeFilters(
        { tenantId: tenantIdBatch },
        siteFilter,
        anneeFilter,
        scope?.isRestricted && scope.classeIds.length > 0
          ? { id: { in: scope.classeIds } }
          : scope?.isRestricted
            ? { id: "__none__" }
            : {},
      ),
      include: {
        // eslint-disable-next-line ecolemiriam/require-site-filter -- include filtré par le where parent (tenantId sur la table racine)
        eleves: {
          where: { statut: "ACTIF" },
          select: {
            id: true, nom: true, prenom: true, matricule: true,
            parents: { include: { parent: { select: { id: true, nom: true, prenom: true, phone: true, email: true } } } },
          },
          orderBy: { nom: "asc" },
        },
      },
      orderBy: { nom: "asc" },
    }),
    db.tenant.findUnique({
      where: { id: tenantIdBatch },
      select: { name: true, city: true, chefEtablissement: true, currentYear: true },
    }),
  ]);

  if (!tenant) redirect("/login");

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <Header
        title="Convocation des Parents"
        subtitle="Générer et imprimer des convocations pour les parents d'élèves"
        userName={session.user.name}
        userAvatar={session.user.image ?? undefined}
      />
      <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
        <ConvocationForm classes={classes} tenant={tenant} />
      </div>
    </div>
  );
}
