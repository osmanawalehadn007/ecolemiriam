"use client";

import { useState, useTransition, Suspense, useCallback } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { z } from "zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Eye, EyeOff, Loader2, Shield, MailWarning, KeyRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { TurnstileWidget } from "@/components/security/TurnstileWidget";

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
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  // Incrémenté après chaque échec : un token Turnstile est à usage unique,
  // le resoumettre garantissait l'échec de toutes les tentatives suivantes.
  const [turnstileReset, setTurnstileReset] = useState(0);
  const [accountDisabled, setAccountDisabled] = useState(false);
  const t = useTranslations("login");
  const isEn = t("title") === "Sign In";

  // Callbacks stables : passées en fonctions fléchées inline, elles
  // remontaient le widget Turnstile à chaque frappe clavier et détruisaient
  // le token déjà obtenu.
  const handleTurnstileToken = useCallback((token: string) => setTurnstileToken(token), []);
  const handleTurnstileCleared = useCallback(() => setTurnstileToken(null), []);

  // Vérifier si l'utilisateur a 2FA activée (après saisie email + password)
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    setAccountDisabled(false);

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
          // 1. Compte désactivé : le mot de passe est bon mais la connexion
          //    échouera. Sans ce cas, l'utilisateur voyait « mot de passe
          //    incorrect » et ressaisissait indéfiniment un mot de passe juste.
          if (data.accountDisabled === true) {
            setAccountDisabled(true);
            setChecking2FA(false);
            return;
          }
          // 2. Vérifier si l'email est vérifié
          if (data.emailVerified === false) {
            setEmailNotVerified(true);
            setChecking2FA(false);
            return;
          }
          // 3. Vérifier si la 2FA est requise
          if (data.requires2FA) {
            setNeed2FA(true);
            setChecking2FA(false);
            return;
          }
        } else if (res.status === 429) {
          // Rate limité — informer l'utilisateur au lieu d'avaler l'erreur
          toast.error(
            isEn
              ? "Too many attempts. Please wait a moment."
              : "Trop de tentatives. Patientez un instant."
          );
          setChecking2FA(false);
          return;
        }
      } catch (err) {
        // Erreur réseau (CSP, timeout, etc.) — on log pour le debug
        // mais on continue vers signIn() qui gérera l'erreur côté NextAuth
        console.warn("[login] 2fa/check-required a échoué:", err);
      }
      setChecking2FA(false);
    }

    startTransition(async () => {
      // `signIn()` fait `fetch(...).then(r => r.json())` en interne. Si une
      // réponse HTML arrive là où du JSON est attendu — page mise en cache
      // par le navigateur ou l'edge, page d'erreur d'un intermédiaire — le
      // `res.json()` lève « Unexpected token '<' ». Sans ce try/catch le
      // rejet traversait la frontière d'erreur de route et faisait tomber
      // toute l'application sur global-error.tsx (« Erreur critique »).
      let result: Awaited<ReturnType<typeof signIn>> | undefined;
      try {
        result = await signIn("credentials", {
          email: form.email,
          password: form.password,
          totp: need2FA ? totp : undefined,
          turnstileToken: turnstileToken ?? undefined,
          redirect: false,
        });
      } catch (err) {
        console.error("[login] signIn a échoué:", err);
        toast.error(
          isEn
            ? "Service temporarily unavailable. Please try again."
            : "Service momentanément indisponible. Réessayez."
        );
        setTotp("");
        // Le token a pu être consommé côté serveur : en redemander un neuf.
        setTurnstileToken(null);
        setTurnstileReset((n) => n + 1);
        return;
      }

      if (result?.error) {
        // `check-required` a déjà validé le mot de passe plus haut. Si on
        // arrive ici, la cause est donc ailleurs — code 2FA erroné le plus
        // souvent. Le message le dit, au lieu d'accuser à tort le mot de passe.
        toast.error(
          need2FA
            ? isEn
              ? "Incorrect verification code"
              : "Code de vérification incorrect"
            : isEn
              ? "Sign-in failed. Please try again."
              : "Connexion impossible. Réessayez."
        );
        setTotp("");
        // Un token Turnstile ne vaut qu'une fois : sans ce reset, toutes les
        // tentatives suivantes échouaient quel que soit le mot de passe.
        setTurnstileToken(null);
        setTurnstileReset((n) => n + 1);
      } else {
        toast.success(isEn ? "Signed in!" : "Connexion réussie !");
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

        {/* Bannière : compte désactivé — le mot de passe est bon, mais la
            connexion ne peut pas aboutir. Sans ce retour explicite, l'écran
            affichait « mot de passe incorrect » et l'utilisateur réessayait
            en boucle un mot de passe pourtant valide. */}
        {accountDisabled && (
          <div className="rounded-lg border-2 border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950 p-4 flex items-start gap-2">
            <Shield className="h-5 w-5 text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-red-900 dark:text-red-200">
                {isEn ? "Account deactivated" : "Compte désactivé"}
              </p>
              <p className="text-xs text-red-700 dark:text-red-300">
                {isEn
                  ? "Your password is correct, but this account has been deactivated. Contact your school administrator."
                  : "Votre mot de passe est correct, mais ce compte a été désactivé. Contactez l'administrateur de votre établissement."}
              </p>
            </div>
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

        {/* Widget Turnstile (anti-bot) — invisible si pas de site key */}
        <TurnstileWidget
          action="login"
          onToken={handleTurnstileToken}
          onExpire={handleTurnstileCleared}
          onError={handleTurnstileCleared}
          resetSignal={turnstileReset}
          className="flex justify-center"
        />

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
