"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, MailCheck, ArrowLeft, KeyRound } from "lucide-react";
import { TurnstileWidget } from "@/components/security/TurnstileWidget";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState("");
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  // Un token Turnstile est à usage unique : après un échec il faut en
  // redemander un neuf, sinon chaque nouvel essai échoue à son tour.
  const [turnstileReset, setTurnstileReset] = useState(0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    setSending(true);
    setErr("");
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, turnstileToken }),
      });
      const data = await res.json();
      if (res.ok) {
        setSent(true);
      } else {
        setErr(data.error ?? "Échec de l'envoi");
        setTurnstileToken(null);
        setTurnstileReset((n) => n + 1);
      }
    } catch {
      setErr("Erreur réseau. Vérifiez votre connexion.");
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8 bg-background">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center mb-2">
              <MailCheck className="h-6 w-6 text-green-600 dark:text-green-400" />
            </div>
            <CardTitle>Email envoyé</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground text-center">
              Si un compte existe avec l&rsquo;adresse <strong>{email}</strong>,
              un email de réinitialisation vous a été envoyé. Vérifiez votre boîte
              de réception (et vos spams). Le lien est valable 1 heure.
            </p>
            <Button asChild variant="outline" className="w-full gap-2">
              <Link href="/login">
                <ArrowLeft className="h-4 w-4" />
                Retour à la connexion
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-8 bg-background">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-2">
            <KeyRound className="h-6 w-6 text-primary" />
          </div>
          <CardTitle>Mot de passe oublié</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground text-center">
            Saisissez votre adresse email. Vous recevrez un lien pour définir un
            nouveau mot de passe.
          </p>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="email">
                Email
              </label>
              <Input
                id="email"
                type="email"
                placeholder="votre@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
            </div>
            {err && <p className="text-xs text-destructive">{err}</p>}
            {/* Widget Turnstile (anti-bot) — invisible si pas de site key */}
            <TurnstileWidget
              action="forgot-password"
              resetSignal={turnstileReset}
              onToken={setTurnstileToken}
              onExpire={() => setTurnstileToken(null)}
              onError={() => setTurnstileToken(null)}
              className="flex justify-center"
            />
            <Button type="submit" className="w-full" disabled={sending}>
              {sending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Envoi...
                </>
              ) : (
                "Envoyer le lien de réinitialisation"
              )}
            </Button>
          </form>
          <Button asChild variant="outline" className="w-full gap-2">
            <Link href="/login">
              <ArrowLeft className="h-4 w-4" />
              Retour à la connexion
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
