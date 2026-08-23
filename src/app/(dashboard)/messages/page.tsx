import { auth } from "@/lib/auth";
import { guardPage } from "@/lib/guard-page";
import { redirect } from "next/navigation";
import { Header } from "@/components/layout/Header";
import { MessagerieView } from "@/components/messages/MessagerieView";
import { getTranslations } from "next-intl/server";

export default async function MessagesPage() {
  const [session, t] = await Promise.all([
    auth(),
    getTranslations("messages"),
  ]);
  if (!session?.user?.tenantId) redirect("/select-tenant");
  guardPage(session, "messages:read");

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <Header
        title={t("title")}
        subtitle={t("subtitle")}
        userName={session.user.name}
        userAvatar={session.user.image ?? undefined}
      />
      <div className="flex-1 overflow-hidden">
        <MessagerieView userRole={session.user.role} />
      </div>
    </div>
  );
}
