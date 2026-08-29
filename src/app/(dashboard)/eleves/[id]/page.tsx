import { auth } from "@/lib/auth";
import { guardPage } from "@/lib/guard-page";
import { redirect, notFound } from "next/navigation";
import prisma, { runWithTenant } from "@/lib/prisma";
import { siteFilterForModel, eleveScopeFilter, type SessionSiteClaims } from "@/lib/site-scope";
import { getTeacherScope, isTeacherRole } from "@/lib/teacher-classes";
import type { Role } from "@prisma/client";
import { Header } from "@/components/layout/Header";
import { EleveDetailView } from "@/components/eleves/EleveDetailView";
import { getSituationFinanciere, checkEleveAccess } from "@/lib/financial-guard";
import { unstable_cache } from "next/cache";

// Cache du détail élève — sans ce cache, chaque navigation ré-exécute
// findFirst eleve (avec toutes ses relations) + matieres + dispenses +
// situation financière. Avec cache: hit ~1s.
const getEleveDetailData = unstable_cache(
  async (
    id: string,
    tenantId: string,
    siteId: string | null,
    role: string,
    userId: string,
    scopeHash: string,
    siteIdsHash: string,
    tenantHasSites: boolean,
  ) => {
    const sessionUser = {
      tenantId,
      siteId,
      role,
      id: userId,
      siteIds: siteIdsHash ? JSON.parse(siteIdsHash) as string[] : [],
      tenantHasSites,
    } as SessionSiteClaims & {
      userId?: string;
      id?: string;
    };
    const eleveFilter = eleveScopeFilter(sessionUser, null);
    const matiereFilter = siteFilterForModel("matiere", sessionUser);
    const dispenseFilter = siteFilterForModel("dispenseMatiere", sessionUser);

    return runWithTenant(tenantId, siteId, async () => {
      const eleve = await prisma.eleve.findFirst({
        where: { id, tenantId, ...eleveFilter },
        // Toutes les relations ci-dessous pendent d'une fiche élève unique, déjà
        // bornée par `tenantId` et par le site au `where` racine : si cette fiche
        // n'est pas visible, la requête ne renvoie rien du tout. Refiltrer chaque
        // relation par site serait au mieux redondant, au pire faux — le dossier
        // d'un élève muté suit l'élève et non le site où la pièce a été produite.
        include: {
          classe: { select: { id: true, nom: true, niveau: true } },
          // Le lien élève↔parent n'a pas de site propre : c'est la filiation qui
          // le borne, et un parent peut avoir des enfants sur plusieurs sites.
          // eslint-disable-next-line ecolemiriam/require-site-filter
          parents: {
            include: {
              parent: {
                select: {
                  id: true,
                  nom: true,
                  prenom: true,
                  phone: true,
                  phone2: true,
                  email: true,
                  profession: true,
                  adresse: true,
                },
              },
            },
          },
          // Scolarité de cet élève : ces modèles n'ont pas de `siteId` propre,
          // leur rattachement au site passe justement par l'élève déjà filtré.
          // eslint-disable-next-line ecolemiriam/require-site-filter
          notes: {
            include: {
              matiere: { select: { nom: true, code: true, couleur: true, coefficient: true } },
              periode: { select: { nom: true, numero: true } },
            },
            orderBy: { date: "desc" },
            take: 30,
          },
          // eslint-disable-next-line ecolemiriam/require-site-filter
          absences: {
            orderBy: { date: "desc" },
            take: 20,
          },
          // eslint-disable-next-line ecolemiriam/require-site-filter
          incidents: {
            include: { sanctions: true },
            orderBy: { date: "desc" },
            take: 10,
          },
          // La facture porte un `siteId`, mais celui du site émetteur : filtrer
          // ici ferait disparaître du dossier les impayés contractés avant une
          // mutation, alors que c'est précisément ce qu'on vient consulter.
          // eslint-disable-next-line ecolemiriam/require-site-filter
          factures: {
            include: { paiements: true },
            orderBy: { createdAt: "desc" },
            take: 10,
          },
          // Le parcours scolaire retrace les années passées, y compris sur un
          // autre site du même établissement : le borner au site actuel le viderait.
          // eslint-disable-next-line ecolemiriam/require-site-filter
          parcours: {
            orderBy: { annee: "desc" },
          },
        },
      });

      if (!eleve) return null;

      // Matières (pour le sélecteur de dispense) + dispenses existantes de l'élève
      // + situation financière — tout dans le même contexte RLS.
      const [matieres, dispensesRaw, situationFinanciere] = await Promise.all([
        prisma.matiere.findMany({
          where: { tenantId, ...matiereFilter },
          select: { id: true, nom: true, code: true },
          orderBy: { nom: "asc" },
        }),
        prisma.dispenseMatiere.findMany({
          where: { tenantId, eleveId: id, ...dispenseFilter },
          include: { matiere: { select: { nom: true } } },
          orderBy: { createdAt: "desc" },
        }),
        getSituationFinanciere(id, tenantId),
      ]);

      return { eleve, matieres, dispensesRaw, situationFinanciere };
    });
  },
  ["eleve-detail-data"],
  { revalidate: 30, tags: ["eleve-detail-data"] }
);

