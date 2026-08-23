import { auth } from "@/lib/auth";
import { guardPage } from "@/lib/guard-page";
import { redirect } from "next/navigation";
import { Header } from "@/components/layout/Header";
import { OrientationView } from "@/components/orientation/OrientationView";
import { getTranslations } from "next-intl/server";

export default async function OrientationPage() {
  const [session, t] = await Promise.all([
    auth(),
    getTranslations("orientation"),
  ]);
  if (!session?.user?.tenantId) redirect("/select-tenant");
  guardPage(session, "orientation:read");
  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <Header
        title={t("title")}
        subtitle={t("subtitle")}
        userName={session.user.name}
        userAvatar={session.user.image ?? undefined}
      />
      <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
        <OrientationView />
      </div>
    </div>
  );
}
