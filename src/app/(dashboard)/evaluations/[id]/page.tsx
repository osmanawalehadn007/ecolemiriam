import { auth } from "@/lib/auth";
import { guardPage } from "@/lib/guard-page";
import { redirect } from "next/navigation";
import prisma, { runWithTenant } from "@/lib/prisma";
import { siteFilterForRelation, type SessionSiteClaims } from "@/lib/site-filter";
import { getTeacherScope, isTeacherRole } from "@/lib/teacher-classes";
import type { Role } from "@prisma/client";
import Link from "next/link";
import { ArrowLeft, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GrilleSaisie } from "@/components/evaluations/GrilleSaisie";
import { unstable_cache } from "next/cache";

// Cache du détail d'une évaluation — sans ce cache, chaque navigation
// ré-exécute getTeacherScope + 2 requêtes prisma (evalCheck + evaluation).
// Le paramètre `evaluationId` fait partie de la clé de cache.
const getEvaluationDetailData = unstable_cache(
  async (
    evaluationId: string,
    tenantId: string,
    siteId: string | null,
    scopeHash: string,
    claimsHash: string,
  ) => {
    const claims = JSON.parse(claimsHash) as SessionSiteClaims;
    const scope = scopeHash
      ? (JSON.parse(scopeHash) as { classeIds: string[]; matiereIds: string[]; isRestricted: boolean })
      : null;
    const siteFilter = siteFilterForRelation(claims, "classe");

    return runWithTenant(tenantId, siteId, async () => {
      // Pour les enseignants restreints : vérifier que l'évaluation porte sur
      // une de leurs classes
      let evalCheck: { classeId: string; matiereId: string } | null = null;
      if (scope?.isRestricted) {
        // eslint-disable-next-line ecolemiriam/require-site-filter, ecolemiriam/require-annee-filter -- lookup par id : l'évaluation porte son année via sa classe
        evalCheck = await prisma.evaluation.findFirst({
          where: { id: evaluationId, tenantId },
          select: { classeId: true, matiereId: true },
        });
      }

      // eslint-disable-next-line ecolemiriam/require-annee-filter -- lookup par id : l'évaluation porte son année via sa classe
      const evaluation = await prisma.evaluation.findFirst({
        where: { id: evaluationId, tenantId, ...siteFilter },
        include: {
          // eslint-disable-next-line ecolemiriam/require-site-filter -- include filtré par le where parent (tenantId sur la table racine)
          classe: { include: { eleves: { orderBy: { nom: 'asc' } } } },
          matiere: true,
          notes: true,
        }
      });

      return { evalCheck, evaluation };
    });
  },
  ["evaluation-detail-data"],
  { revalidate: 30, tags: ["evaluation-detail-data"] }
);

export default async function SaisieNotesPage({
  params
}: {
  params: Promise<{ id: string }>
}) {
  const session = await auth();
  if (!session?.user?.tenantId) redirect("/select-tenant");
  guardPage(session, "evaluations:read");

  const { id: evaluationId } = await params;

  // Construire les claims pour le filtre par site (sérialisées pour le cache)
  const claims: SessionSiteClaims = {
    role: session.user.role,
    siteId: session.user.siteId ?? null,
    siteIds: (session.user as { siteIds?: string[] | null }).siteIds ?? null,
    tenantHasSites: (session.user as { tenantHasSites?: boolean }).tenantHasSites ?? false,
  };
  const claimsHash = JSON.stringify(claims);

  // Pour les enseignants : vérifier que l'évaluation porte sur une de leurs classes
  const scope = isTeacherRole(session.user.role as Role)
    ? await getTeacherScope(session.user.tenantId!, session.user.id, session.user.role as Role)
    : null;
  const scopeHash = scope ? JSON.stringify(scope) : "";

  const { evalCheck, evaluation } = await getEvaluationDetailData(
    evaluationId,
    session.user.tenantId,
    session.user.siteId ?? null,
    scopeHash,
    claimsHash,
  );

  // Redirect pour enseignant restreint non autorisé
  if (scope?.isRestricted) {
    if (!evalCheck || !scope.classeIds.includes(evalCheck.classeId)) {
      redirect("/evaluations");
    }
  }

  if (!evaluation) {
    redirect("/evaluations");
  }

  const grille = evaluation.classe.eleves.map(eleve => {
    const existingNote = evaluation.notes.find(n => n.eleveId === eleve.id);
    return {
      eleveId: eleve.id,
      matricule: eleve.matricule,
      nom: eleve.nom,
      prenom: eleve.prenom,
      noteId: existingNote?.id ?? null,
      valeur: existingNote?.valeur ?? null,
      commentaire: existingNote?.commentaire ?? "",
    };
  });

  return (
    <div className="p-6 bg-gray-50 min-h-full">
      {/* Top Header */}
      <div className="flex justify-between items-center bg-gray-100 p-4 rounded-xl border border-gray-200">
        <div className="flex items-center gap-3">
          <StarIcon />
          <h1 className="text-xl font-bold text-gray-800">
            Gestion des notes - {evaluation.titre}
          </h1>
        </div>
        <div className="flex gap-2">
          <Link href="/evaluations">
            <Button className="bg-orange-500 hover:bg-orange-600 text-white gap-2 shadow-sm border-none">
              <ArrowLeft className="h-4 w-4" />
              Retour à l&apos;examen
            </Button>
          </Link>
          <Button className="bg-green-600 hover:bg-green-700 text-white gap-2 shadow-sm border-none">
            <FileSpreadsheet className="h-4 w-4" />
            Excel
          </Button>
        </div>
      </div>
      <p className="text-sm text-gray-500 mt-2 ml-1">
        Saisie et consultation des notes pour l&apos;examen &quot;{evaluation.titre}&quot; de la classe {evaluation.classe.nom} en {evaluation.matiere.nom.toUpperCase()}.
      </p>

      {/* Grid */}
      <GrilleSaisie evaluation={evaluation} initialGrille={grille} />
    </div>
  );
}

function StarIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 text-gray-700">
      <path fillRule="evenodd" d="M10.788 3.21c.448-1.077 1.976-1.077 2.424 0l2.082 5.007 5.404.433c1.164.093 1.636 1.545.749 2.305l-4.117 3.527 1.257 5.273c.271 1.136-.964 2.033-1.96 1.425L12 18.354 7.373 21.18c-.996.608-2.231-.29-1.96-1.425l1.257-5.273-4.117-3.527c-.887-.76-.415-2.212.749-2.305l5.404-.433 2.082-5.006z" clipRule="evenodd" />
    </svg>
  );
}
