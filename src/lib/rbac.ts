/**
 * EcolPro — Contrôle d'accès basé sur les rôles (RBAC)
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

// ------------------------------------------------------------
// Cœur pur extrait dans `./rbac-matrix` : le type `Permission`, la matrice
// `ROLE_PERMISSIONS` et `roleHasPermission` n'ont AUCUN import runtime
// (auth, audit, Prisma) et sont donc importables depuis le bundle client
// (`Sidebar` → `menu.ts`). Tout est ré-exporté ici : les imports existants
// vers `@/lib/rbac` restent valides.
// ------------------------------------------------------------
import { roleHasPermission, type Permission } from "./rbac-matrix";
export { ROLE_PERMISSIONS, roleHasPermission } from "./rbac-matrix";
export type { Permission };



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
    const allowed = needed.some((p) => roleHasPermission(role, p));
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
 * Variante de {@link checkPermission} pour une action couverte par **plusieurs**
 * modules (OU logique) : générer un bulletin de paie, par exemple, que la
 * direction tient de `rh:write` et le comptable de `paie:write` — deux métiers,
 * deux permissions, une seule route.
 *
 *   const denied = checkAnyPermission(session.user.role, ["rh:write", "paie:write"]);
 *   if (denied) return denied;
 */
export function checkAnyPermission(
  role: Role,
  permissions: Permission[]
): NextResponse | null {
  if (permissions.some((permission) => roleHasPermission(role, permission))) {
    return null;
  }
  auditFire({
    action: "auth:check",
    verdict: "DENIED",
    resource: permissions.join(","),
    reason: "Privilèges insuffisants",
    metadata: { role },
  });
  return NextResponse.json(
    { error: "Accès refusé : privilèges insuffisants" },
    { status: 403 }
  );
}


/** Réservé aux administrateurs de la plateforme EcolPro. */
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
