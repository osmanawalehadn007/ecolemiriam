import { auth } from "@/lib/auth";
import { guardPage } from "@/lib/guard-page";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { runWithTenant, runWithRlsBatch } from "@/lib/prisma";
import type { Prisma, PrismaClient } from "@prisma/client";
import { Header } from "@/components/layout/Header";
import { ElevesTable } from "@/components/eleves/ElevesTable";
import { ElevesStats } from "@/components/eleves/ElevesStats";
import { ElevesActions } from "@/components/eleves/ElevesActions";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Plus, Upload } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { unstable_cache } from "next/cache";
import { ImportElevesButton } from "@/components/eleves/ImportElevesButton";
import { siteFilterForModel, mergeFilters } from "@/lib/site-scope";
import { roleHasPermission } from "@/lib/rbac";
import { getSitesForUserCached } from "@/lib/sites-cached";
import { getAnneeCouranteLibelle } from "@/lib/annee-scolaire";
import { anneeFilterForModel } from "@/lib/annee-scope";
import { getSiteColorMap } from "@/lib/site-colors";
import { getTeacherScope, isTeacherRole } from "@/lib/teacher-classes";
import type { Role } from "@prisma/client";

/**
 * Périmètre commun à TOUTES les mesures de la page.
 *
 * Le total affiché et la somme des effectifs par classe doivent provenir du
 * même ensemble de lignes, sans quoi ils se contredisent — c'est ce qui
 * produisait un total de 275 face à des classes totalisant 269 : les
 * statistiques étaient servies depuis `unstable_cache` (60 s) pendant que le
 * tableau lisait la base en direct, si bien qu'une suppression d'élève
 * n'apparaissait que d'un côté.
 */
function baseEleveWhere(
  tenantId: string,
  siteFilter: Record<string, unknown>,
  userRole?: string,
  scope?: { classeIds: string[]; isRestricted: boolean }
): Prisma.EleveWhereInput {
  return {
    tenantId,
    ...siteFilter,
    deletedAt: null,
    // Pour les parents : masquer les enfants exclus. Ce filtre doit valoir
    // pour les statistiques comme pour le tableau.
    ...(userRole === "PARENT" && { statut: { not: "EXCLU" } }),
    // Pour les enseignants : ne montrer que les élèves de leurs classes
    ...(scope?.isRestricted && scope.classeIds.length > 0
      ? { classeId: { in: scope.classeIds } }
      : scope?.isRestricted
        ? { id: "__none__" } // Aucune classe assignée → aucun élève
        : {}),
  } as Prisma.EleveWhereInput;
}

/**
 * Statistiques d'en-tête. Volontairement NON mises en cache : elles sont
 * lues dans la même requête HTTP que le tableau, à partir du même `where`,
 * ce qui rend toute divergence impossible par construction. Ce sont trois
 * agrégats sur une colonne indexée (`tenantId`) — le coût est négligeable
 * devant le risque d'afficher deux vérités différentes.
 */
// eslint-disable-next-line ecolemiriam/require-site-filter -- `where` est construit par baseEleveWhere, qui applique déjà siteFilter
async function getElevesStats(where: Prisma.EleveWhereInput) {
  // OPTIMISATION: 1 seule requête findMany au lieu de 3 groupBy séparés.
  // On charge uniquement les 3 champs nécessaires (statut, sexe, regime)
  // pour tous les élèves, puis on agrège en JS. Avec ~880 élèves, le
  // payload est minuscule (~3 champs × 880 lignes) et on économise
  // 2 round trips DB complets (4 round trips via le tunnel SSH).
  // eslint-disable-next-line ecolemiriam/require-site-filter -- where reçu en paramètre, déjà filtré par site
  const rows = await prisma.eleve.findMany({
    where,
    select: { statut: true, sexe: true, regime: true },
  });

  let total = 0, actifs = 0, filles = 0, garcons = 0, internes = 0;
  for (const e of rows) {
    total++;
    if (e.statut === "ACTIF") actifs++;
    if (e.sexe === "F") filles++;
    else if (e.sexe === "M") garcons++;
    if (e.regime === "interne") internes++;
  }

  return { total, actifs, filles, garcons, internes };
}

