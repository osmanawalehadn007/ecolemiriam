import prismaBase from "@/lib/prisma-base";
import type { Role } from "@prisma/client";
import type { AvailableTenantSlim } from "@/auth.config";

/**
 * École Miriam — Dérivation des revendications tenant/site
 * ===================================================
 * Source unique de vérité pour « dans quel tenant suis-je, sur quels sites
 * ai-je le droit d'être, et avec quel rôle ». Utilisé à la connexion, à chaque
 * changement de tenant/site, et lors du rafraîchissement du JWT.
 *
 * Règle structurante : **un rattachement de site n'est retenu que si le site
 * appartient au tenant actif.** Le modèle `UserSite` ne porte pas de
 * `tenantId` ; il faut donc systématiquement passer par `site.tenantId`. Sans
 * cette jointure, un utilisateur membre de plusieurs établissements pouvait
 * emporter dans un tenant les rattachements — et les rôles — d'un autre.
 */

/**
 * Version du schéma de revendications. À incrémenter dès que la forme ou la
 * sémantique des claims change : les JWT émis avec une version antérieure sont
 * alors ré-hydratés depuis la base à la première requête, sans reconnexion.
 */
export const CLAIMS_VERSION = 2;

export interface TenantSiteClaims {
  tenantId: string | null;
  role: Role;
  /** Site actuellement sélectionné, garanti appartenir au tenant actif. */
  siteId: string | null;
  /** Sites du tenant actif auxquels l'utilisateur est rattaché. */
  siteIds: string[];
  /** Le tenant actif possède-t-il au moins un site ? */
  tenantHasSites: boolean;
  availableTenants: AvailableTenantSlim[];
  claimsVersion: number;
}

/**
 * Recalcule l'intégralité des revendications d'un utilisateur depuis la base.
 *
 * @param userId utilisateur concerné
 * @param preferredTenantId tenant souhaité ; ignoré si l'utilisateur n'y a pas
 *   accès. À défaut, le tenant `isDefault` puis le premier accessible.
 */
type UserWithTenants = {
  id: string;
  role: Role;
  isActive: boolean;
  tenantId: string | null;
  siteId: string | null;
  userTenants: {
    tenantId: string;
    role: Role;
    isDefault: boolean;
    tenant: { id: string; name: string; slug: string };
  }[];
};

/**
 * Variante de `deriveClaims` qui accepte un utilisateur déjà chargé avec ses
 * relations `userTenants`. Évite un second aller-retour DB au login, où
 * l'utilisateur a déjà été fetché par `authorize()` avec toutes les relations
 * nécessaires.
 *
 * La seule requête DB restante est le `Promise.all` des 3 requêtes de sites.
 */
export async function deriveClaimsFromUser(
  user: UserWithTenants,
  preferredTenantId?: string | null
): Promise<TenantSiteClaims | null> {
  if (!user.isActive) return null;

  return deriveClaimsFromData(user, preferredTenantId);
}

export async function deriveClaims(
  userId: string,
  preferredTenantId?: string | null
): Promise<TenantSiteClaims | null> {
   
  const user = await prismaBase.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      isActive: true,
      tenantId: true,
      siteId: true,
      userTenants: {
        where: { isActive: true },
        select: {
          tenantId: true,
          role: true,
          isDefault: true,
          tenant: { select: { id: true, name: true, slug: true } },
        },
      },
    },
  });

  if (!user || !user.isActive) return null;

  return deriveClaimsFromData(user, preferredTenantId);
}

/**
 * Logique commune de dérivation des claims à partir des données utilisateur
 * déjà chargées. Ne fait qu'un seul aller-retour DB : les 3 requêtes de sites
 * en parallèle.
 */
