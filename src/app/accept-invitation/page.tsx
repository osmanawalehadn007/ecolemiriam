import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AcceptInvitationForm } from "@/components/auth/AcceptInvitationForm";
import { getInvitationByToken } from "@/lib/invitations-server";

/**
 * Page publique d'acceptation d'une invitation.
 * Accessible sans session (ajoutée à PUBLIC_ROUTES dans le middleware).
 */
export default async function AcceptInvitationPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const t = await getTranslations("invitation");
  const { token } = await searchParams;
  const invitation = await getInvitationByToken(token);

  let reason: string | null = null;
  if (!invitation) {
    reason = t("invalidNotFound");
  } else if (invitation.status === "ACCEPTED") {
    reason = t("invalidUsed");
  } else if (invitation.status === "REVOKED") {
    reason = t("invalidRevoked");
  } else if (invitation.isExpired) {
    reason = t("invalidExpired");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 to-purple-50 dark:from-slate-950 dark:to-slate-900 p-4 py-8">
      <div className="w-full max-w-md">
        {reason || !invitation ? (
          <Card>
            <CardHeader className="text-center">
              <div className="mx-auto w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mb-2">
                <AlertTriangle className="h-6 w-6 text-destructive" />
              </div>
              <CardTitle>{t("invalidTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground text-center">{reason}</p>
              <Button asChild className="w-full">
                <Link href="/login">{t("goToLogin")}</Link>
              </Button>
              <Button asChild variant="outline" className="w-full">
                <Link href="/">{t("backHome")}</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <AcceptInvitationForm
            token={token as string}
            email={invitation.email}
            defaultName={invitation.name ?? ""}
            schoolName={invitation.tenantName}
          />
        )}
      </div>
    </div>
  );
}
