"use client";

import { useState, useTransition, Suspense } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { z } from "zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Eye, EyeOff, Loader2, Shield, MailWarning, KeyRound } from "lucide-react";
import { useTranslations } from "next-intl";

const LoginSchema = z.object({
  email: z.string().email("Email invalide"),
  password: z.string().min(6, "Mot de passe trop court"),
});

// ─── Formulaire isolé dans un Suspense pour useSearchParams ───────────────────
function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/dashboard";
  const [isPending, startTransition] = useTransition();
  const [showPassword, setShowPassword] = useState(false);
  const [form, setForm] = useState({ email: "", password: "" });
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [totp, setTotp] = useState("");
  const [need2FA, setNeed2FA] = useState(false);
  const [checking2FA, setChecking2FA] = useState(false);
  const [emailNotVerified, setEmailNotVerified] = useState(false);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const t = useTranslations("login");

  // Vérifier si l'utilisateur a 2FA activée (après saisie email + password)
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});

    const parsed = LoginSchema.safeParse(form);
    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors;
      setErrors({
        email: fieldErrors.email?.[0],
        password: fieldErrors.password?.[0],
      });
      return;
    }

    // Si on n'a pas encore demandé le code 2FA, vérifier si l'utilisateur
    // a besoin de 2FA ou si son email n'est pas vérifié.
    // Cette vérification se fait AVANT signIn() car NextAuth v5 ne propage
    // pas le message d'erreur de authorize() au client.
    if (!need2FA) {
      setChecking2FA(true);
      try {
        const res = await fetch("/api/auth/2fa/check-required", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: form.email, password: form.password }),
        });
        if (res.ok) {
          const data = await res.json();
          // 1. Vérifier si l'email est vérifié (avant tout)
          if (data.emailVerified === false) {
            setEmailNotVerified(true);
            setChecking2FA(false);
            return;
          }
          // 2. Vérifier si la 2FA est requise
          if (data.requires2FA) {
            setNeed2FA(true);
            setChecking2FA(false);
            return;
          }
        }
      } catch {
        // si la vérification échoue, on continue normalement
      }
      setChecking2FA(false);
    }

    startTransition(async () => {
      const result = await signIn("credentials", {
        email: form.email,
        password: form.password,
        totp: need2FA ? totp : undefined,
        redirect: false,
      });

      if (result?.error) {
        toast.error(t("title") === "Sign In" ? "Invalid email or password" : "Email ou mot de passe incorrect");
        // Réinitialiser le code 2FA en cas d'erreur
        setTotp("");
      } else {
        toast.success(t("title") === "Sign In" ? "Signed in!" : "Connexion réussie !");
        // Préserver callbackUrl à travers /select-tenant pour que
        // l'utilisateur atterrisse sur la page demandée, pas /dashboard.
        const dest = callbackUrl && callbackUrl !== "/" ? `/select-tenant?callbackUrl=${encodeURIComponent(callbackUrl)}` : "/select-tenant";
        window.location.href = dest;
      }
    });
  }

  // Renvoyer l'email de vérification
  async function handleResendVerification() {
    if (!form.email) return;
    setResending(true);
    setResent(false);
    try {
      const res = await fetch("/api/auth/send-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.email }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        if (data.alreadyVerified) {
          toast.success(t("title") === "Sign In" ? "Your email is already verified. You can sign in." : "Votre email est déjà vérifié. Vous pouvez vous connecter.");
          setEmailNotVerified(false);
        } else {
          setResent(true);
          toast.success(t("title") === "Sign In" ? "Verification email sent" : "Email de vérification renvoyé");
        }
      } else {
        toast.error(data.error ?? "Échec de l'envoi");
      }
    } catch {
      toast.error("Erreur réseau");
    } finally {
      setResending(false);
    }
  }

  return (
    <div className="w-full max-w-md">
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {t("subtitle")}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Email */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium" htmlFor="email">
            {t("email")}
          </label>
          <Input
            id="email"
            type="email"
            placeholder="admin@monecole.sn"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            className={errors.email ? "border-destructive" : ""}
            disabled={isPending || checking2FA}
            autoComplete="email"
          />
          {errors.email && (
            <p className="text-xs text-destructive">{errors.email}</p>
          )}
        </div>

        {/* Mot de passe */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium" htmlFor="password">
              {t("password")}
            </label>
            <Link
              href="/forgot-password"
              className="text-xs text-muted-foreground hover:text-primary transition-colors flex items-center gap-1"
            >
              <KeyRound className="h-3 w-3" />
              {t("forgotPassword") ?? "Mot de passe oublié ?"}
            </Link>
          </div>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              placeholder="••••••••"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className={errors.password ? "border-destructive pr-10" : "pr-10"}
              disabled={isPending || checking2FA}
              autoComplete="current-password"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {errors.password && (
            <p className="text-xs text-destructive">{errors.password}</p>
          )}
        </div>

        {/* Champ 2FA (affiché si besoin) */}
        {need2FA && (
          <div className="space-y-1.5 rounded-lg border-2 border-primary/30 bg-primary/5 p-4">
            <label className="text-sm font-medium flex items-center gap-2" htmlFor="totp">
              <Shield className="h-4 w-4 text-primary" />
              Code de vérification (2FA)
            </label>
            <p className="text-xs text-muted-foreground mb-2">
              Saisissez le code à 6 chiffres de votre application d&rsquo;authentification
            </p>
            <Input
              id="totp"
              value={totp}
              onChange={(e) => setTotp(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="123456"
              className="text-center text-2xl tracking-widest font-mono"
              inputMode="numeric"
              maxLength={6}
              disabled={isPending}
              autoFocus
            />
          </div>
        )}

        {/* Bannière : email non vérifié */}
        {emailNotVerified && (
          <div className="space-y-3 rounded-lg border-2 border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950 p-4">
            <div className="flex items-start gap-2">
              <MailWarning className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                  {t("title") === "Sign In" ? "Email not verified" : "Email non vérifié"}
                </p>
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  {t("title") === "Sign In"
                    ? "Check your inbox (and spam) for the verification link, or resend it below."
                    : "Vérifiez votre boîte de réception (et vos spams) pour le lien de vérification, ou renvoyez-le ci-dessous."}
                </p>
              </div>
            </div>
            {resent ? (
              <p className="text-xs text-green-700 dark:text-green-400 font-medium pl-7">
                {t("title") === "Sign In" ? "Verification email sent! Check your inbox." : "Email de vérification envoyé ! Vérifiez votre boîte de réception."}
              </p>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full border-amber-400 text-amber-700 hover:bg-amber-100 dark:border-amber-600 dark:text-amber-300"
                onClick={handleResendVerification}
                disabled={resending}
              >
                {resending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    {t("title") === "Sign In" ? "Sending..." : "Envoi..."}
                  </>
                ) : (
                  t("title") === "Sign In" ? "Resend verification email" : "Renvoyer l'email de vérification"
                )}
              </Button>
            )}
          </div>
        )}

        <Button
          type="submit"
          className="w-full h-11 font-semibold"
          disabled={isPending || checking2FA || (need2FA && totp.length !== 6)}
        >
          {isPending || checking2FA ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              {checking2FA ? "Vérification..." : t("signingIn")}
            </>
          ) : need2FA ? (
            t("title") === "Sign In" ? "Verify & Sign In" : "Vérifier et se connecter"
          ) : (
            t("signIn")
          )}
        </Button>
      </form>
    </div>
  );
}

// ─── Page principale avec Suspense (requis par Next.js 15 pour useSearchParams) ─
export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-8 bg-background">
      <Suspense fallback={
        <div className="flex items-center justify-center w-full h-full">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      }>
        <LoginForm />
      </Suspense>
    </div>
  );
}
