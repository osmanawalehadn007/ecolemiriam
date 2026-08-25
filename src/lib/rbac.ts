/**
 * École Miriam — Contrôle d'accès basé sur les rôles (RBAC)
 * ============================================================
 * Source unique de vérité pour l'autorisation côté serveur.
 *
 * Modèle : permissions au format "<module>:<action>".
 *   - "*"            → toutes les permissions (super-admin / directeur)
 *   - "<module>:*"   → toutes les actions d'un module
 *   - "<module>:read" / ":write" / ":delete" / ":publish" / ":send" / ":manage"
 *
 * Utilisation dans une route handler :
 *
 *   const gate = await authorize({ permission: "eleves:write" });
 *   if (!gate.ok) return gate.response;
 *   const { tenantId, userId, role } = gate;
 */

import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import type { Role } from "@prisma/client";
import type { Session } from "next-auth";
import { auditFire } from "@/lib/audit";
import prisma from "@/lib/prisma";

export type Permission = string;

// ------------------------------------------------------------
// Matrice des permissions par rôle
// ------------------------------------------------------------
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  // Plateforme École Miriam — accès total (y compris super-admin)
  SUPER_ADMIN: ["*"],

  // Directeur / Propriétaire de l'établissement — tout sauf l'administration plateforme
  TENANT_ADMIN: [
    "eleves:*", "parents:*", "enseignants:*", "classes:*", "matieres:*",
    "notes:*", "evaluations:*", "bulletins:*", "absences:*", "examens:*",
    "emploi-du-temps:*", "communication:*", "messages:*", "vie-scolaire:*",
    "admissions:*", "rh:*", "finance:*", "inventaire:*", "alumni:*",
    "orientation:*", "cours:*", "analytics:*", "rapports:*", "documents:*",
    "ai:*", "audit:read", "parametres:*", "structures:*",
    "cahier-texte:*", "export:full",
    "fournitures:*",
  ],

  // Chef d'établissement — pédagogie & vie scolaire complètes, pas la finance/RH en écriture
  PRINCIPAL: [
    "eleves:*", "parents:*", "enseignants:*", "classes:*", "matieres:*",
    "notes:*", "evaluations:*", "bulletins:*", "absences:*", "examens:*",
    "emploi-du-temps:*", "communication:*", "messages:*", "vie-scolaire:*",
    "admissions:*", "rh:read", "finance:read", "inventaire:*", "alumni:*",
    "orientation:*", "cours:*", "analytics:*", "rapports:*", "documents:*",
    "ai:*", "parametres:read", "structures:read",
    "cahier-texte:*",
    "fournitures:*",
  ],

  // Secrétariat — gestion administrative
  SECRETARY: [
    "eleves:*", "parents:*", "classes:read", "matieres:read",
    "absences:*", "emploi-du-temps:*", "communication:read", "communication:send",
    "messages:*", "admissions:*", "examens:read", "inventaire:read",
    "documents:*", "alumni:read", "bulletins:read", "rapports:read",
    "parametres:read", "structures:read",
    "cahier-texte:read",
    "fournitures:read", "fournitures:write", "fournitures:validate", "fournitures:publish",
  ],

  // Enseignant — sa pédagogie
  TEACHER: [
    "eleves:read", "classes:read", "matieres:read",
    "notes:*", "evaluations:*", "absences:read", "absences:write",
    "bulletins:read", "emploi-du-temps:read", "messages:*",
    "cours:*", "analytics:read", "examens:read", "ai:teacher",
    "cahier-texte:*",
    "fournitures:read", "fournitures:write",
  ],

  // Professeur principal — enseignant + bulletins/conseil + vie scolaire
  CLASS_TEACHER: [
    "eleves:read", "classes:read", "matieres:read",
    "notes:*", "evaluations:*", "absences:*",
    "bulletins:read", "bulletins:write", "bulletins:publish",
    "emploi-du-temps:read", "messages:*", "cours:*",
    "vie-scolaire:*", "orientation:read", "orientation:write",
    "analytics:read", "examens:read", "parents:read", "ai:teacher",
    "cahier-texte:*",
    "fournitures:read", "fournitures:write",
  ],

  // Conseiller / CPE — vie scolaire, orientation, cahier de texte & modification emploi du temps
  COUNSELOR: [
    "eleves:read", "absences:read", "vie-scolaire:*", "orientation:*",
    "messages:*", "parents:read", "communication:read", "analytics:read",
    "emploi-du-temps:read", "emploi-du-temps:write",
    "cahier-texte:read",
  ],

  // Infirmier(e) — consultation santé/élèves
  NURSE: [
    "eleves:read", "absences:read", "messages:read", "messages:write",
  ],

  // Comptable — finance, paie & admissions (procédure jusqu'à ADMIS, INSCRIT réservé au directeur)
  ACCOUNTANT: [
    "finance:*", "rh:*", "eleves:read", "parents:read", "inventaire:*",
    "analytics:read", "messages:*", "rapports:read",
    "admissions:read", "admissions:write",
  ],

  // Parent — consultation de son périmètre (lecture seule + messagerie)
  PARENT: [
    "bulletins:read", "absences:read", "notes:read", "messages:*",
    "communication:read", "cours:read", "orientation:read",
    "emploi-du-temps:read", "ai:parent",
    "fournitures:read",
  ],

  // Élève — consultation de son périmètre (lecture seule + messagerie limitée)
  // Un élève peut lire et répondre dans une conversation où il est déjà participant,
  // mais ne peut pas initier de nouvelle conversation (règle École360).
  STUDENT: [
    "bulletins:read", "absences:read", "notes:read",
    "messages:read", "messages:reply",
    "communication:read", "cours:*", "emploi-du-temps:read",
    "fournitures:read",
  ],
};

