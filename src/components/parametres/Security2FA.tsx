"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, Shield, ShieldCheck, ShieldOff, QrCode, KeyRound, Smartphone } from "lucide-react";
import { toast } from "sonner";

export function Security2FA() {
  const { data: session } = useSession();
  const userEmail = session?.user?.email ?? "";
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [setupData, setSetupData] = useState<{ secret: string; qrCode: string } | null>(null);
  const [totp, setTotp] = useState("");
  const [busy, setBusy] = useState(false);

  // Charger le statut 2FA
  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/2fa/status");
      if (res.ok) {
        const data = await res.json();
        setEnabled(data.enabled);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  // Démarrer le setup : génère un secret + QR code
  async function startSetup() {
    setBusy(true);
    try {
      const res = await fetch("/api/auth/2fa/setup");
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? "Erreur");
        return;
      }
      const data = await res.json();
      setSetupData({ secret: data.secret, qrCode: data.qrCode });
    } catch {
      toast.error("Erreur lors de la génération du QR code");
    } finally {
      setBusy(false);
    }
  }

  // Activer la 2FA après vérification du code
  async function enable2FA() {
    if (!setupData || !/^\d{6}$/.test(totp)) {
      toast.error("Veuillez saisir un code à 6 chiffres");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/2fa/enable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: setupData.secret, totp }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? "Code incorrect");
        return;
      }
      toast.success("2FA activée avec succès !");
      setEnabled(true);
      setSetupData(null);
      setTotp("");
    } catch {
      toast.error("Erreur");
    } finally {
      setBusy(false);
    }
  }

  // Désactiver la 2FA
  async function disable2FA() {
    if (!/^\d{6}$/.test(totp)) {
      toast.error("Veuillez saisir un code à 6 chiffres");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/2fa/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ totp }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? "Code incorrect");
        return;
      }
      toast.success("2FA désactivée");
      setEnabled(false);
      setTotp("");
    } catch {
      toast.error("Erreur");
    } finally {
      setBusy(false);
    }
  }

  function cancelSetup() {
    setSetupData(null);
    setTotp("");
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Statut actuel */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Authentification à deux facteurs (2FA)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            {enabled ? (
              <>
                <Badge variant="success" className="gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Activée
                </Badge>
                <span className="text-sm text-muted-foreground">
                  Votre compte est protégé par 2FA
                </span>
              </>
            ) : (
              <>
                <Badge variant="secondary" className="gap-1.5">
                  <ShieldOff className="h-3.5 w-3.5" />
                  Désactivée
                </Badge>
                <span className="text-sm text-muted-foreground">
                  Activez la 2FA pour sécuriser votre compte
                </span>
              </>
            )}
          </div>

          {!enabled && !setupData && (
            <Button onClick={startSetup} disabled={busy} className="gap-2">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4" />}
              Activer la 2FA
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Setup : QR code + vérification */}
      {setupData && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <QrCode className="h-5 w-5" />
              Configuration
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Étape 1 : scanner le QR code */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Smartphone className="h-4 w-4" />
                1. Scannez ce QR code avec Google Authenticator ou Authy
              </Label>
              <div className="flex justify-center p-4 bg-white rounded-lg border">
                <img src={setupData.qrCode} alt="QR Code 2FA" width={256} height={256} />
              </div>
            </div>

            {/* Étape 2 : clé manuelle (si QR ne marche pas) */}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">
                Ou saisissez manuellement cette clé :
              </Label>
              <code className="block p-2 bg-muted rounded text-xs font-mono break-all">
                {setupData.secret}
              </code>
            </div>

            {/* Étape 3 : vérification */}
            <div className="space-y-2">
              <Label htmlFor="totp" className="flex items-center gap-2">
                <KeyRound className="h-4 w-4" />
                2. Saisissez le code à 6 chiffres de votre application
              </Label>
              <Input
                id="totp"
                value={totp}
                onChange={(e) => setTotp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="123456"
                className="text-center text-2xl tracking-widest font-mono"
                inputMode="numeric"
                maxLength={6}
              />
            </div>

            <div className="flex gap-2">
              <Button onClick={enable2FA} disabled={busy || totp.length !== 6} className="gap-2">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                Confirmer et activer
              </Button>
              <Button variant="outline" onClick={cancelSetup} disabled={busy}>
                Annuler
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Désactivation */}
      {enabled && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <ShieldOff className="h-5 w-5" />
              Désactiver la 2FA
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Saisissez un code TOTP actuel pour confirmer la désactivation.
            </p>
            <div className="space-y-2">
              <Label htmlFor="totp-disable">Code TOTP actuel</Label>
              <Input
                id="totp-disable"
                value={totp}
                onChange={(e) => setTotp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="123456"
                className="text-center text-2xl tracking-widest font-mono"
                inputMode="numeric"
                maxLength={6}
              />
            </div>
            <Button variant="destructive" onClick={disable2FA} disabled={busy || totp.length !== 6} className="gap-2">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldOff className="h-4 w-4" />}
              Désactiver la 2FA
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
