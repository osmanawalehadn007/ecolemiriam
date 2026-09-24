import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Header } from "@/components/layout/Header";
import { Security2FA } from "@/components/parametres/Security2FA";

export default async function SecurityPage() {
  const [session, t] = await Promise.all([
    auth(),
    getTranslations("parametres"),
  ]);

  if (!session?.user) redirect("/login");

  return (
    <div className="flex flex-col h-full">
      <Header
        title={t("security")}
        subtitle={t("securitySubtitle")}
        userName={session.user.name}
        userAvatar={session.user.image ?? undefined}
      />
      <div className="flex-1 overflow-y-auto p-6">
        <Security2FA />
      </div>
    </div>
  );
}
