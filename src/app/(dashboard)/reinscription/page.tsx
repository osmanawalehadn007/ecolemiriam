import { auth } from "@/lib/auth";
import { guardPage } from "@/lib/guard-page";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Header } from "@/components/layout/Header";
import { ReinscriptionView } from "@/components/reinscription/ReinscriptionView";
import { preparerApercuReinscription } from "@/lib/actions/reinscription";
import type { Role } from "@prisma/client";

export default async function ReinscriptionPage() {
  const session = await auth();
  if (!session?.user?.tenantId) redirect("/select-tenant");
  guardPage(session, ["eleves:write", "finance:write"]);

  const t = await getTranslations("reinscription");

  const apercu = await preparerApercuReinscription();

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <Header
        title={t("title")}
        subtitle={t("subtitle")}
        userName={session.user.name}
        userAvatar={session.user.image ?? undefined}
      />
      <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
        <ReinscriptionView
          apercu={apercu}
          userRole={session.user.role as Role}
        />
      </div>
    </div>
  );
}
