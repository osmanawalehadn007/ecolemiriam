/**
 * Préparation d'un import d'enseignants : lecture du fichier, chargement du
 * contexte de l'établissement, construction du plan.
 *
 * Isolé du module d'analyse pur (`import-enseignants.ts`) parce qu'il touche la
 * base : c'est aussi ce qui permet de tester l'analyse sans base de données.
 */

import prisma from "@/lib/prisma";
import prismaBase from "@/lib/prisma-base";
import {
  siteFilterForModel,
  mergeFilters,
  resolveSiteScope,
  type SessionSiteClaims,
} from "@/lib/site-scope";
import { getAnneeCouranteLibelle } from "@/lib/annee-scolaire";
import { anneeFilterForModel } from "@/lib/annee-scope";
import {
  analyzeImport,
  parseEnseignantsWorkbook,
  type FicheExistante,
  type MatiereExistante,
  type SiteExistant,
  type ClasseExistante,
  type PlanImport,
  type ParsedRow,
} from "@/lib/import-enseignants";

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
 * La vérification d'unicité de l'email est **inter-tenants** : `User.email` est
 * unique au niveau de la plateforme entière, pas du tenant. On utilise
 * `prismaBase` (qui contourne RLS) pour cette vérification d'existence seule,
 * sans exposer aucune donnée de l'autre tenant.
 */
export async function preparerPlan(
  acteur: Acteur,
  buffer: ArrayBuffer,
): Promise<ContextePlan> {
  // Périmètre de sites du demandeur. `site` EST la table des sites : il n'y a
  // pas de colonne `siteId` à filtrer, on borne donc sur `id`. Sans cette
  // borne, un comptable rattaché à un seul site pouvait importer un
  // enseignant — et faire créer sa classe — sur n'importe quel autre site de
  // l'établissement (constaté le 29/09/2026, 3 comptables mono-site).
  const scope = resolveSiteScope(acteur);
  if (scope.kind === "NONE" || scope.kind === "RELATION") {
    // FAIL-CLOSED : périmètre vide (rattachement manquant) ou périmètre
    // personnel (parent/élève, sans rôle administratif). L'import est
    // administratif : on refuse avec un message actionnable plutôt que de
    // présenter un plan dont chaque ligne serait « site introuvable ».
    throw new Error(
      "Votre compte n'est rattaché à aucun site : l'import d'enseignants est impossible. " +
        "Demandez votre rattachement à un site auprès d'un administrateur.",
    );
  }
  const siteWhere = scope.kind === "SITES" ? { id: { in: scope.siteIds } } : {};

  // Charger le contexte de l'établissement en premier — il sert à l'inférence
  // de colonnes (reconnaissance des sites et matières par leurs valeurs).
  const [matieres, sites, classes] = await Promise.all([
    prisma.matiere.findMany({
      where: mergeFilters({ tenantId: acteur.tenantId }, siteFilterForModel("matiere", acteur)),
      select: { id: true, nom: true, code: true },
    }),
     
    prisma.site.findMany({
      where: { tenantId: acteur.tenantId, ...siteWhere },
      select: { id: true, nom: true },
    }),
    // Charger les classes pour la résolution enseignant ↔ classe
    prisma.classe.findMany({
      where: mergeFilters(
        { tenantId: acteur.tenantId },
        siteFilterForModel("classe", acteur),
        anneeFilterForModel(
          "classe",
          await getAnneeCouranteLibelle(acteur.tenantId),
        ),
      ),
      select: { id: true, nom: true, niveau: true, siteId: true, annee: true },
    }),
  ]);

  // Passer les noms de sites et matières connus au parser pour améliorer
  // l'inférence de colonnes (bonus score si les données correspondent).
  const nomsSites = sites.map((s) => s.nom);
  const nomsMatieres = matieres.map((m) => m.nom);

  const { rows, erreurs, hash } = await parseEnseignantsWorkbook(buffer, nomsSites, nomsMatieres);

  const importPrecedent = await prisma.auditLog.findFirst({
    where: {
      tenantId: acteur.tenantId,
      action: "enseignants.import",
      metadata: { path: ["hash"], equals: hash },
    },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true, userId: true },
  });

  // Vérifier l'existence des emails — inter-tenants via prismaBase
  // (User.email est unique au niveau plateforme)
  const emailsAVerifier = rows.map((r) => r.email);
  let emailsExistants = new Set<string>();
  if (emailsAVerifier.length > 0) {
    const existants = await prismaBase.user.findMany({
      where: { email: { in: emailsAVerifier, mode: "insensitive" } },
      select: { email: true },
    });
    emailsExistants = new Set(existants.map((u) => u.email.toLowerCase()));
  }

  const matieresCtx: MatiereExistante[] = matieres.map((m) => ({
    id: m.id,
    nom: m.nom,
    code: m.code,
  }));

  const sitesCtx: SiteExistant[] = sites.map((s) => ({
    id: s.id,
    nom: s.nom,
  }));

  const classesCtx: ClasseExistante[] = classes.map((c) => ({
    id: c.id,
    nom: c.nom,
    niveau: c.niveau,
    siteId: c.siteId ?? "",
    annee: c.annee,
  }));

  const plan = analyzeImport(rows, erreurs, emailsExistants, matieresCtx, sitesCtx, hash, classesCtx);

  if (importPrecedent) {
    let par: string | null = null;
    if (importPrecedent.userId) {
      // eslint-disable-next-line ecolemiriam/require-tenant-id, ecolemiriam/require-site-filter -- lookup par userId pour affichage du nom seulement
      const auteur = await prisma.user.findUnique({
        where: { id: importPrecedent.userId },
        select: { name: true },
      });
      par = auteur?.name ?? null;
    }
    plan.dejaImporte = { date: importPrecedent.createdAt.toISOString(), par };
  }

  return { plan, rows, hash };
}
