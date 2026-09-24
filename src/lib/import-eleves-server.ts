/**
 * Préparation d'un import d'élèves : lecture du fichier, chargement du
 * contexte de l'établissement, construction du plan.
 *
 * Isolé du module d'analyse pur (`import-eleves.ts`) parce qu'il touche la
 * base : c'est aussi ce qui permet de tester l'analyse sans base de données.
 */

import prisma from "@/lib/prisma";
import { siteFilterForModel, mergeFilters, type SessionSiteClaims } from "@/lib/site-scope";
import { getAnneeCouranteLibelle } from "@/lib/annee-scolaire";
import { anneeFilterForModel } from "@/lib/annee-scope";
import { normalizeName } from "@/lib/eleve-identity";
import {
  analyzeImport,
  parseElevesWorkbook,
  type FicheExistante,
  type PlanImport,
  type ParsedRow,
} from "@/lib/import-eleves";

interface Acteur extends SessionSiteClaims {
  id: string;
  tenantId: string;
}

export interface ContextePlan {
  plan: PlanImport;
  rows: ParsedRow[];
  hash: string;
}

/**
 * Construit le plan d'import à partir du fichier téléversé.
 *
 * Les fiches archivées sont incluses dans le rapprochement : leur matricule
 * reste réservé (contrainte `@@unique([tenantId, matricule])`) et réimporter
 * un élève archivé doit le restaurer plutôt que d'en créer un second.
 */
export async function preparerPlan(
  acteur: Acteur,
  buffer: ArrayBuffer,
  targetSiteId?: string | null
): Promise<ContextePlan> {
  const { rows, erreurs, hash } = await parseElevesWorkbook(buffer);

  // Lorsqu'un site cible est explicitement fourni pour l'import, on restreint
  // la recherche des élèves et classes existantes à ce site uniquement — sans
  // cela, un TENANT_ADMIN sans site sélectionné chargerait tous les élèves du
  // tenant et l'import « écraserait » les fiches des autres sites.
  const siteFilter = targetSiteId
    ? { AND: [{ siteId: targetSiteId }] }
    : siteFilterForModel("eleve", acteur);
  const classeSiteFilter = targetSiteId
    ? { AND: [{ siteId: targetSiteId }] }
    : siteFilterForModel("classe", acteur);
  // Le périmètre de site de la session est TOUJOURS appliqué ; un site cible
  // explicite le restreint davantage (il est validé par l'appelant). Sans le
  // filtre de session, un site cible non autorisé remplaçait le périmètre.
  const eleveScopeFilter = siteFilterForModel("eleve", acteur);
  const classeScopeFilter = siteFilterForModel("classe", acteur);
    ? mergeFilters(eleveScopeFilter, { AND: [{ siteId: targetSiteId }] })
    : eleveScopeFilter;
    ? mergeFilters(classeScopeFilter, { AND: [{ siteId: targetSiteId }] })
    : classeScopeFilter;

  const [existantsBruts, classes, importPrecedent] = await Promise.all([
    prisma.eleve.findMany({
      where: mergeFilters({ tenantId: acteur.tenantId }, siteFilter),
      select: {
        id: true,
        matricule: true,
        nom: true,
        prenom: true,
        dateNaissance: true,
        deletedAt: true,
        classe: { select: { nom: true } },
      },
    }),
    // eslint-disable-next-line ecolemiriam/require-site-filter -- classeSiteFilter déjà appliqué via mergeFilters (le linter ne détecte pas le spread conditionnel)
    prisma.classe.findMany({
      where: mergeFilters(
        { tenantId: acteur.tenantId },
        classeSiteFilter,
        anneeFilterForModel(
          "classe",
          await getAnneeCouranteLibelle(acteur.tenantId),
        ),
      ),
      where: mergeFilters({ tenantId: acteur.tenantId }, classeSiteFilter),
      select: { nom: true },
    }),
    // Empreinte du fichier : a-t-il déjà été importé dans cet établissement ?
    prisma.auditLog.findFirst({
      where: {
        tenantId: acteur.tenantId,
        action: "eleves.import",
        metadata: { path: ["hash"], equals: hash },
      },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, userId: true },
    }),
  ]);

  const existants: FicheExistante[] = existantsBruts.map((e) => ({
    id: e.id,
    matricule: e.matricule,
    nom: e.nom,
    prenom: e.prenom,
    dateNaissance: e.dateNaissance,
    classeNom: e.classe?.nom ?? null,
    archive: e.deletedAt !== null,
  }));

  const classesConnues = new Set(classes.map((c) => normalizeName(c.nom)));
  const plan = analyzeImport(rows, erreurs, existants, classesConnues, hash);

  if (importPrecedent) {
    let par: string | null = null;
    if (importPrecedent.userId) {
      // eslint-disable-next-line ecolemiriam/require-tenant-id, ecolemiriam/require-site-filter -- lookup par userId pour affichage du nom seulement (pas de donnée sensible)
      const auteur = await prisma.user.findUnique({
        where: { id: importPrecedent.userId },
      // Auteur d'un import précédent : identifiant issu de NOTRE journal d'audit
      // (déjà borné au tenant). C'est un membre du personnel, qui peut n'être
      // rattaché à aucun site — d'où l'absence de filtre de site, assumée.
      // eslint-disable-next-line ecolpro/require-site-filter
      const auteur = await prisma.user.findFirst({
        where: { id: importPrecedent.userId, tenantId: acteur.tenantId },
        select: { name: true },
      });
      par = auteur?.name ?? null;
    }
    plan.dejaImporte = { date: importPrecedent.createdAt.toISOString(), par };
  }

  return { plan, rows, hash };
}

/**
 * Dernier matricule émis pour l'année, fiches archivées comprises.
 *
 * Volontairement sans filtre `deletedAt` : un matricule attribué puis archivé
 * ne doit jamais être réattribué, sans quoi la contrainte d'unicité échoue au
 * milieu d'un lot.
 */
export async function dernierMatricule(tenantId: string, annee: number): Promise<string | null> {
  // eslint-disable-next-line ecolemiriam/require-site-filter -- unicité du matricule au niveau tenant, par construction
  const dernier = await prisma.eleve.findFirst({
    where: { tenantId, matricule: { startsWith: `${annee}-` } },
    orderBy: { matricule: "desc" },
    select: { matricule: true },
  });
  return dernier?.matricule ?? null;
}
