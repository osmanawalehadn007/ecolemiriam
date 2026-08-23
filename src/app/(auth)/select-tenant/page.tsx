import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { TenantSelector } from "@/components/auth/TenantSelector";
import { NoTenantAccess } from "@/components/auth/NoTenantAccess";

export default async function SelectTenantPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const session = await auth();
  const { callbackUrl } = await searchParams;

  if (!session?.user) {
    redirect("/login");
  }

  const tenants = session.user.availableTenants ?? [];

  // SUPER_ADMIN sans tenant : il a sa propre console.
  if (tenants.length === 0 && session.user.role === "SUPER_ADMIN") {
    redirect("/super-admin");
  }

  // 0 tenant et pas SUPER_ADMIN : afficher une page explicite au lieu de
  // reboucler vers /dashboard → /login → /select-tenant (boucle infinie).
  if (tenants.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-indigo-50/30 to-purple-50/30 dark:from-slate-950 dark:via-indigo-950/20 dark:to-purple-950/20 p-4">
        <NoTenantAccess userName={session.user.name} />
      </div>
    );
  }

  // Si l'utilisateur n'a qu'un seul tenant, rediriger directement.
  // Honorer callbackUrl s'il est valide, sinon /dashboard par défaut.
  if (tenants.length === 1) {
    redirect(callbackUrl && callbackUrl.startsWith("/") && !callbackUrl.startsWith("//") ? callbackUrl : "/dashboard");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-indigo-50/30 to-purple-50/30 dark:from-slate-950 dark:via-indigo-950/20 dark:to-purple-950/20 p-4">
      <TenantSelector tenants={tenants} userName={session.user.name} callbackUrl={callbackUrl} />
    </div>
  );
}
