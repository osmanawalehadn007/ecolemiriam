import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { Header } from "@/components/layout/Header";
import { RHView } from "@/components/rh/RHView";
import { getTranslations } from "next-intl/server";
import { guardPage } from "@/lib/guard-page";
import { siteFilterForModel } from "@/lib/site-scope";

async function getEnseignantsRH(tenantId: string, ensFilter: Record<string, unknown>, absFilter: Record<string, unknown>, congeFilter: Record<string, unknown>) {
  const [enseignants, absencesPersonnel, congesPersonnel] = await Promise.all([
    /* eslint-disable ecolpro/require-site-filter -- les trois `where` sont des PARAMÈTRES construits par l'appelant via siteFilterForModel(...) ; la règle ne remonte pas jusqu'à eux. */
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
            // Enfants d'une fiche RH rattachée à un enseignant déjà borné au
            // périmètre : `BulletinPaie` n'a pas de site propre.
            // eslint-disable-next-line ecolpro/require-site-filter
            bulletinsPaie: {
              orderBy: [{ annee: "desc" }, { mois: "desc" }],
              take: 3,
            },
          },
        },
        // Créneaux et classes de CET enseignant, déjà filtré.
        // eslint-disable-next-line ecolpro/require-site-filter
        emploiTemps: {
          select: {
            jour: true, heureDebut: true, heureFin: true,
            matiere: { select: { nom: true, couleur: true } },
            classe: { select: { nom: true } },
          },
        },
        // eslint-disable-next-line ecolpro/require-site-filter
        classesPrincipales: {
          select: { id: true, nom: true, niveau: true },
        },
      },
      orderBy: { user: { name: "asc" } },
    }),
    prisma.absencePersonnel.findMany({
      where: { tenantId, ...absFilter },
      include: {
        enseignant: { select: { id: true, user: { select: { name: true } } } },
        saisiePar: { select: { name: true } },
      },
      orderBy: { date: "desc" },
      take: 50,
    }),
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
    /* eslint-enable ecolpro/require-site-filter */
  ]);

  return { enseignants, absencesPersonnel, congesPersonnel };
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
  const { enseignants, absencesPersonnel, congesPersonnel } = await getEnseignantsRH(session!.user.tenantId!, ensFilter, absFilter, congeFilter);

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
        />
      </div>
    </div>
  );
}
