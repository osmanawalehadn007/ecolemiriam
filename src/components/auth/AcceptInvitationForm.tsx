"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { CheckCircle2, Loader2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { acceptInvitation } from "@/lib/actions/invitations";

interface Props {
  token: string;
  email: string;
  defaultName: string;
  schoolName: string;
}

/** Politique locale (miroir) — évite d'importer un module Node dans le bundle client. */
function passwordIssue(password: string): boolean {
  return password.length < 10 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password);
}

export function AcceptInvitationForm({ token, email, defaultName, schoolName }: Props) {
  const t = useTranslations("invitation");
  const [name, setName] = useState(defaultName);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError(t("name"));
      return;
    }
    if (passwordIssue(password)) {
      setError(t("passwordHint"));
      return;
    }
    if (password !== confirm) {
      setError(t("passwordMismatch"));
      return;
    }

    setPending(true);
    try {
      const result = await acceptInvitation({ token, name: name.trim(), password });
      if (!result.success) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      setDone(true);
      toast.success(t("acceptSuccessTitle"));
    } catch {
      setError(t("genericError"));
      toast.error(t("genericError"));
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <Card>
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center mb-2">
            <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400" />
          </div>
          <CardTitle>{t("acceptSuccessTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground text-center">{t("acceptSuccessMsg")}</p>
          <Button asChild className="w-full" data-testid="go-to-login">
            <Link href="/login">{t("goToLogin")}</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserPlus className="h-5 w-5 text-primary" />
          {t("acceptTitle")}
        </CardTitle>
        <p className="text-sm text-muted-foreground mt-1">
          {t("acceptIntro", { school: schoolName })}
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="invite-email">{t("email")}</Label>
            <Input id="invite-email" type="email" value={email} readOnly disabled />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="invite-name">{t("name")}</Label>
            <Input
              id="invite-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("namePlaceholder")}
              autoComplete="name"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="invite-password">{t("password")}</Label>
            <Input
              id="invite-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("passwordPlaceholder")}
              autoComplete="new-password"
              required
            />
            <p className="text-xs text-muted-foreground">{t("passwordHint")}</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="invite-confirm">{t("confirmPassword")}</Label>
            <Input
              id="invite-confirm"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder={t("passwordPlaceholder")}
              autoComplete="new-password"
              required
            />
          </div>

          {error && (
            <p className="text-sm text-destructive" data-testid="accept-error">
              {error}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                {t("acceptSubmitting")}
              </>
            ) : (
              t("acceptSubmit")
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
