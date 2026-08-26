"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useRouter } from "next/navigation";
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

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token");
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
      setValidationError(
        "Le mot de passe est trop court : il doit obligatoirement contenir au moins 8 caractères."
      );
      return;
    }
    if (password !== confirmPassword) {
      setValidationError("Les mots de passe ne correspondent pas");
      return;
    }

    // Vérifier la robustesse côté client
    const hasLower = /[a-z]/.test(password);
    const hasUpper = /[A-Z]/.test(password);
    const hasDigit = /[0-9]/.test(password);
    const hasSpecial = /[^a-zA-Z0-9]/.test(password);
    const categories = [hasLower, hasUpper, hasDigit, hasSpecial].filter(Boolean).length;
    if (categories < 3) {
      const manquantes: string[] = [];
      if (!hasLower) manquantes.push("une minuscule (a-z)");
      if (!hasUpper) manquantes.push("une majuscule (A-Z)");
      if (!hasDigit) manquantes.push("un chiffre (0-9)");
      if (!hasSpecial) manquantes.push("un caractère spécial (!@#$%…)");
      setValidationError(
        "Le mot de passe doit obligatoirement inclure au moins 3 des 4 catégories " +
          "suivantes : minuscules (a-z), majuscules (A-Z), chiffres (0-9), caractères spéciaux (!@#$%…). " +
          `Il manque actuellement : ${manquantes.join(", ")}.`,
      );
      return;
    }

    setStatus("submitting");
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setStatus("success");
      } else {
        setStatus("error");
        setErrorMsg(data.error ?? "Échec de la réinitialisation");
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
            Aucun token de réinitialisation n&rsquo;a été trouvé dans l&rsquo;URL.
            Utilisez le lien complet qui vous a été envoyé par email.
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
          <CardTitle>Mot de passe mis à jour !</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground text-center">
            Votre mot de passe a été modifié avec succès. Vous pouvez maintenant
            vous connecter avec votre nouveau mot de passe.
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
          <CardTitle>Réinitialisation échouée</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground text-center">
            {errorMsg || "Le lien de réinitialisation est invalide ou a expiré."}
          </p>
          <Button asChild variant="outline" className="w-full gap-2">
            <Link href="/forgot-password">
              <KeyRound className="h-4 w-4" />
              Demander un nouveau lien
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
        <CardTitle>Nouveau mot de passe</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground text-center">
          Définissez votre nouveau mot de passe. Il doit contenir au moins 8
          caractères et idéalement 3 des 4 catégories : minuscules, majuscules,
          chiffres, caractères spéciaux.
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="password">
              Nouveau mot de passe
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
            <p className="text-xs text-muted-foreground">
              Le mot de passe doit obligatoirement contenir au moins 8 caractères et
              inclure au moins 3 des 4 catégories : minuscules (a-z), majuscules (A-Z),
              chiffres (0-9) et caractères spéciaux (!@#$%…).
            </p>
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
                Mise à jour...
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

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-8 bg-background">
      <Suspense
        fallback={
          <div className="flex items-center justify-center w-full h-full">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        }
      >
        <ResetPasswordForm />
      </Suspense>
    </div>
  );
}