// ------------------------------------------------------------
// Vérification de permission
// ------------------------------------------------------------
export function roleHasPermission(role: Role, permission: Permission): boolean {
  const perms = ROLE_PERMISSIONS[role] ?? [];
  if (perms.includes("*")) return true;
  if (perms.includes(permission)) return true;
  const moduleName = permission.split(":")[0];
  if (perms.includes(`${moduleName}:*`)) return true;
  return false;
}

// ------------------------------------------------------------
// Cache en mémoire des permissions personnalisées par utilisateur
// (évite une requête DB à chaque check de permission)
// ------------------------------------------------------------
interface CachedPerms {
  grants: Set<string>;
  denies: Set<string>;
  expiresAt: number;
}
const userPermsCache = new Map<string, CachedPerms>();
const PERMS_CACHE_TTL = 30_000; // 30 secondes

/**
 * Récupère les permissions personnalisées d'un utilisateur depuis la base,
 * avec un cache en mémoire de 30s pour éviter les requêtes répétées.
 */
async function getUserCustomPerms(userId: string, tenantId: string): Promise<{ grants: Set<string>; denies: Set<string> }> {
  const cacheKey = `${userId}:${tenantId}`;
  const cached = userPermsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { grants: cached.grants, denies: cached.denies };
  }

  const rows = await prisma.userPermission.findMany({
    where: { userId, tenantId },
    select: { permission: true, mode: true },
  });

  const grants = new Set<string>();
  const denies = new Set<string>();
  for (const r of rows) {
    if (r.mode === "deny") denies.add(r.permission);
    else grants.add(r.permission);
  }

  userPermsCache.set(cacheKey, { grants, denies, expiresAt: Date.now() + PERMS_CACHE_TTL });
  return { grants, denies };
}

/**
 * Invalide le cache des permissions pour un utilisateur (à appeler après modification).
 */
export function invalidateUserPermsCache(userId: string, tenantId: string): void {
  userPermsCache.delete(`${userId}:${tenantId}`);
}

/**
 * Vérifie si un utilisateur a une permission, en tenant compte :
 *   1. Des permissions de son rôle (ROLE_PERMISSIONS)
 *   2. Des surcharges personnalisées (UserPermission : grant/deny)
 *
 * Logique :
 *   - Si le rôle accorde la permission ET qu'il n'y a pas de deny → OK
 *   - Si le rôle n'accorde pas la permission mais qu'il y a un grant → OK
 *   - Si le rôle accorde la permission mais qu'il y a un deny → refusé
 *   - SUPER_ADMIN : toujours OK (non surchargeable)
 */
export async function userHasPermission(
  userId: string,
  role: Role,
  tenantId: string,
  permission: Permission
): Promise<boolean> {
  // SUPER_ADMIN : accès total non surchargeable
  if (role === "SUPER_ADMIN") return true;

  const roleGrants = roleHasPermission(role, permission);
  const { grants, denies } = await getUserCustomPerms(userId, tenantId);

  // Un deny explicite l'emporte toujours
  if (denies.has(permission)) return false;
  // Un deny sur le module entier (module:*) bloque aussi
  const moduleName = permission.split(":")[0];
  if (denies.has(`${moduleName}:*`)) return false;

  // Un grant explicite accorde même si le rôle ne l'a pas
  if (grants.has(permission)) return true;
  if (grants.has(`${moduleName}:*`)) return true;

  // Sinon, fallback sur le rôle
  return roleGrants;
}

// ------------------------------------------------------------
// Garde d'autorisation pour les route handlers
// ------------------------------------------------------------
type AuthSuccess = {
  ok: true;
  session: Session;
  userId: string;
  tenantId: string;
  role: Role;
};
type AuthFailure = { ok: false; response: NextResponse };

export interface AuthorizeOptions {
  /** Permission(s) requise(s). Si plusieurs, une seule suffit (OU logique). */
  permission?: Permission | Permission[];
  /** Exiger un tenantId (défaut : true). Les SUPER_ADMIN en sont exemptés. */
  requireTenant?: boolean;
}

