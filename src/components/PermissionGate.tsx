"use client";

import { hasPermission } from "@/lib/client-permissions";
import type { Role } from "@prisma/client";

/**
 * Composant qui n'affiche ses enfants que si l'utilisateur a la permission.
 *
 * Usage côté client :
 *
 * <PermissionGate role={userRole} permission="eleves:write">
 *   <Button>Ajouter un élève</Button>
 * </PermissionGate>
 *
 * La vérification est cosmétique — la sécurité reste assurée côté serveur.
 */
export function PermissionGate({
  role,
  permission,
  children,
  fallback = null,
}: {
  role: Role | string | undefined;
  permission: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  if (!hasPermission(role, permission)) return <>{fallback}</>;
  return <>{children}</>;
}
