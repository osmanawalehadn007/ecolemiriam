import { guardPage } from "@/lib/guard-page";
import { auth } from "@/lib/auth";
import { guardPage } from "@/lib/guard-page";
import { redirect, notFound } from "next/navigation";
import { Header } from "@/components/layout/Header";
import { FactureDetail } from "@/components/facturation/FactureDetail";
import { getFactureForDetail } from "@/lib/actions/facture";

export default async function FactureDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.tenantId) redirect("/select-tenant");
  if (!session?.user?.tenantId) redirect("/login");
  guardPage(session, "finance:read");

  const { id } = await params;
  const facture = await getFactureForDetail(id);

  if (!facture) notFound();

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <Header
        title={`Facture ${facture.numero}`}
        subtitle={facture.libelle}
        userName={session.user.name}
        userAvatar={session.user.image ?? undefined}
      />
      <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
        <FactureDetail facture={facture} userRole={session.user.role} />
      </div>
    </div>
  );
}
