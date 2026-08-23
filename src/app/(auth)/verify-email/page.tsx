"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, XCircle, Loader2, MailCheck, ArrowLeft } from "lucide-react";

type Status = "loading" | "success" | "error" | "missing";

interface VerifyResponse {
  success: boolean;
  email?: string;
  setPasswordToken?: string;
  error?: string;
}

// ─── Formulaire isolé dans un Suspense pour useSearchParams ───────────────────
function VerifyEmailForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [status, setStatus] = useState<Status>(token ? "loading" : "missing");
  const [errorMsg, setErrorMsg] = useState("");
  const [setPasswordToken, setSetPasswordToken] = useState<string | null>(null);
  const [verifiedEmail, setVerifiedEmail] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setStatus("missing");
      return;
    }

    async function verify() {
      try {
        const res = await fetch("/api/auth/verify-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });

        const data: VerifyResponse = await res.json();

        if (res.ok && data.success) {
          setSetPasswordToken(data.setPasswordToken ?? null);
          setVerifiedEmail(data.email ?? null);
          setStatus("success");
        } else {
          setStatus("error");
          setErrorMsg(data.error ?? "Échec de la vérification");
        }
      } catch {
        setStatus("error");
        setErrorMsg("Erreur réseau. Vérifiez votre connexion.");
      }
    }

    verify();
  }, [token]);

  if (status === "loading") {
    return (
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Vérification de votre email...</p>
        </CardContent>
      </Card>
    );
  }

  if (status === "success") {
    const setPwdUrl = setPasswordToken
      ? `/set-password?token=${encodeURIComponent(setPasswordToken)}${verifiedEmail ? `&email=${encodeURIComponent(verifiedEmail)}` : ""}`
      : null;

    return (
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center mb-2">
            <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400" />
          </div>
          <CardTitle>Email vérifié !</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground text-center">
            Votre adresse email a été confirmée avec succès. Pour finaliser votre
            inscription, définissez votre mot de passe de connexion.
          </p>
          {setPwdUrl ? (
            <Button asChild className="w-full">
              <Link href={setPwdUrl}>Définir mon mot de passe</Link>
            </Button>
          ) : (
            <Button asChild className="w-full">
              <Link href="/login">Se connecter</Link>
            </Button>
          )}
          <Button asChild variant="ghost" className="w-full">
            <Link href="/login">Se connecter avec le mot de passe temporaire</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (status === "missing") {
    return (
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-900 flex items-center justify-center mb-2">
            <MailCheck className="h-6 w-6 text-amber-600 dark:text-amber-400" />
          </div>
          <CardTitle>Lien de vérification manquant</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground text-center">
            Aucun token de vérification n&rsquo;a été trouvé dans l&rsquo;URL. Utilisez le lien
            complet qui vous a été envoyé par email.
          </p>
          <Button asChild variant="outline" className="w-full gap-2">
            <Link href="/login">
              <ArrowLeft className="h-4 w-4" />
              Retour à la connexion
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  // status === "error"
  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <div className="mx-auto w-12 h-12 rounded-full bg-red-100 dark:bg-red-900 flex items-center justify-center mb-2">
          <XCircle className="h-6 w-6 text-red-600 dark:text-red-400" />
        </div>
        <CardTitle>Vérification échouée</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground text-center">
          {errorMsg || "Le lien de vérification est invalide ou a expiré."}
        </p>
        <ResendVerification />
        <Button asChild variant="outline" className="w-full gap-2">
          <Link href="/login">
            <ArrowLeft className="h-4 w-4" />
            Retour à la connexion
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function ResendVerification() {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState("");

  async function handleResend(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    setSending(true);
    setErr("");
    try {
      const res = await fetch("/api/auth/send-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (res.ok) {
        setSent(true);
      } else {
        setErr(data.error ?? "Échec de l'envoi");
      }
    } catch {
      setErr("Erreur réseau");
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950 p-4 text-center">
        <p className="text-sm text-green-700 dark:text-green-400">
          Un nouvel email de vérification a été envoyé à <strong>{email}</strong>.
          Vérifiez votre boîte de réception (et vos spams).
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleResend} className="space-y-3 rounded-lg border border-border p-4">
      <p className="text-sm font-medium text-center">Renvoyer un email de vérification</p>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="votre@email.com"
        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        required
      />
      {err && <p className="text-xs text-destructive">{err}</p>}
      <Button type="submit" variant="secondary" className="w-full" disabled={sending}>
        {sending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            Envoi...
          </>
        ) : (
          "Renvoyer l'email"
        )}
      </Button>
    </form>
  );
}

// ─── Page principale avec Suspense (requis par Next.js 15 pour useSearchParams) ─
export default function VerifyEmailPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-8 bg-background">
      <Suspense
        fallback={
          <div className="flex items-center justify-center w-full h-full">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        }
      >
        <VerifyEmailForm />
      </Suspense>
    </div>
  );
}