export default async function EleveDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.tenantId) redirect("/select-tenant");
  guardPage(session, "eleves:read");

  const { id } = await params;
  const { tenantId, id: userId, role, siteId } = session.user;

  // Pour les enseignants : vérifier que l'élève est dans une de leurs classes
  // (garde non cachée — doit s'exécuter à chaque navigation)
  const scope = isTeacherRole(role as Role)
    ? await getTeacherScope(tenantId!, userId, role as Role)
    : undefined;

  if (scope?.isRestricted) {
    // eleveScopeFilter combine le filtrage par site ET le périmètre personnel
    // (lien familial pour PARENT, userId pour STUDENT). Sans cela, un parent
    // pourrait consulter le dossier de n'importe quel élève du tenant.
    const eleveFilter = eleveScopeFilter(session.user, null);
    const eleveCheck = await runWithTenant(tenantId, siteId ?? null, async () => {
      return prisma.eleve.findFirst({
        where: { id, tenantId, ...eleveFilter },
        select: { id: true, classeId: true },
      });
    });
    if (!eleveCheck || !scope.classeIds.includes(eleveCheck.classeId ?? "")) {
      notFound();
    }
  }

  const scopeHash = scope ? JSON.stringify(scope) : "";
  const data = await getEleveDetailData(
    id,
    tenantId!,
    siteId ?? null,
    role,
    userId,
    scopeHash,
    JSON.stringify(session.user.siteIds ?? []),
    session.user.tenantHasSites ?? true,
  );

  if (!data?.eleve) notFound();

  // Blocage financier : si l'élève est exclu, rediriger les parents/élèves
  // (garde non cachée — doit s'exécuter à chaque navigation)
  if (role === "PARENT" || role === "STUDENT") {
    const access = await runWithTenant(tenantId, siteId ?? null, async () => {
      return checkEleveAccess(id, tenantId, {
        userId,
        role,
      });
    });
    if (!access.allowed) {
      redirect("/acces-bloque");
    }
  }

  const dispenses = data.dispensesRaw.map((d) => ({
    id: d.id,
    matiereId: d.matiereId,
    matiereNom: d.matiere.nom,
    motif: d.motif,
  }));

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <Header
        title={`${data.eleve.prenom} ${data.eleve.nom}`}
        subtitle={`${data.eleve.matricule} · ${data.eleve.classe?.nom ?? "Classe non affectée"}`}
        userName={session.user.name}
        userAvatar={session.user.image ?? undefined}
      />
      <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
        <EleveDetailView eleve={data.eleve} matieres={data.matieres} dispenses={dispenses} situationFinanciere={data.situationFinanciere} userRole={role} />
      </div>
    </div>
  );
}
