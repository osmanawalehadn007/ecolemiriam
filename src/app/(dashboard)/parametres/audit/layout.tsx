import { auth } from "@/lib/auth";
import { guardRoles } from "@/lib/guard-page";

/**
 * La page est un composant **client** : sa vérification de rôle s'exécute après
 * le rendu. Cette garde de segment (Server Component) ferme l'écart — la route
 * `/api/audit` reste par ailleurs la protection réelle des données.
 */
export default async function AuditLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  guardRoles(session, ["SUPER_ADMIN", "TENANT_ADMIN"]);
  return <>{children}</>;
}