/**
 * Effectif réel de chaque classe, mesuré en base.
 *
 * Le tableau ne charge que les 500 premiers élèves ; compter les lignes
 * chargées sous-estimerait donc les effectifs au-delà de ce plafond, en
 * silence. Un `groupBy` donne le compte exact quel que soit le volume.
 *
 * OPTIMISATION: retourne aussi le total (somme des effectifs) pour éviter
 * une requête count séparée.
 */
async function getEffectifsParClasse(where: Prisma.EleveWhereInput, tenantId: string) {
  // eslint-disable-next-line ecolemiriam/require-site-filter -- where reçu en paramètre, déjà filtré par site
  const parClasse = await prisma.eleve.groupBy({
    by: ["classeId"],
    where,
    _count: true,
  });

  const effectifs: Record<string, number> = {};
  let total = 0;
  for (const c of parClasse) {
    // Cle unique = classeId pour eviter l'ambiguite entre deux classes
    // homonymes situees sur des sites differents.
    const key = c.classeId ?? "Sans classe";
    effectifs[key] = (effectifs[key] ?? 0) + c._count;
    total += c._count;
  }
  return { effectifs, total };
}

const getClassesList = unstable_cache(
  async (
    tenantId: string,
    siteId: string | null,
    siteFilter: Record<string, unknown>,
    // L'année fait partie de la clé de cache : changer d'année scolaire
    // invalide naturellement la liste.
    annee: string | null,
  ) => {
    // N-4 : unstable_cache détache le contexte requête → auth() échoue →
    // RLS non positionnée. runWithTenant injecte le contexte via ALS.
    return runWithTenant(tenantId, siteId, async () => {
    // eslint-disable-next-line ecolemiriam/require-site-filter -- where includes ...siteFilter spread, not detectable inside unstable_cache
    const classes = await prisma.classe.findMany({
      where: mergeFilters(
        { tenantId },
        siteFilter,
        anneeFilterForModel("classe", annee),
      ) as Prisma.ClasseWhereInput,
      select: { id: true, nom: true, site: { select: { nom: true } } },
      orderBy: [{ site: { nom: "asc" } }, { nom: "asc" }],
    });
    const seen = new Map<string, { id: string; nom: string; siteNom: string | null }>();
    for (const c of classes) {
      seen.set(c.id, { id: c.id, nom: c.nom, siteNom: c.site?.nom ?? null });
    }
    return Array.from(seen.values());
    }); // fin runWithTenant
  },
  ["classes-list"],
  { revalidate: 300, tags: ["classes-list"] }
);

