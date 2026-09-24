"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

import {
  Loader2,
  Mail,
  Phone,
  Building2,
  Shield,
  ShieldCheck,
  Calendar,
  Lock,
  Save,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertCircle,
  Globe,
} from "lucide-react";
import { getInitials } from "@/lib/utils";
import { changePassword, updateProfile } from "@/lib/actions/profil";
import { Security2FA } from "@/components/parametres/Security2FA";

interface ProfileData {
  id: string;
  email: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  phone: string | null;
  role: string;
  emailVerified: Date | null;
  mfaEnabled: boolean;
  langue: string;
  locale: string;
  notifications: { email?: boolean; sms?: boolean; push?: boolean } | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  tenant: { name: string } | null;
  site: { nom: string } | null;
}

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: "Super Admin",
  TENANT_ADMIN: "Administrateur",
  PRINCIPAL: "Directeur",
  SECRETARY: "Secrétaire",
  TEACHER: "Enseignant",
  CLASS_TEACHER: "Professeur principal",
  COUNSELOR: "Conseiller",
  NURSE: "Infirmier(e)",
  ACCOUNTANT: "Comptable",
  PARENT: "Parent",
  STUDENT: "Élève",
};

export function ProfileView({ profile }: { profile: ProfileData | null }) {
  const { update: updateSession } = useSession();
  const [tab, setTab] = useState<"infos" | "securite">("infos");

  // ─── Formulaire profil ──────────────────────────────────────────────
  const [form, setForm] = useState({
    name: profile?.name ?? "",
    firstName: profile?.firstName ?? "",
    lastName: profile?.lastName ?? "",
    phone: profile?.phone ?? "",
    langue: profile?.langue ?? "fr",
    notifEmail: profile?.notifications?.email ?? true,
    notifSms: profile?.notifications?.sms ?? false,
    notifPush: profile?.notifications?.push ?? true,
  });
  const [savingProfile, setSavingProfile] = useState(false);

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSavingProfile(true);
    try {
      const result = await updateProfile({
        name: form.name,
        firstName: form.firstName || null,
        lastName: form.lastName || null,
        phone: form.phone || null,
        langue: form.langue as "fr" | "en" | "so",
        notifications: {
          email: form.notifEmail,
          sms: form.notifSms,
          push: form.notifPush,
        },
      });
      if (result.success) {
        toast.success("Profil mis à jour avec succès");
        await updateSession({ name: form.name });
      } else {
        toast.error(result.error ?? "Erreur lors de la mise à jour");
      }
    } catch {
      toast.error("Erreur lors de la mise à jour");
    } finally {
      setSavingProfile(false);
    }
  }

  // ─── Formulaire mot de passe ────────────────────────────────────────
  const [pwdForm, setPwdForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [savingPwd, setSavingPwd] = useState(false);
  const [pwdError, setPwdError] = useState<string | null>(null);
  const [pwdSuccess, setPwdSuccess] = useState(false);

  // Indicateur de robustesse du nouveau mot de passe
  const pwdChecks = {
    length: pwdForm.newPassword.length >= 8,
    upper: /[A-Z]/.test(pwdForm.newPassword),
    lower: /[a-z]/.test(pwdForm.newPassword),
    digit: /\d/.test(pwdForm.newPassword),
    special: /[^A-Za-z0-9]/.test(pwdForm.newPassword),
  };
  const pwdStrength = Object.values(pwdChecks).filter(Boolean).length;

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwdError(null);
    setPwdSuccess(false);
    setSavingPwd(true);
    try {
      const result = await changePassword(pwdForm);
      if (result.success) {
        setPwdSuccess(true);
        setPwdForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
        toast.success("Mot de passe modifié avec succès");
      } else {
        setPwdError(result.error ?? "Erreur");
        toast.error(result.error ?? "Erreur lors du changement de mot de passe");
      }
    } catch {
      setPwdError("Erreur lors du changement de mot de passe");
      toast.error("Erreur lors du changement de mot de passe");
    } finally {
      setSavingPwd(false);
    }
  }

  if (!profile) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* ─── En-tête : avatar + infos principales ─────────────────────── */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-4">
            <Avatar className="h-20 w-20">
              {profile.avatarUrl && <AvatarImage src={profile.avatarUrl} />}
              <AvatarFallback className="bg-primary text-white text-xl">
                {getInitials(profile.name)}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <h2 className="text-xl font-semibold">{profile.name}</h2>
              <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                <Mail className="h-3.5 w-3.5" />
                {profile.email}
              </p>
              <div className="flex items-center gap-2 mt-2">
                <Badge variant="secondary">{ROLE_LABELS[profile.role] ?? profile.role}</Badge>
                {profile.emailVerified ? (
                  <Badge variant="outline" className="text-green-600 border-green-300">
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    Email vérifié
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-amber-600 border-amber-300">
                    <AlertCircle className="h-3 w-3 mr-1" />
                    Email non vérifié
                  </Badge>
                )}
                {profile.mfaEnabled && (
                  <Badge variant="outline" className="text-blue-600 border-blue-300">
                    <ShieldCheck className="h-3 w-3 mr-1" />
                    2FA
                  </Badge>
                )}
              </div>
            </div>
          </div>

          {/* Infos rapides */}
          <div className="grid grid-cols-2 gap-3 mt-6 text-sm">
            {profile.tenant && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Building2 className="h-4 w-4" />
                {profile.tenant.name}
              </div>
            )}
            {profile.site && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Building2 className="h-4 w-4" />
                {profile.site.nom}
              </div>
            )}
            {profile.phone && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Phone className="h-4 w-4" />
                {profile.phone}
              </div>
            )}
            <div className="flex items-center gap-2 text-muted-foreground">
              <Calendar className="h-4 w-4" />
              Membre depuis {new Date(profile.createdAt).toLocaleDateString("fr-FR")}
            </div>
            {profile.lastLoginAt && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Calendar className="h-4 w-4" />
                Dernière connexion : {new Date(profile.lastLoginAt).toLocaleString("fr-FR")}
              </div>
            )}
            <div className="flex items-center gap-2 text-muted-foreground">
              <Globe className="h-4 w-4" />
              Langue : {profile.langue === "fr" ? "Français" : profile.langue === "en" ? "English" : "Soomaali"}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ─── Onglets ──────────────────────────────────────────────────── */}
      <div className="flex gap-2 border-b">
        <button
          onClick={() => setTab("infos")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === "infos" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Informations personnelles
        </button>
        <button
          onClick={() => setTab("securite")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === "securite" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Sécurité
        </button>
      </div>

      {/* ─── Onglet : Informations ────────────────────────────────────── */}
      {tab === "infos" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Modifier mes informations</CardTitle>
            <CardDescription>Mettez à jour vos informations personnelles et préférences</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSaveProfile} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="firstName">Prénom</Label>
                  <Input
                    id="firstName"
                    value={form.firstName}
                    onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="lastName">Nom</Label>
                  <Input
                    id="lastName"
                    value={form.lastName}
                    onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="name">Nom affiché</Label>
                <Input
                  id="name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="phone">Téléphone</Label>
                <Input
                  id="phone"
                  type="tel"
                  placeholder="+253 ..."
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="langue">Langue de l&apos;interface</Label>
                <select
                  id="langue"
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={form.langue}
                  onChange={(e) => setForm({ ...form, langue: e.target.value })}
                >
                  <option value="fr">Français</option>
                  <option value="en">English</option>
                  <option value="so">Soomaali</option>
                </select>
              </div>

              <div className="h-px bg-border my-4" />

              {/* Préférences de notification */}
              <div className="space-y-3">
                <Label>Préférences de notification</Label>
                <div className="space-y-2">
                  <label className="flex items-center gap-3 text-sm">
                    <input
                      type="checkbox"
                      checked={form.notifEmail}
                      onChange={(e) => setForm({ ...form, notifEmail: e.target.checked })}
                      className="h-4 w-4 rounded border-input"
                    />
                    <Mail className="h-4 w-4 text-muted-foreground" />
                    Notifications par email
                  </label>
                  <label className="flex items-center gap-3 text-sm">
                    <input
                      type="checkbox"
                      checked={form.notifSms}
                      onChange={(e) => setForm({ ...form, notifSms: e.target.checked })}
                      className="h-4 w-4 rounded border-input"
                    />
                    <Phone className="h-4 w-4 text-muted-foreground" />
                    Notifications par SMS
                  </label>
                  <label className="flex items-center gap-3 text-sm">
                    <input
                      type="checkbox"
                      checked={form.notifPush}
                      onChange={(e) => setForm({ ...form, notifPush: e.target.checked })}
                      className="h-4 w-4 rounded border-input"
                    />
                    <Shield className="h-4 w-4 text-muted-foreground" />
                    Notifications push
                  </label>
                </div>
              </div>

              <div className="flex justify-end">
                <Button type="submit" disabled={savingProfile} className="gap-2">
                  {savingProfile ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Enregistrer
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* ─── Onglet : Sécurité ────────────────────────────────────────── */}
      {tab === "securite" && (
        <div className="space-y-6">
          {/* Changement de mot de passe */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Lock className="h-4 w-4" />
                Changer le mot de passe
              </CardTitle>
              <CardDescription>
                Pour des raisons de sécurité, saisissez d&apos;abord votre mot de passe actuel
              </CardDescription>
            </CardHeader>
            <CardContent>
              {pwdSuccess && (
                <div className="mb-4 rounded-lg border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950 p-3 flex items-center gap-2 text-sm text-green-700 dark:text-green-400">
                  <CheckCircle2 className="h-4 w-4" />
                  Votre mot de passe a été modifié avec succès.
                </div>
              )}
              {pwdError && (
                <div className="mb-4 rounded-lg border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950 p-3 flex items-center gap-2 text-sm text-red-700 dark:text-red-400">
                  <AlertCircle className="h-4 w-4" />
                  {pwdError}
                </div>
              )}
              <form onSubmit={handleChangePassword} className="space-y-4">
                {/* Mot de passe actuel */}
                <div className="space-y-1.5">
                  <Label htmlFor="currentPassword">Mot de passe actuel</Label>
                  <div className="relative">
                    <Input
                      id="currentPassword"
                      type={showCurrent ? "text" : "password"}
                      value={pwdForm.currentPassword}
                      onChange={(e) => setPwdForm({ ...pwdForm, currentPassword: e.target.value })}
                      required
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowCurrent(!showCurrent)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div className="h-px bg-border my-4" />

                {/* Nouveau mot de passe */}
                <div className="space-y-1.5">
                  <Label htmlFor="newPassword">Nouveau mot de passe</Label>
                  <div className="relative">
                    <Input
                      id="newPassword"
                      type={showNew ? "text" : "password"}
                      value={pwdForm.newPassword}
                      onChange={(e) => setPwdForm({ ...pwdForm, newPassword: e.target.value })}
                      required
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNew(!showNew)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {/* Indicateur de robustesse */}
                  {pwdForm.newPassword.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex gap-1">
                        {[0, 1, 2, 3, 4].map((i) => (
                          <div
                            key={i}
                            className={`h-1.5 flex-1 rounded-full transition-colors ${
                              i < pwdStrength
                                ? pwdStrength <= 2
                                  ? "bg-red-500"
                                  : pwdStrength <= 3
                                    ? "bg-amber-500"
                                    : "bg-green-500"
                                : "bg-muted"
                            }`}
                          />
                        ))}
                      </div>
                      <div className="grid grid-cols-2 gap-1 text-xs text-muted-foreground">
                        <span className={pwdChecks.length ? "text-green-600" : ""}>
                          {pwdChecks.length ? "✓" : "○"} Au moins 8 caractères
                        </span>
                        <span className={pwdChecks.upper ? "text-green-600" : ""}>
                          {pwdChecks.upper ? "✓" : "○"} Une majuscule
                        </span>
                        <span className={pwdChecks.lower ? "text-green-600" : ""}>
                          {pwdChecks.lower ? "✓" : "○"} Une minuscule
                        </span>
                        <span className={pwdChecks.digit ? "text-green-600" : ""}>
                          {pwdChecks.digit ? "✓" : "○"} Un chiffre
                        </span>
                        <span className={pwdChecks.special ? "text-green-600" : ""}>
                          {pwdChecks.special ? "✓" : "○"} Un caractère spécial
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Confirmation */}
                <div className="space-y-1.5">
                  <Label htmlFor="confirmPassword">Confirmer le nouveau mot de passe</Label>
                  <div className="relative">
                    <Input
                      id="confirmPassword"
                      type={showConfirm ? "text" : "password"}
                      value={pwdForm.confirmPassword}
                      onChange={(e) => setPwdForm({ ...pwdForm, confirmPassword: e.target.value })}
                      required
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirm(!showConfirm)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {pwdForm.confirmPassword.length > 0 && pwdForm.newPassword !== pwdForm.confirmPassword && (
                    <p className="text-xs text-destructive">Les mots de passe ne correspondent pas</p>
                  )}
                </div>

                <div className="flex justify-end">
                  <Button
                    type="submit"
                    disabled={savingPwd || pwdForm.newPassword !== pwdForm.confirmPassword}
                    className="gap-2"
                  >
                    {savingPwd ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
                    Changer le mot de passe
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          {/* 2FA */}
          <Security2FA />
        </div>
      )}
    </div>
  );
}
