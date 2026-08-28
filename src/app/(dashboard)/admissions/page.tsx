import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { Header } from "@/components/layout/Header";
import { AdmissionsView } from "@/components/admissions/AdmissionsView";
import { getTranslations } from "next-intl/server";
import { guardPage } from "@/lib/guard-page";
import { siteFilterForModel, isTenantWideRole } from "@/lib/site-scope";
import { getAnneeCouranteLibelle } from "@/lib/annee-scolaire";

async function getCandidatures(
  tenantId: string,
  annee: string,
  siteFilter: Record<string, unknown>
) {
  const candidatures = await prisma.candidature.findMany({
    where: { tenantId, annee, ...siteFilter },
    orderBy: { createdAt: "desc" },
    include: {
      // eslint-disable-next-line ecolemiriam/require-site-filter -- les factures sont filtrées via la candidature qui est déjà filtrée par site
      factures: {
        include: {
          paiements: true,
        },
      },
    },
  });

  return { candidatures };
}

export default async function AdmissionsPage() {
  const [session, t] = await Promise.all([
    auth(),
    getTranslations("admissions"),
  ]);
  guardPage(session, "admissions:read");

  const siteFilter = siteFilterForModel("candidature", session!.user);
  const classeSiteFilter = siteFilterForModel("classe", session!.user);

  // Année scolaire courante du tenant (table `annees_scolaires`, isCurrent).
  // Repli sur l'année calendaire si aucune année n'est déclarée.
  const annee =
    (await getAnneeCouranteLibelle(session!.user.tenantId!)) ??
    `${new Date().getFullYear()}-${new Date().getFullYear() + 1}`;

  const [{ candidatures }, classesRaw] = await Promise.all([
    getCandidatures(session!.user.tenantId!, annee, siteFilter),
    // Classes du périmètre de l'utilisateur, avec leur site. Deux bornes
    // indissociables :
    //   - le SITE (classeSiteFilter) : une classe d'un autre site ne doit
    //     jamais être proposée ;
    //   - l'ANNÉE (annee) : les classes des années révolues restent en base
    //     (historique des notes, bulletins, absences) mais ne sont plus des
    //     structures d'accueil. Sans ce filtre, le sélecteur proposait par
    //     exemple les classes de Lycée 2025-2026 d'un site qui n'accueille
    //     plus que du collège en 2026-2027.
    // On NE dédoublonne PAS par nom : deux sites peuvent avoir une classe
    // homonyme, et c'est l'ID (lié au site) qui doit être choisi — pas le nom.
    // eslint-disable-next-line ecolemiriam/require-site-filter -- where inclut tenantId + classeSiteFilter
    prisma.classe.findMany({
      where: { tenantId: session!.user.tenantId!, annee, ...classeSiteFilter },
      select: { id: true, nom: true, niveau: true, siteId: true, site: { select: { nom: true } } },
      orderBy: [{ nom: "asc" }],
    }),
  ]);

  const classes = classesRaw.map((c) => ({
    id: c.id,
    nom: c.nom,
    niveau: c.niveau,
    siteId: c.siteId ?? null,
    siteNom: c.site?.nom ?? null,
  }));

  // Cast les documents + factures pour le composant
  const candidaturesForView = candidatures.map((c) => ({
    ...c,
    dateNaissance: c.dateNaissance,
    dateExamen: c.dateExamen,
    documents: (c.documents as { nom: string; url: string; type?: string }[] | null) ?? null,
    factures: c.factures.map((f) => ({
      id: f.id,
      numero: f.numero,
      libelle: f.libelle,
      montant: f.montant,
      devise: f.devise,
      statut: f.statut,
      totalPaye: f.paiements.reduce((sum, p) => sum + p.montant, 0),
    })),
  }));

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <Header
        title={t("title")}
        subtitle={t("subtitle")}
        userName={session!.user.name}
        userAvatar={session!.user.image ?? undefined}
      />
      <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
        <AdmissionsView
          candidatures={candidaturesForView}
          userRole={session!.user.role}
          classes={classes}
          annee={annee}
          userSiteId={session!.user.siteId ?? null}
          isTenantWide={isTenantWideRole(session!.user.role)}
        />
      </div>
    </div>
  );
}
