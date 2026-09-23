import { auth } from "@/lib/auth";
import { guardRoles } from "@/lib/guard-page";

/**
 * `page.tsx` est un composant **client** (formulaires de test) : la garde est
 * donc posée au niveau du segment de route, qui est un Server Component. Le
 * rôle est celui des routes `/api/test/*` correspondantes (`authorizeSuperAdmin`).
 */
export default async function TestTelegramLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  guardRoles(session, ["SUPER_ADMIN"]);
  return <>{children}</>;
}