/**
 * Authentifie + autorise une requête API.
 * Retourne une union discriminée : tester `gate.ok` avant d'accéder aux données.
 */
export async function authorize(
  opts: AuthorizeOptions = {}
): Promise<AuthSuccess | AuthFailure> {
  const session = await auth();

  if (!session?.user?.id) {
    auditFire({
      action: "auth:check",
      verdict: "DENIED",
      reason: "Non authentifié",
    });
    return {
      ok: false,
      response: NextResponse.json({ error: "Non authentifié" }, { status: 401 }),
    };
  }

  const role = session.user.role;
  const tenantId = session.user.tenantId;
  const requireTenant = opts.requireTenant ?? true;

  if (requireTenant && !tenantId && role !== "SUPER_ADMIN") {
    auditFire({
      userId: session.user.id,
      action: "auth:check",
      verdict: "DENIED",
      reason: "Aucun établissement associé au compte",
      metadata: { requiredPermissions: opts.permission },
    });
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Aucun établissement associé au compte" },
        { status: 403 }
      ),
    };
  }

  if (opts.permission) {
    const needed = Array.isArray(opts.permission)
      ? opts.permission
      : [opts.permission];
    // Utiliser userHasPermission pour tenir compte des surcharges personnalisées
    const checks = await Promise.all(
      needed.map((p) =>
        tenantId
          ? userHasPermission(session.user.id, role, tenantId, p)
          : roleHasPermission(role, p)
      )
    );
    const allowed = checks.some(Boolean);
    if (!allowed) {
      auditFire({
        userId: session.user.id,
        tenantId: tenantId ?? null,
        action: "auth:check",
        verdict: "DENIED",
        resource: needed.join(","),
        reason: "Privilèges insuffisants",
        metadata: { role, requiredPermissions: needed },
      });
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Accès refusé : privilèges insuffisants" },
          { status: 403 }
        ),
      };
    }
  }

  return {
    ok: true,
    session,
    userId: session.user.id,
    tenantId: (tenantId ?? "") as string,
    role,
  };
}

/**
 * Garde légère pour les routes qui conservent leur propre `await auth()`.
 * Retourne une réponse 403 si le rôle n'a pas la permission, sinon `null`.
 *
 *   const denied = checkPermission(session.user.role, "eleves:write");
 *   if (denied) return denied;
 *
 * Note : cette fonction est SYNCHRONE et ne vérifie que les permissions du
 * rôle, sans tenir compte des surcharges personnalisées. Pour une vérification
 * complète incluant les permissions personnalisées, utiliser
 * `checkPermissionAsync()`.
 */
export function checkPermission(
  role: Role,
  permission: Permission
): NextResponse | null {
  if (!roleHasPermission(role, permission)) {
    auditFire({
      action: "auth:check",
      verdict: "DENIED",
      resource: permission,
      reason: "Privilèges insuffisants",
      metadata: { role },
    });
    return NextResponse.json(
      { error: "Accès refusé : privilèges insuffisants" },
      { status: 403 }
    );
  }
  return null;
}

/**
 * Garde ASYNCHRONE qui tient compte des permissions personnalisées.
 * À utiliser dans les routes qui font déjà `await auth()` :
 *
 *   const denied = await checkPermissionAsync(session, "eleves:write");
 *   if (denied) return denied;
 */
export async function checkPermissionAsync(
  session: Session,
  permission: Permission
): Promise<NextResponse | null> {
  const role = session.user.role as Role;
  const tenantId = session.user.tenantId ?? "";

  // SUPER_ADMIN : toujours OK
  if (role === "SUPER_ADMIN") return null;

  const allowed = tenantId
    ? await userHasPermission(session.user.id, role, tenantId, permission)
    : roleHasPermission(role, permission);

  if (!allowed) {
    auditFire({
      userId: session.user.id,
      tenantId: tenantId || null,
      action: "auth:check",
      verdict: "DENIED",
      resource: permission,
      reason: "Privilèges insuffisants",
      metadata: { role },
    });
    return NextResponse.json(
      { error: "Accès refusé : privilèges insuffisants" },
      { status: 403 }
    );
  }
  return null;
}

/** Réservé aux administrateurs de la plateforme École Miriam. */
export async function authorizeSuperAdmin(): Promise<AuthSuccess | AuthFailure> {
  const session = await auth();
  if (!session?.user?.id) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Non authentifié" }, { status: 401 }),
    };
  }
  if (session.user.role !== "SUPER_ADMIN") {
    auditFire({
      userId: session.user.id,
      action: "auth:super-admin",
      verdict: "DENIED",
      reason: "Rôle non super-admin",
      metadata: { role: session.user.role },
    });
    return {
      ok: false,
      response: NextResponse.json({ error: "Accès refusé" }, { status: 403 }),
    };
  }
  return {
    ok: true,
    session,
    userId: session.user.id,
    tenantId: (session.user.tenantId ?? "") as string,
    role: session.user.role,
  };
}
