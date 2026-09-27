"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { KeyRound, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { changePassword } from "@/lib/actions/invitations";

/**
 * Formulaire de changement de mot de passe forcé (compte provisionné).
 *
 * Après succès, on déconnecte puis renvoie vers /login : le JWT portait encore
 * `mustChangePassword = true`, une simple redirection rebouclerait sur cette
 * page. Se reconnecter avec le nouveau mot de passe régénère des revendications
 * à jour.
 */
export function ChangePasswordForm() {
  const t = useTranslations("invitation");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (newPassword !== confirm) {
      setError(t("passwordMismatch"));
      return;
    }

    setPending(true);
    try {
      const result = await changePassword({ currentPassword, newPassword });
      if (!result.success) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success(t("changeSuccess"));
      await signOut({ callbackUrl: "/login" });
    } catch {
      setError(t("genericError"));
      toast.error(t("genericError"));
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-primary" />
          {t("changeTitle")}
        </CardTitle>
        <p className="text-sm text-muted-foreground mt-1">{t("changeIntro")}</p>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="current-password">{t("currentPassword")}</Label>
            <Input
              id="current-password"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="new-password">{t("newPassword")}</Label>
            <Input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
            <p className="text-xs text-muted-foreground">{t("passwordHint")}</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="confirm-password">{t("confirmPassword")}</Label>
            <Input
              id="confirm-password"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              required
            />
          </div>

          {error && (
            <p className="text-sm text-destructive" data-testid="change-error">
              {error}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                {t("changeSubmitting")}
              </>
            ) : (
              t("changeSubmit")
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
