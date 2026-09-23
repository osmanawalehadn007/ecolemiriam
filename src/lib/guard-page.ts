import { redirect } from "next/navigation";
import { roleHasPermission, type Permission } from "@/lib/rbac";
import { isRelationScopedRole } from "@/lib/site-scope";
import type { Role } from "@prisma/client";
import type { Session } from "next-auth";

/**
 * Garde d'autorisation pour les Server Components (pages dashboard).
 * Vérifie l'authentification, le tenantId et les permissions RBAC.
 * Redirige vers /login si non authentifié, /select-tenant si pas de tenant,
 * ou /dashboard si permission insuffisante.
 *
 * @example
 * const session = await auth();
 * guardPage(session, "facturation:read");
 */
export function guardPage(
  session: Session | null,
  permission?: Permission | Permission[]
): { tenantId: string; userId: string; role: Role; session: Session } {
  if (!session?.user?.id) {
    redirect("/login");
  }

  if (!session.user.tenantId && session.user.role !== "SUPER_ADMIN") {
    redirect("/select-tenant");
  }

  if (permission) {
    const role = session.user.role as Role;
    const needed = Array.isArray(permission) ? permission : [permission];
    const allowed = needed.some((p) => roleHasPermission(role, p));
    if (!allowed) {
      redirect("/dashboard");
    }
  }

  return {
    tenantId: (session.user.tenantId ?? "") as string,
    userId: session.user.id,
    role: session.user.role as Role,
    session,
  };
}

/**
 * Garde de **rôle** explicite, pour les écrans qui ne se décrivent pas par une
 * permission métier : paramètres de l'établissement, outils de développement.
 * Applique d'abord les contrôles de `guardPage` (authentification + tenant),
 * puis redirige si le rôle n'est pas dans la liste.
 *
 * @example
 * guardRoles(session, ["TENANT_ADMIN", "PRINCIPAL", "SUPER_ADMIN"]);
 */
export function guardRoles(
  session: Session | null,
  roles: Role[]
): { tenantId: string; userId: string; role: Role; session: Session } {
  const ctx = guardPage(session);
  if (!roles.includes(ctx.role)) {
    redirect("/dashboard");
  }
  return ctx;
}

/**
 * Écran de **personnel** : refuse les rôles à périmètre personnel
 * (`PARENT` / `STUDENT`). Réservé aux écrans qui n'ont pas de sens bornés à un
 * élève — grilles de saisie, listes nominatives de classe, suivi global des
 * absences — et qui ne peuvent donc pas être rattrapés par un simple `where`.
 *
 * Un « espace famille » se conçoit comme un **module dédié** appliquant
 * `eleveScopeFilter`, jamais comme une exception à cette garde.
 *
 * @example
 * guardStaff(session, "notes:read");
 */
export function guardStaff(
  session: Session | null,
  permission?: Permission | Permission[]
): { tenantId: string; userId: string; role: Role; session: Session } {
  const ctx = guardPage(session, permission);
  if (isRelationScopedRole(ctx.role)) {
    redirect("/dashboard");
  }
  return ctx;
}
