import { auth } from "@/lib/auth";
import { rlsBatch } from "@/lib/prisma";
import { guardPage } from "@/lib/guard-page";
import { redirect } from "next/navigation";
import { siteFilterForModel, mergeFilters } from "@/lib/site-scope";
import { anneeFilterForModel } from "@/lib/annee-scope";
import { getAnneeCouranteLibelle } from "@/lib/annee-scolaire";
import { getTeacherScope, isTeacherRole } from "@/lib/teacher-classes";
import type { Role } from "@prisma/client";
import { Header } from "@/components/layout/Header";
import { AttestationForm } from "@/components/eleves/AttestationForm";

export default async function AttestationsPage() {
  const session = await auth();
  if (!session?.user?.tenantId) redirect("/select-tenant");
  guardPage(session, "eleves:read");

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
          select: { id: true, nom: true, prenom: true, matricule: true, sexe: true, dateNaissance: true },
          orderBy: { prenom: "asc" },
        },
      },
      orderBy: { nom: "asc" },
    }),
    db.tenant.findUnique({
      where: { id: tenantIdBatch },
      select: {
        name: true, city: true, country: true, phone: true, email: true,
        address: true, logoUrl: true, chefEtablissement: true,
        signatureUrl: true, cachetUrl: true, currentYear: true,
      },
    }),
  ]);

  if (!tenant) redirect("/login");

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <Header
        title="Attestations de Scolarité"
        subtitle="Générer et imprimer des attestations et certificats"
        userName={session.user.name}
        userAvatar={session.user.image ?? undefined}
      />
      <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
        <AttestationForm classes={classes} tenant={tenant} />
      </div>
    </div>
  );
}
