"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  KeyRound,
  ArrowLeft,
  Eye,
  EyeOff,
} from "lucide-react";

type Status = "form" | "submitting" | "success" | "error" | "missing";

function SetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const email = searchParams.get("email");
  const [status, setStatus] = useState<Status>(token ? "form" : "missing");
  const [errorMsg, setErrorMsg] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [validationError, setValidationError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setValidationError("");

    if (password.length < 8) {
      setValidationError("Le mot de passe doit faire au moins 8 caractères");
      return;
    }
    if (password !== confirmPassword) {
      setValidationError("Les mots de passe ne correspondent pas");
      return;
    }

    // Vérifier la robustesse côté client
    let categories = 0;
    if (/[a-z]/.test(password)) categories++;
    if (/[A-Z]/.test(password)) categories++;
    if (/[0-9]/.test(password)) categories++;
    if (/[^a-zA-Z0-9]/.test(password)) categories++;
    if (categories < 3) {
      setValidationError(
        "Le mot de passe doit contenir au moins 3 des 4 catégories : minuscules, majuscules, chiffres, caractères spéciaux"
      );
      return;
    }

    setStatus("submitting");
    try {
      const res = await fetch("/api/auth/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setStatus("success");
      } else {
        setStatus("error");
        setErrorMsg(data.error ?? "Échec de la définition du mot de passe");
      }
    } catch {
      setStatus("error");
      setErrorMsg("Erreur réseau. Vérifiez votre connexion.");
    }
  }

  if (status === "missing") {
    return (
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-900 flex items-center justify-center mb-2">
            <KeyRound className="h-6 w-6 text-amber-600 dark:text-amber-400" />
          </div>
          <CardTitle>Lien manquant</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground text-center">
            Aucun token n&rsquo;a été trouvé dans l&rsquo;URL. Utilisez le lien
            complet qui vous a été envoyé après la vérification de votre email.
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

  if (status === "success") {
    return (
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center mb-2">
            <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400" />
          </div>
          <CardTitle>Mot de passe défini !</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground text-center">
            Votre mot de passe a été défini avec succès{email ? <> pour <strong>{email}</strong></> : ""}.
            Vous pouvez maintenant vous connecter à votre espace.
          </p>
          <Button asChild className="w-full">
            <Link href="/login">Se connecter</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (status === "error") {
    return (
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-red-100 dark:bg-red-900 flex items-center justify-center mb-2">
            <XCircle className="h-6 w-6 text-red-600 dark:text-red-400" />
          </div>
          <CardTitle>Échec</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground text-center">
            {errorMsg || "Le lien est invalide ou a expiré."}
          </p>
          <Button asChild variant="outline" className="w-full gap-2">
            <Link href="/forgot-password">
              <KeyRound className="h-4 w-4" />
              Mot de passe oublié
            </Link>
          </Button>
          <Button asChild variant="ghost" className="w-full gap-2">
            <Link href="/login">
              <ArrowLeft className="h-4 w-4" />
              Retour à la connexion
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  // status === "form" or "submitting"
  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-2">
          <KeyRound className="h-6 w-6 text-primary" />
        </div>
        <CardTitle>Définissez votre mot de passe</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground text-center">
          Votre email a été vérifié{email ? <> (<strong>{email}</strong>)</> : ""}.
          Choisissez un mot de passe pour accéder à votre espace.
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="password">
              Mot de passe
            </label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pr-10"
                required
                autoFocus
                disabled={status === "submitting"}
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="confirmPassword">
              Confirmer le mot de passe
            </label>
            <Input
              id="confirmPassword"
              type={showPassword ? "text" : "password"}
              placeholder="••••••••"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              disabled={status === "submitting"}
              autoComplete="new-password"
            />
          </div>
          {validationError && (
            <p className="text-xs text-destructive">{validationError}</p>
          )}
          <Button type="submit" className="w-full" disabled={status === "submitting"}>
            {status === "submitting" ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Définition...
              </>
            ) : (
              "Définir mon mot de passe"
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export default function SetPasswordPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-8 bg-background">
      <Suspense
        fallback={
          <div className="flex items-center justify-center w-full h-full">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        }
      >
        <SetPasswordForm />
      </Suspense>
    </div>
  );
}
