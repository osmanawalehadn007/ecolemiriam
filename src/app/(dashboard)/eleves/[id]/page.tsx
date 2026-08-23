import { auth } from "@/lib/auth";
import { guardPage } from "@/lib/guard-page";
import { redirect, notFound } from "next/navigation";
import prisma from "@/lib/prisma";
import { siteFilterForModel, eleveScopeFilter } from "@/lib/site-scope";
import { getTeacherScope, isTeacherRole } from "@/lib/teacher-classes";
import type { Role } from "@prisma/client";
import { Header } from "@/components/layout/Header";
import { EleveDetailView } from "@/components/eleves/EleveDetailView";
import { getSituationFinanciere, checkEleveAccess } from "@/lib/financial-guard";

async function getEleveDetail(id: string, tenantId: string, siteFilter: Record<string, unknown>) {
  const eleve = await prisma.eleve.findFirst({
    where: { id, tenantId, ...siteFilter },
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

  return eleve;
}

export default async function EleveDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.tenantId) redirect("/select-tenant");
  guardPage(session, "eleves:read");

  // eleveScopeFilter combine le filtrage par site ET le périmètre personnel
  // (lien familial pour PARENT, userId pour STUDENT). Sans cela, un parent
  // pourrait consulter le dossier de n'importe quel élève du tenant.
  const eleveFilter = eleveScopeFilter(session.user, null);
  const matiereFilter = siteFilterForModel("matiere", session.user);
  const dispenseFilter = siteFilterForModel("dispenseMatiere", session.user);
  const { id } = await params;

  // Pour les enseignants : vérifier que l'élève est dans une de leurs classes
  if (isTeacherRole(session.user.role as Role)) {
    const scope = await getTeacherScope(session.user.tenantId!, session.user.id, session.user.role as Role);
    if (scope.isRestricted) {
      const eleveCheck = await prisma.eleve.findFirst({
        where: { id, tenantId: session.user.tenantId, ...eleveFilter },
        select: { id: true, classeId: true },
      });
      if (!eleveCheck || !scope.classeIds.includes(eleveCheck.classeId ?? "")) {
        notFound();
      }
    }
  }

  const eleve = await getEleveDetail(id, session.user.tenantId, eleveFilter);

  if (!eleve) notFound();

  // Blocage financier : si l'élève est exclu, rediriger les parents/élèves
  if (session.user.role === "PARENT" || session.user.role === "STUDENT") {
    const access = await checkEleveAccess(id, session.user.tenantId, {
      userId: session.user.id,
      role: session.user.role,
    });
    if (!access.allowed) {
      redirect("/acces-bloque");
    }
  }

  // Matières (pour le sélecteur de dispense) + dispenses existantes de l'élève
  const [matieres, dispensesRaw] = await Promise.all([
    prisma.matiere.findMany({
      where: { tenantId: session.user.tenantId, ...matiereFilter },
      select: { id: true, nom: true, code: true },
      orderBy: { nom: "asc" },
    }),
    prisma.dispenseMatiere.findMany({
      where: { tenantId: session.user.tenantId, eleveId: id, ...dispenseFilter },
      include: { matiere: { select: { nom: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const dispenses = dispensesRaw.map((d) => ({
    id: d.id,
    matiereId: d.matiereId,
    matiereNom: d.matiere.nom,
    motif: d.motif,
  }));

  const situationFinanciere = await getSituationFinanciere(id, session.user.tenantId);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <Header
        title={`${eleve.prenom} ${eleve.nom}`}
        subtitle={`${eleve.matricule} · ${eleve.classe?.nom ?? "Classe non affectée"}`}
        userName={session.user.name}
        userAvatar={session.user.image ?? undefined}
      />
      <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
        <EleveDetailView eleve={eleve} matieres={matieres} dispenses={dispenses} situationFinanciere={situationFinanciere} />
      </div>
    </div>
  );
}