async function getElevesData(
  tenantId: string,
  siteId: string | null,
  siteFilter: Record<string, unknown>,
  classeSiteFilter: Record<string, unknown>,
  filters: { q?: string; classeId?: string; statut?: string; limit?: number },
  userRole?: string,
  scope?: { classeIds: string[]; isRestricted: boolean },
) {
  // Périmètre de référence : ce que voit l'utilisateur, filtres d'écran mis à
  // part. Statistiques et effectifs par classe en découlent tous les deux.
  const base = baseEleveWhere(tenantId, siteFilter, userRole, scope);

  // Périmètre du tableau : le périmètre de référence, restreint par les
  // filtres choisis à l'écran.
  const where = {
    ...base,
    ...(filters.classeId && { classeId: filters.classeId }),
    ...(filters.statut && { statut: filters.statut as "ACTIF" }),
    ...(filters.q && {
      OR: [
        { nom: { contains: filters.q, mode: "insensitive" as const } },
        { prenom: { contains: filters.q, mode: "insensitive" as const } },
        { matricule: { contains: filters.q, mode: "insensitive" as const } },
      ],
    }),
  } as Prisma.EleveWhereInput;

  // OPTIMISATION: plafonner le nombre d'élèves chargés pour éviter de
  // charger les 880 élèves avec relations à chaque navigation. La valeur
  // par défaut (200) couvre la majorité des cas d'usage ; un paramètre
  // `limit` permet à l'utilisateur de charger plus si nécessaire.
  const takeLimit = filters.limit ?? 200;

  // OPTIMISATION MAJEURE: exécuter les 3 requêtes principales (eleves,
  // stats, effectifs) dans UNE SEULE transaction RLS au lieu de 3 séparées.
  // → 1 SET LOCAL + 3 queries = 4 round trips au lieu de 6 (2×3).
  // Via le tunnel SSH (~100ms/round trip), on économise ~200ms.
  // Les classes et données partagées (sites, année, couleurs) sont cachées
  // séparément et ne passent pas par cette transaction.
  const [eleves, stats, { effectifs, total }] = await runWithRlsBatch(
    tenantId,
    siteId,
    async (tx: Prisma.TransactionClient) => {
      const [eleves, statsRows, parClasse] = await Promise.all([
        // eslint-disable-next-line ecolemiriam/require-site-filter -- where is built from { tenantId, ...siteFilter } in getElevesData
        tx.eleve.findMany({
          where,
          take: takeLimit,
          include: {
            // eslint-disable-next-line ecolemiriam/require-site-filter -- classe is a 1:1 relation, site filter applied at parent query level
            classe: { select: { id: true, nom: true, niveau: true, site: { select: { id: true, nom: true } } } },
            // Le lien élève↔parent n'a pas de site propre : il est borné par
            // l'élève, déjà filtré par le `where` racine. Un parent peut par
            // ailleurs avoir des enfants sur plusieurs sites.
            // eslint-disable-next-line ecolemiriam/require-site-filter
            parents: {
              include: { parent: { select: { nom: true, prenom: true, phone: true } } },
              where: { isGardien: true },
              take: 1,
            },
          },
          // OPTIMISATION: orderBy sur prenom/nom (colonnes indexées de eleve)
          // au lieu de classe.nom (relation → force un sort externe coûteux).
          // Le tri par classe est fait côté client dans ElevesTable.
          orderBy: [{ prenom: "asc" }, { nom: "asc" }],
        }),
        // Stats: 1 seule requête findMany au lieu de 3 groupBy
        // eslint-disable-next-line ecolemiriam/require-site-filter -- where reçu en paramètre, déjà filtré par site
        tx.eleve.findMany({
          where: base,
          select: { statut: true, sexe: true, regime: true },
        }),
        // Effectifs par classe + total en 1 requête
        // eslint-disable-next-line ecolemiriam/require-site-filter -- where reçu en paramètre, déjà filtré par site
        tx.eleve.groupBy({
          by: ["classeId"],
          where,
          _count: true,
        }),
      ]);

      // Agréger les stats en JS
      let totalStats = 0, actifs = 0, filles = 0, garcons = 0, internes = 0;
      for (const e of statsRows) {
        totalStats++;
        if (e.statut === "ACTIF") actifs++;
        if (e.sexe === "F") filles++;
        else if (e.sexe === "M") garcons++;
        if (e.regime === "interne") internes++;
      }

      // Agréger les effectifs
      const effectifsMap: Record<string, number> = {};
      let totalEleves = 0;
      for (const c of parClasse) {
        const key = c.classeId ?? "Sans classe";
        effectifsMap[key] = (effectifsMap[key] ?? 0) + c._count;
        totalEleves += c._count;
      }

      return [eleves, { total: totalStats, actifs, filles, garcons, internes }, { effectifs: effectifsMap, total: totalEleves }] as const;
    }
  );

  // Pour les enseignants restreints : récupérer les classes par scope
  // (classeIds) SANS filtre de site, car un enseignant peut enseigner dans
  // des classes situées sur des sites auxquels il n'est pas explicitement
  // rattaché via UserSite/EnseignantSite. Le scope est la sécurité, pas le
  // site. (Voir cahier-de-texte/page.tsx qui fait de même.)
  //
  // Pour les autres rôles : cache partagé filtré par site.
  const classeNoms = scope?.isRestricted && scope.classeIds.length > 0
    ? await runWithTenant(tenantId, siteId, async () => {
        // eslint-disable-next-line ecolemiriam/require-site-filter, ecolemiriam/require-annee-filter -- périmètre enseignant : `classeIds` est la frontière, et ces classes sont celles où il enseigne cette année
        const classes = await prisma.classe.findMany({
          where: { tenantId, id: { in: scope.classeIds } },
          select: { id: true, nom: true, site: { select: { nom: true } } },
          orderBy: [{ site: { nom: "asc" } }, { nom: "asc" }],
        });
        return classes.map((c) => ({ id: c.id, nom: c.nom, siteNom: c.site?.nom ?? null }));
      })
    : await getClassesList(
        tenantId,
        siteId,
        classeSiteFilter,
        await getAnneeCouranteLibelle(tenantId),
      );

  return { eleves, total, stats, classeNoms, effectifs };
}