async function deriveClaimsFromData(
  user: UserWithTenants,
  preferredTenantId?: string | null
): Promise<TenantSiteClaims | null> {
  const memberships = user.userTenants;

  // ---- Tenant actif ------------------------------------------------------
  // Un tenant n'est retenu que s'il figure parmi les adhésions actives.
  let activeTenantId: string | null = null;
  let tenantRole: Role = user.role;

  if (memberships.length > 0) {
    const wanted = preferredTenantId
      ? memberships.find((m) => m.tenantId === preferredTenantId)
      : undefined;
    const chosen = wanted ?? memberships.find((m) => m.isDefault) ?? memberships[0];
    activeTenantId = chosen.tenantId;
    tenantRole = chosen.role;
  } else if (user.role === "SUPER_ADMIN") {
    // L'équipe plateforme peut ne pas avoir d'adhésion explicite.
    activeTenantId = preferredTenantId ?? user.tenantId ?? null;
  } else {
    // Repli sur le tenantId dénormalisé pour les comptes historiques créés
    // avant l'introduction de UserTenant.
    activeTenantId = user.tenantId ?? null;
  }

  const availableTenants: AvailableTenantSlim[] = memberships.map((m) => ({
    tenantId: m.tenantId,
    tenantName: m.tenant.name,
    tenantSlug: m.tenant.slug,
    role: m.role,
    isDefault: m.isDefault,
  }));

  if (!activeTenantId) {
    return {
      tenantId: null,
      role: tenantRole,
      siteId: null,
      siteIds: [],
      tenantHasSites: false,
      availableTenants,
      claimsVersion: CLAIMS_VERSION,
    };
  }

  // ---- Sites autorisés DANS le tenant actif ------------------------------
  // La jointure sur `site.tenantId` est la garantie anti-fuite : aucun
  // rattachement d'un autre établissement ne peut franchir la frontière.
   
  const [userSites, enseignantSites, tenantSites] = await Promise.all([
    prismaBase.userSite.findMany({
      where: { userId: user.id, site: { tenantId: activeTenantId } },
      select: { siteId: true, role: true },
    }),
    prismaBase.enseignantSite.findMany({
      where: {
        site: { tenantId: activeTenantId },
        enseignant: { userId: user.id, tenantId: activeTenantId },
      },
      select: { siteId: true },
    }),
    prismaBase.site.findMany({
      where: { tenantId: activeTenantId },
      select: { id: true },
    }),
  ]);
   

  const tenantSiteIds = new Set(tenantSites.map((s) => s.id));
  const tenantSiteCount = tenantSites.length;

  const siteIds = Array.from(
    new Set([...userSites.map((s) => s.siteId), ...enseignantSites.map((s) => s.siteId)])
  );

  // ---- Site sélectionné --------------------------------------------------
  // Le siteId persisté n'est retenu que s'il est effectivement autorisé dans
  // le tenant actif. Un rattachement révoqué, ou un site appartenant à un
  // autre établissement, retombe sur `null`.
  let selectedSiteId: string | null = null;
  if (user.siteId) {
    if (siteIds.includes(user.siteId)) {
      selectedSiteId = user.siteId;
    } else if (isTenantWide(tenantRole) && tenantSiteIds.has(user.siteId)) {
      // La direction générale peut sélectionner n'importe quel site de SON
      // tenant, même sans ligne UserSite.
      selectedSiteId = user.siteId;
    }
  }

  // ---- Rôle effectif ----------------------------------------------------
  // Le rôle spécifique au site ne s'applique que s'il est explicitement
  // défini (non null). Si role = NULL, l'utilisateur hérite du rôle global.
  let effectiveRole = tenantRole;
  if (selectedSiteId) {
    const match = userSites.find((s) => s.siteId === selectedSiteId);
    if (match && match.role) effectiveRole = match.role;
  }

  return {
    tenantId: activeTenantId,
    role: effectiveRole,
    siteId: selectedSiteId,
    siteIds,
    tenantHasSites: tenantSiteCount > 0,
    availableTenants,
    claimsVersion: CLAIMS_VERSION,
  };
}

function isTenantWide(role: Role | string): boolean {
  return role === "TENANT_ADMIN" || role === "SUPER_ADMIN";
}

/**
 * Vérifie qu'un site est utilisable par un utilisateur dans un tenant donné,
 * et renvoie le rôle à appliquer. `null` = accès refusé.
 *
 * Utilisé par `/api/switch-site`. Toutes les vérifications sont bornées au
 * tenant passé en argument : c'est ce qui empêche l'escalade inter-tenant.
 */
export async function resolveSiteAccess(
  userId: string,
  tenantId: string,
  siteId: string
): Promise<{ role: Role } | null> {
  // 1. Le site doit exister DANS ce tenant et être actif.
  const site = await prismaBase.site.findFirst({
    where: { id: siteId, tenantId, actif: true },
    select: { id: true },
  });
  if (!site) return null;

   
  const user = await prismaBase.user.findUnique({
    where: { id: userId },
    select: { role: true, tenantId: true },
  });
  if (!user) return null;

  const membership = await prismaBase.userTenant.findFirst({
    where: { userId, tenantId, isActive: true },
    select: { role: true },
  });

  const tenantRole: Role =
    membership?.role ?? (user.tenantId === tenantId ? user.role : ("TEACHER" as Role));

  // 2. Rattachement explicite : le rôle du site fait foi s'il est défini.
  //    Si role = NULL, on hérite du rôle global (tenantRole).
   
  const userSite = await prismaBase.userSite.findFirst({
    where: { userId, siteId },
    select: { role: true },
  });
  if (userSite) return { role: userSite.role ?? tenantRole };

  // 3. Enseignant affecté à ce site, dans ce tenant.
   
  const enseignantSite = await prismaBase.enseignantSite.findFirst({
    where: { siteId, enseignant: { userId, tenantId } },
    select: { id: true },
  });

  if (enseignantSite) return { role: tenantRole };

  // 5. Sans rattachement, seule la direction générale du tenant peut basculer
  //    sur un site arbitraire de son établissement.
  if (isTenantWide(tenantRole)) return { role: tenantRole };

  return null;
}