export default async function ElevesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; classeId?: string; statut?: string; limit?: string }>;
}) {
  const [session, t, tCommon, sp] = await Promise.all([
    auth(),
    getTranslations("eleves"),
    getTranslations("common"),
    searchParams,
  ]);
  if (!session?.user?.tenantId) redirect("/select-tenant");
  guardPage(session, "eleves:read");

  const { q, classeId, statut } = sp;
  const limit = sp.limit ? parseInt(sp.limit, 10) : undefined;

  const siteFilter = siteFilterForModel("eleve", session.user);
  const classeSiteFilter = siteFilterForModel("classe", session.user);
  const currentSiteId = (session.user as { siteId?: string | null }).siteId ?? null;
  const tenantHasSites = (session.user as { tenantHasSites?: boolean }).tenantHasSites ?? false;

  // Filtrer par classes de l'enseignant si applicable
  const scope = isTeacherRole(session.user.role as Role)
    ? await getTeacherScope(session.user.tenantId, session.user.id, session.user.role as Role)
    : undefined;

  const [sites, anneeCourante, siteColors, { eleves, total, stats, classeNoms, effectifs }] = await Promise.all([
    // Réutilise le cache du layout → 0 requête DB supplémentaire
    getSitesForUserCached(session.user.tenantId, session.user.id, session.user.role === "TENANT_ADMIN" || session.user.role === "SUPER_ADMIN"),
    getAnneeCouranteLibelle(session.user.tenantId),
    getSiteColorMap(session.user.tenantId),
    getElevesData(session.user.tenantId, session.user.siteId ?? null, siteFilter, classeSiteFilter, {
      q,
      classeId,
      statut,
      limit,
    }, session.user.role, scope),
  ]);

  const currentSiteName = currentSiteId
    ? (sites.find((s) => s.id === currentSiteId)?.nom ?? "Site inconnu")
    : session.user.role === "TENANT_ADMIN" || session.user.role === "SUPER_ADMIN"
      ? tCommon("allSites")
      : "Aucun site";
  const currentSiteColor = currentSiteId ? siteColors[currentSiteId] : undefined;

  // Le bouton "Inscrire un élève" et l'import Excel nécessitent eleves:write.
  // Source unique d'inscription : le bouton renvoie désormais vers le workflow
  // d'admissions (/admissions), qui gère candidature → facture → paiement →
  // création de la fiche élève. La saisie directe (/eleves/nouveau) redirige
  // aussi vers /admissions.
  const canWriteEleves = roleHasPermission(session.user.role as Role, "eleves:write");

  // Filtrer la liste des classes pour les enseignants (ne montrer que leurs classes)
  const filteredClasseNoms = scope?.isRestricted
    ? classeNoms.filter((c: { id: string; nom: string; siteNom: string | null }) =>
        scope.classeIds.includes(c.id)
      )
    : classeNoms;

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <Header
        title={t("title")}
        subtitle={`${stats.actifs} — ${anneeCourante ?? "—"}`}
        site={currentSiteName}
        siteColor={currentSiteColor}
        userName={session.user.name}
        userAvatar={session.user.image ?? undefined}
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin">
        {/* Actions */}
        <div className="flex items-center justify-between">
          <ElevesStats stats={stats} />
          <div className="flex gap-2">
            <ElevesActions q={q} classeId={classeId} statut={statut} />
            {canWriteEleves && (
              <ImportElevesButton sites={sites} currentSiteId={currentSiteId} tenantHasSites={tenantHasSites} />
            )}
            {canWriteEleves && (
              <Button asChild size="sm" className="gap-2">
                <Link href="/admissions">
                  <Plus className="h-4 w-4" />
                  {t("register")}
                </Link>
              </Button>
            )}
          </div>
        </div>

        {/* Tableau */}
        <ElevesTable
          eleves={eleves}
          total={total}
          effectifs={effectifs}
          classes={filteredClasseNoms}
          siteColors={siteColors}
          initialQuery={q ?? ""}
          initialClasse={classeId ?? ""}
          initialStatut={statut ?? ""}
        />
      </div>
    </div>
  );
}
