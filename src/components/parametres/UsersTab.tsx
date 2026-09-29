"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Trash2, Power, Phone, Edit3, Check, X, Building2, MapPin, AlertTriangle, Search, Shield, GraduationCap, Briefcase, Users as UsersIcon, BookOpen, Users as UsersClass, Upload, Mail, BadgeCheck } from "lucide-react";
import { roleRequiresSite } from "@/lib/site-scope";
import { createUser, toggleUserActive, deleteUser, updateUserPhone, assignUserSites, getUserSites, getMatieresForAffectation, getClassesForAffectation, resendVerificationEmail, marquerEmailsVerifies, type UserFormData } from "@/lib/actions/parametres";
import { addUserToTenant } from "@/lib/actions/user-tenant";
import { useTranslations } from "next-intl";
import Link from "next/link";
import type { AvailableTenant } from "@/auth.config";
import type { Role } from "@prisma/client";
import { cn } from "@/lib/utils";
import { ImportEnseignantsDialog } from "./ImportEnseignantsDialog";
import { ImportPersonnelDialog } from "./ImportPersonnelDialog";

interface UserItem {
  id: string;
  name: string;
  email: string;
  emailVerified: Date | null;
  role: string;
  phone: string | null;
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  emailLogs?: {
    id: string;
    status: string;
    type: string;
    createdAt: Date;
    errorMessage: string | null;
  }[];
}

const roleKeys: Record<string, string> = {
  TENANT_ADMIN: "roleTenantAdmin",
  PRINCIPAL: "rolePrincipal",
  SECRETARY: "roleSecretary",
  TEACHER: "roleTeacher",
  CLASS_TEACHER: "roleClassTeacher",
  COUNSELOR: "roleCounselor",
  NURSE: "roleNurse",
  ACCOUNTANT: "roleAccountant",
  PARENT: "roleParent",
  STUDENT: "roleStudent",
};

type UserCategory = "all" | "admin" | "teachers" | "staff";

const categoryConfig: Record<UserCategory, { label: string; icon: typeof Shield; roles: string[] }> = {
  all: { label: "Tous", icon: UsersIcon, roles: [] },
  admin: { label: "Administration", icon: Shield, roles: ["TENANT_ADMIN", "PRINCIPAL", "SUPER_ADMIN"] },
  teachers: { label: "Enseignants", icon: GraduationCap, roles: ["TEACHER", "CLASS_TEACHER", "COUNSELOR"] },
  staff: { label: "Personnel", icon: Briefcase, roles: ["SECRETARY", "NURSE", "ACCOUNTANT"] },
};

// Rôles masqués du sélecteur (le prof principal est défini au niveau de la classe, pas au niveau utilisateur)
const hiddenRoles = ["CLASS_TEACHER"];

interface SiteItem {
  id: string;
  nom: string;
  code: string | null;
}

interface MatiereOption {
  id: string;
  nom: string;
  code: string;
  couleur?: string | null;
}

interface ClasseOption {
  id: string;
  nom: string;
  niveau: string;
  structure?: { id: string; type: string; nom: string } | null;
  site?: { id: string; nom: string } | null;
}

const isTeacherRole = (role: string) => role === "TEACHER";

// Rôles proposés à l'étape 1 du wizard (CLASS_TEACHER exclu — défini au niveau de la classe)
const roleCards: { role: string; labelKey: string; icon: typeof Shield; color: string }[] = [
  { role: "TEACHER", labelKey: "roleTeacher", icon: GraduationCap, color: "text-violet-500" },
  { role: "SECRETARY", labelKey: "roleSecretary", icon: Briefcase, color: "text-blue-500" },
  { role: "COUNSELOR", labelKey: "roleCounselor", icon: Shield, color: "text-teal-500" },
  { role: "NURSE", labelKey: "roleNurse", icon: Shield, color: "text-pink-500" },
  { role: "ACCOUNTANT", labelKey: "roleAccountant", icon: Briefcase, color: "text-green-500" },
  { role: "PRINCIPAL", labelKey: "rolePrincipal", icon: Shield, color: "text-amber-500" },
  { role: "TENANT_ADMIN", labelKey: "roleTenantAdmin", icon: Shield, color: "text-red-500" },
  { role: "PARENT", labelKey: "roleParent", icon: UsersIcon, color: "text-indigo-500" },
];

export function UsersTab({ users, canManage, sessionRole, sessionSiteId, availableTenants = [], sites = [] }: { users: UserItem[]; canManage: boolean; sessionRole?: string; sessionSiteId?: string; availableTenants?: AvailableTenant[]; sites?: SiteItem[] }) {
  const t = useTranslations("parametres");
  const [showForm, setShowForm] = useState(false);
  const [formStep, setFormStep] = useState<1 | 2>(1); // 1 = choix du rôle, 2 = formulaire
  const [isPending, setIsPending] = useState(false);
  const [editingPhoneId, setEditingPhoneId] = useState<string | null>(null);
  const [phoneValue, setPhoneValue] = useState("");
  const [activeCategory, setActiveCategory] = useState<UserCategory>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [showImportEnseignants, setShowImportEnseignants] = useState(false);
  const [showImportPersonnel, setShowImportPersonnel] = useState(false);
  const [resendingEmailId, setResendingEmailId] = useState<string | null>(null);
  // Vérification d'emails : un compte créé par l'administration démarre sans
  // email vérifié et ne peut donc PAS se connecter (garde-fou `authorize()`).
  const [showVerifyModal, setShowVerifyModal] = useState(false);
  const [verifyPending, setVerifyPending] = useState(false);
  const [verifyingUserId, setVerifyingUserId] = useState<string | null>(null);

  const filteredUsers = users.filter((u) => {
    const matchesCategory =
      activeCategory === "all" || categoryConfig[activeCategory].roles.includes(u.role);
    const matchesSearch =
      !searchQuery ||
      u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.email.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const categoryCounts: Record<UserCategory, number> = {
    all: users.length,
    admin: users.filter((u) => categoryConfig.admin.roles.includes(u.role)).length,
    teachers: users.filter((u) => categoryConfig.teachers.roles.includes(u.role)).length,
    staff: users.filter((u) => categoryConfig.staff.roles.includes(u.role)).length,
  };

  /** Comptes en attente de vérification d'email (ne peuvent pas se connecter). */
  const nonVerifies = users.filter((u) => !u.emailVerified);

  // Multi-tenant: modal d'invitation
  const [showTenantModal, setShowTenantModal] = useState(false);
  const [tenantForm, setTenantForm] = useState({
    email: "",
    tenantId: "",
    role: "TEACHER" as Role,
  });
  const [tenantResult, setTenantResult] = useState<string | null>(null);
  // Multi-site: modal d'affectation des sites
  const [showSiteModal, setShowSiteModal] = useState(false);
  const [siteModalUserId, setSiteModalUserId] = useState<string | null>(null);
  const [siteModalUserName, setSiteModalUserName] = useState<string>("");
  const [selectedSiteIds, setSelectedSiteIds] = useState<string[]>([]);
  const [siteLoading, setSiteLoading] = useState(false);

  async function openSiteModal(userId: string, userName: string) {
    setSiteModalUserId(userId);
    setSiteModalUserName(userName);
    setSiteLoading(true);
    setShowSiteModal(true);
    try {
      const existingSiteIds = await getUserSites(userId);
      setSelectedSiteIds(existingSiteIds.map((s) => s.siteId));
    } catch {
      setSelectedSiteIds([]);
    } finally {
      setSiteLoading(false);
    }
  }

  async function handleSaveSites() {
    if (!siteModalUserId) return;
    setSiteLoading(true);
    try {
      await assignUserSites(siteModalUserId, selectedSiteIds.map((sid) => ({ siteId: sid, role: null })));
      toast.success("Accès sites mis à jour");
      setShowSiteModal(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setSiteLoading(false);
    }
  }

  function toggleSiteSelection(siteId: string) {
    setSelectedSiteIds((prev) =>
      prev.includes(siteId)
        ? prev.filter((id) => id !== siteId)
        : [...prev, siteId]
    );
  }

  function toggleAllSites() {
    setSelectedSiteIds((prev) =>
      prev.length === sites.length ? [] : sites.map((s) => s.id)
    );
  }

  const [form, setForm] = useState<UserFormData>({
    name: "",
    email: "",
    role: "TEACHER",
    phone: "",
    password: "",
    isActive: true,
  });

  // ── Affectation matières + classes pour les enseignants ──
  const [matieres, setMatieres] = useState<MatiereOption[]>([]);
  const [classes, setClasses] = useState<ClasseOption[]>([]);
  const [formMatiereIds, setFormMatiereIds] = useState<string[]>([]);
  const [formClasseIds, setFormClasseIds] = useState<string[]>([]);
  const [affectationLoaded, setAffectationLoaded] = useState(false);

  const loadAffectationData = useCallback(async () => {
    if (affectationLoaded) return;
    try {
      const [mat, cls] = await Promise.all([
        getMatieresForAffectation(),
        getClassesForAffectation(),
      ]);
      setMatieres(mat as MatiereOption[]);
      setClasses(cls as ClasseOption[]);
      setAffectationLoaded(true);
    } catch {
      // silent
    }
  }, [affectationLoaded]);

  // Charger les matières/classes quand l'utilisateur ouvre le formulaire
  // ou sélectionne un rôle enseignant
  useEffect(() => {
    if (showForm && isTeacherRole(form.role)) {
      loadAffectationData();
    }
  }, [showForm, form.role, loadAffectationData]);

  // Site de rattachement du futur compte : celui sur lequel l'appelant est
  // positionné (`sessionSiteId`). Même règle que `siteForNewMember` côté serveur.
  const siteRequis = sites.length > 0 && roleRequiresSite(form.role);
  const siteCreation = sessionSiteId ? sites.find((s) => s.id === sessionSiteId) ?? null : null;

  function toggleFormMatiere(matiereId: string) {
    setFormMatiereIds((prev) =>
      prev.includes(matiereId)
        ? prev.filter((id) => id !== matiereId)
        : [...prev, matiereId]
    );
  }

  function toggleFormClasse(classeId: string) {
    setFormClasseIds((prev) =>
      prev.includes(classeId)
        ? prev.filter((id) => id !== classeId)
        : [...prev, classeId]
    );
  }

  // Ouvrir le wizard : étape 1 (choix du rôle)
  function openWizard() {
    setFormStep(1);
    setShowForm(true);
  }

  // Choisir un rôle et passer à l'étape 2
  function selectRole(role: string) {
    setForm({ ...form, role: role as UserFormData["role"] });
    setFormStep(2);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setIsPending(true);
    try {
      // Inclure matiereIds et classeIds si le rôle est enseignant
      const payload: UserFormData = {
        ...form,
        ...(isTeacherRole(form.role) ? {
          matiereIds: formMatiereIds,
          classeIds: formClasseIds,
        } : {}),
      };
      // Le rattachement au site courant est fait côté serveur.
      const result = await createUser(payload);
      // Feedback différencié selon le statut de l'email
      const emailSent = (result as { emailSent?: boolean }).emailSent;
      const emailError = (result as { emailError?: string }).emailError;
      if (emailSent) {
        toast.success(t("userCreatedEmailSent"));
      } else if (emailError) {
        toast.error(t("userCreatedEmailFailed", { error: emailError }));
      } else {
        toast.success(t("userCreated"));
      }
      setShowForm(false);
      setFormStep(1);
      setForm({ name: "", email: "", role: "TEACHER", phone: "", password: "", isActive: true });
      setFormMatiereIds([]);
      setFormClasseIds([]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("genericError"));
    } finally {
      setIsPending(false);
    }
  }

  async function handleResendEmail(userId: string) {
    setResendingEmailId(userId);
    try {
      const result = await resendVerificationEmail(userId);
      if (result.success) {
        toast.success(t("emailResent"));
      } else {
        toast.error(result.error ?? t("emailResentFailed"));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("emailResentFailed"));
    } finally {
      setResendingEmailId(null);
    }
  }

  /**
   * Marque comme vérifiés un compte précis (bouton par ligne) ou tous les
   * comptes non vérifiés de l'annuaire (bandeau). L'action serveur revérifie la
   * permission `parametres:write` et le périmètre tenant/sites, ne touche que
   * les comptes dont `emailVerified` est nul, et journalise l'opération.
   */
  async function handleMarquerVerifies(userIds?: string[]) {
    const parLigne = Boolean(userIds && userIds.length === 1);
    if (parLigne) setVerifyingUserId(userIds![0]);
    else setVerifyPending(true);
    try {
      const result = await marquerEmailsVerifies(userIds);
      if (result.modified > 0) {
        toast.success(t("emailsVerifies", { count: result.modified }));
      } else {
        toast.info(t("emailsVerifiesNone"));
      }
      setShowVerifyModal(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("genericError"));
    } finally {
      setVerifyingUserId(null);
      setVerifyPending(false);
    }
  }

  async function handleToggle(id: string) {
    try {
      await toggleUserActive(id);
      toast.success(t("userToggled"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("genericError"));
    }
  }

  // Modal de suppression avec confirmation par nom
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteUserId, setDeleteUserId] = useState<string | null>(null);
  const [deleteUserName, setDeleteUserName] = useState<string>("");
  const [deleteConfirmText, setDeleteConfirmText] = useState<string>("");
  const [deleteLoading, setDeleteLoading] = useState(false);

  function openDeleteModal(id: string, name: string) {
    setDeleteUserId(id);
    setDeleteUserName(name);
    setDeleteConfirmText("");
    setShowDeleteModal(true);
  }

  async function handleDelete() {
    if (!deleteUserId) return;
    if (deleteConfirmText.trim() !== deleteUserName.trim()) return;
    setDeleteLoading(true);
    try {
      await deleteUser(deleteUserId);
      toast.success(t("userDeleted"));
      setShowDeleteModal(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("genericError"));
    } finally {
      setDeleteLoading(false);
    }
  }

  async function handleSavePhone(id: string) {
    setIsPending(true);
    try {
      await updateUserPhone(id, phoneValue);
      toast.success(t("phoneUpdated"));
      setEditingPhoneId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("genericError"));
    } finally {
      setIsPending(false);
    }
  }

  async function handleAddToTenant(e: React.FormEvent) {
    e.preventDefault();
    if (!tenantForm.email || !tenantForm.tenantId) return;
    setIsPending(true);
    setTenantResult(null);
    try {
      const result = await addUserToTenant(tenantForm);
      setTenantResult(result.message);
      toast.success(result.message);
      setTenantForm({ email: "", tenantId: "", role: "TEACHER" });
      setShowTenantModal(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("genericError"));
    } finally {
      setIsPending(false);
    }
  }

  function openTenantModal(presetEmail?: string) {
    setTenantForm({ email: presetEmail ?? "", tenantId: "", role: "TEACHER" });
    setTenantResult(null);
    setShowTenantModal(true);
  }

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex justify-end gap-2">
          {availableTenants.length > 1 && (
            <Button size="sm" variant="outline" className="gap-2" onClick={() => openTenantModal()}>
              <Building2 className="h-4 w-4" />
              {t("addToTenant")}
            </Button>
          )}
          <Button size="sm" variant="outline" className="gap-2" onClick={() => setShowImportEnseignants(true)}>
            <Upload className="h-4 w-4" />
            {t("importEnseignants")}
          </Button>
          <Button size="sm" variant="outline" className="gap-2" onClick={() => setShowImportPersonnel(true)}>
            <Upload className="h-4 w-4" />
            {t("importPersonnel")}
          </Button>
          <Link href="/parametres/journal-emails">
            <Button size="sm" variant="outline" className="gap-2">
              <Mail className="h-4 w-4" />
              {t("emailJournal")}
            </Button>
          </Link>
          <Button size="sm" className="gap-2" onClick={() => showForm ? setShowForm(false) : openWizard()}>
            <Plus className="h-4 w-4" />
            {t("addUser")}
          </Button>
        </div>
      )}

      {showImportEnseignants && canManage && (
        <ImportEnseignantsDialog
          onClose={() => setShowImportEnseignants(false)}
          onImported={() => {
            // Recharger la page pour récupérer les nouveaux utilisateurs
            window.location.reload();
          }}
        />
      )}

      {showImportPersonnel && canManage && (
        <ImportPersonnelDialog
          onClose={() => setShowImportPersonnel(false)}
          onImported={() => {
            window.location.reload();
          }}
        />
      )}

      {/* Modal: Ajouter un user à un autre tenant */}
      {showTenantModal && canManage && (
        <Card className="border-primary/30">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Building2 className="h-4 w-4 text-primary" />
              {t("addToTenantTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleAddToTenant} className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="tenant-email">{t("colEmail")} *</Label>
                <Input
                  id="tenant-email"
                  type="email"
                  value={tenantForm.email}
                  onChange={(e) => setTenantForm({ ...tenantForm, email: e.target.value })}
                  placeholder="prof@ecole.com"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tenant-select">{t("selectTenant")}</Label>
                <select
                  id="tenant-select"
                  value={tenantForm.tenantId}
                  onChange={(e) => setTenantForm({ ...tenantForm, tenantId: e.target.value })}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  required
                >
                  <option value="">— Choisir —</option>
                  {availableTenants.map((at) => (
                    <option key={at.tenantId} value={at.tenantId}>
                      {at.tenantName} ({at.tenantSlug})
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tenant-role">{t("role")}</Label>
                <select
                  id="tenant-role"
                  value={tenantForm.role}
                  onChange={(e) => setTenantForm({ ...tenantForm, role: e.target.value as Role })}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {Object.entries(roleKeys).filter(([k]) => k !== "STUDENT" && !hiddenRoles.includes(k)).map(([key, labelKey]) => (
                    <option key={key} value={key}>{t(labelKey)}</option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-3 text-xs text-muted-foreground bg-muted/50 rounded-lg p-3">
                💡 Si l&apos;email existe déjà, l&apos;utilisateur sera lié au nouvel établissement avec le rôle choisi.
                Si non, un nouveau compte sera créé avec un mot de passe temporaire.
              </div>
              <div className="md:col-span-3 flex gap-2">
                <Button type="submit" size="sm" className="gap-2" disabled={isPending}>
                  {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Building2 className="h-4 w-4" />}
                  {t("addToTenant")}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setShowTenantModal(false)}>
                  {t("cancel")}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {showForm && canManage && formStep === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Plus className="h-4 w-4" />
              {t("addUser")} — {t("role")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              Choisissez le rôle de l&apos;utilisateur à ajouter :
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {roleCards.map(({ role, labelKey, icon: Icon, color }) => (
                <button
                  key={role}
                  type="button"
                  onClick={() => selectRole(role)}
                  className="flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-border hover:border-primary hover:bg-primary/5 transition-all group"
                >
                  <Icon className={cn("h-8 w-8", color)} />
                  <span className="text-sm font-medium text-center">{t(labelKey)}</span>
                </button>
              ))}
            </div>
            <div className="mt-4 flex justify-end">
              <Button type="button" variant="outline" size="sm" onClick={() => setShowForm(false)}>{t("cancel")}</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {showForm && canManage && formStep === 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <GraduationCap className="h-4 w-4" />
              {t("newUser")} — {t(roleKeys[form.role] ?? "roleTeacher")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="name">{t("fullName")}</Label>
                <Input id="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email">{t("colEmail")} *</Label>
                <Input id="email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="phone">{t("phone")}</Label>
                <Input id="phone" value={form.phone ?? ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">{t("password")}</Label>
                <Input id="password" type="password" placeholder={t("passwordPlaceholder")} value={form.password ?? ""}
                  onChange={(e) => setForm({ ...form, password: e.target.value })} />
              </div>

              {/* ── Site : celui sur lequel vous êtes positionné ── */}
              {siteRequis && (
                siteCreation ? (
                  <div className="md:col-span-2 flex items-center gap-2 rounded-lg border-2 border-green-500/30 bg-green-500/5 p-3">
                    <MapPin className="h-4 w-4 text-green-600" />
                    <p className="text-sm text-green-700">
                      Sera rattaché automatiquement au site : <strong>{siteCreation.nom}</strong>
                      <span className="block text-xs font-normal text-muted-foreground">
                        D&apos;autres sites pourront être ajoutés ensuite via « Accès aux sites ».
                      </span>
                    </p>
                  </div>
                ) : (
                  <div className="md:col-span-2 flex items-center gap-2 rounded-lg border-2 border-amber-500/30 bg-amber-500/5 p-3">
                    <AlertTriangle className="h-4 w-4 flex-shrink-0 text-amber-600" />
                    <p className="text-sm text-amber-700">
                      Vous êtes positionné sur « Tous les sites ». Choisissez un site précis dans le
                      sélecteur en haut de page : ce compte doit être rattaché à un site pour pouvoir se connecter.
                    </p>
                  </div>
                )
              )}

              {/* ── Affectation matières + classes pour les enseignants ── */}
              {isTeacherRole(form.role) && (
                <div className="md:col-span-2 space-y-4 border-t pt-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                    <GraduationCap className="h-4 w-4" />
                    Affectation pédagogique
                  </div>

                  {/* Matières */}
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2">
                      <BookOpen className="h-4 w-4" />
                      Matières enseignées
                      <span className="text-xs text-muted-foreground font-normal">(collège/lycée — optionnel au primaire)</span>
                    </Label>
                    {matieres.length === 0 ? (
                      <p className="text-xs text-muted-foreground italic">Chargement des matières…</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {matieres.map((matiere) => (
                          <button
                            key={matiere.id}
                            type="button"
                            onClick={() => toggleFormMatiere(matiere.id)}
                            className={cn(
                              "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                              formMatiereIds.includes(matiere.id)
                                ? "bg-primary text-primary-foreground border-primary"
                                : "bg-background hover:bg-muted border-input"
                            )}
                            style={matiere.couleur && formMatiereIds.includes(matiere.id) ? { backgroundColor: matiere.couleur, borderColor: matiere.couleur } : undefined}
                          >
                            {matiere.nom}
                          </button>
                        ))}
                      </div>
                    )}
                    {formMatiereIds.length === 0 && (
                      <p className="text-xs text-muted-foreground italic">
                        Aucune matière sélectionnée. L&apos;enseignant pourra être affecté plus tard.
                      </p>
                    )}
                  </div>

                  {/* Classes */}
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2">
                      <UsersClass className="h-4 w-4" />
                      Classes assignées
                      <span className="text-xs text-muted-foreground font-normal">(classes du site courant)</span>
                    </Label>
                    {classes.length === 0 ? (
                      <p className="text-xs text-muted-foreground italic">Chargement des classes…</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {classes.map((classe) => (
                          <button
                            key={classe.id}
                            type="button"
                            onClick={() => toggleFormClasse(classe.id)}
                            className={cn(
                              "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                              formClasseIds.includes(classe.id)
                                ? "bg-primary text-primary-foreground border-primary"
                                : "bg-background hover:bg-muted border-input"
                            )}
                          >
                            {classe.nom}
                            {classe.structure && (
                              <span className="ml-1 opacity-60">({classe.structure.type})</span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                    {formClasseIds.length === 0 && (
                      <p className="text-xs text-muted-foreground italic">
                        Aucune classe sélectionnée. L&apos;enseignant pourra être affecté plus tard via l&apos;onglet « Affectations ».
                      </p>
                    )}
                  </div>

                </div>
              )}
              <div className="md:col-span-2 flex gap-2">
                <Button type="submit" size="sm" className="gap-2" disabled={isPending || (siteRequis && !siteCreation)}>
                  {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  {t("create")}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setFormStep(1)}>← {t("role")}</Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setShowForm(false)}>{t("cancel")}</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Barre de filtres par catégorie + recherche */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex flex-wrap gap-2">
          {(Object.keys(categoryConfig) as UserCategory[]).map((cat) => {
            const cfg = categoryConfig[cat];
            const count = categoryCounts[cat];
            const isActive = activeCategory === cat;
            return (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-all",
                  isActive
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <cfg.icon className="h-3.5 w-3.5" />
                {cfg.label}
                <span className={cn(
                  "ml-1 rounded-full px-1.5 py-0.5 text-xs font-semibold",
                  isActive ? "bg-primary-foreground/20" : "bg-muted"
                )}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Rechercher par nom ou email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
      </div>

      {canManage && nonVerifies.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-900/50 dark:bg-amber-950/30">
          <AlertTriangle className="h-4 w-4 flex-shrink-0 text-amber-600" />
          <div className="min-w-[240px] flex-1">
            <p className="font-medium">{t("unverifiedTitle", { count: nonVerifies.length })}</p>
            <p className="text-muted-foreground">{t("unverifiedDesc")}</p>
          </div>
          <Button size="sm" className="gap-2" onClick={() => setShowVerifyModal(true)}>
            <BadgeCheck className="h-4 w-4" />
            {t("verifyAll")}
          </Button>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">{t("colName")}</th>
                  <th className="text-left px-4 py-3 font-medium">{t("colEmail")}</th>
                  <th className="text-left px-4 py-3 font-medium">{t("colPhone")}</th>
                  <th className="text-left px-4 py-3 font-medium">{t("colRole")}</th>
                  <th className="text-left px-4 py-3 font-medium">Sites</th>
                  <th className="text-left px-4 py-3 font-medium">{t("colStatus")}</th>
                  <th className="text-left px-4 py-3 font-medium">{t("colLastLogin")}</th>
                  {canManage && <th className="text-right px-4 py-3 font-medium">{t("colActions")}</th>}
                </tr>
              </thead>
              <tbody>
                {filteredUsers.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-8 text-muted-foreground">
                    {searchQuery ? "Aucun utilisateur trouvé pour cette recherche." : t("noUsers")}
                  </td></tr>
                ) : (
                  filteredUsers.map((u) => (
                    <tr key={u.id} className="border-b hover:bg-muted/30">
                      <td className="px-4 py-3 font-medium">{u.name}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          <span className="text-muted-foreground">{u.email}</span>
                          {u.emailVerified ? (
                            <Badge variant="success" className="w-fit text-[10px] py-0 px-1.5">
                              <Check className="h-2.5 w-2.5 mr-0.5" />
                              {t("emailVerified")}
                            </Badge>
                          ) : u.emailLogs && u.emailLogs.length > 0 ? (
                            <div className="flex items-center gap-1.5">
                              {(() => {
                                const log = u.emailLogs[0];
                                const badgeVariant =
                                  log.status === "DELIVERED" || log.status === "OPENED" ? "success" :
                                  log.status === "BOUNCED" || log.status === "FAILED" ? "destructive" :
                                  log.status === "COMPLAINED" ? "destructive" :
                                  log.status === "DELIVERY_DELAYED" ? "warning" :
                                  "secondary";
                                const labelKey =
                                  log.status === "SENT" ? "emailStatusSent" :
                                  log.status === "DELIVERED" ? "emailStatusDelivered" :
                                  log.status === "BOUNCED" ? "emailStatusBounced" :
                                  log.status === "FAILED" ? "emailStatusFailed" :
                                  log.status === "COMPLAINED" ? "emailStatusComplained" :
                                  log.status === "OPENED" ? "emailStatusOpened" :
                                  log.status === "DELIVERY_DELAYED" ? "emailStatusDelayed" :
                                  "emailStatusPending";
                                return (
                                  <>
                                    <Badge variant={badgeVariant as "success" | "destructive" | "warning" | "secondary"} className="w-fit text-[10px] py-0 px-1.5">
                                      {t(labelKey)}
                                    </Badge>
                                    {(log.status === "BOUNCED" || log.status === "FAILED") && canManage && (
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-5 px-1.5 text-[10px]"
                                        onClick={() => handleResendEmail(u.id)}
                                        disabled={resendingEmailId === u.id}
                                      >
                                        {resendingEmailId === u.id ? (
                                          <Loader2 className="h-2.5 w-2.5 animate-spin" />
                                        ) : (
                                          t("resendEmail")
                                        )}
                                      </Button>
                                    )}
                                  </>
                                );
                              })()}
                            </div>
                          ) : (
                            <Badge variant="secondary" className="w-fit text-[10px] py-0 px-1.5">
                              {t("emailNotSent")}
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {editingPhoneId === u.id ? (
                          <div className="flex items-center gap-1">
                            <Input
                              value={phoneValue}
                              onChange={(e) => setPhoneValue(e.target.value)}
                              placeholder={t("phonePlaceholder")}
                              className="h-8 text-xs w-32"
                            />
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => handleSavePhone(u.id)} disabled={isPending}>
                              <Check className="h-3.5 w-3.5 text-green-600" />
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setEditingPhoneId(null)}>
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1">
                            <Phone className="w-3 h-3 text-muted-foreground" />
                            <span className="font-mono text-xs">{u.phone ?? "—"}</span>
                            {canManage && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 w-6 p-0 ml-1"
                                onClick={() => { setEditingPhoneId(u.id); setPhoneValue(u.phone ?? ""); }}
                              >
                                <Edit3 className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="info">{t(roleKeys[u.role] ?? u.role)}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        {canManage && sessionRole === "TENANT_ADMIN" ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 gap-1.5 text-xs"
                            onClick={() => openSiteModal(u.id, u.name)}
                          >
                            <MapPin className="h-3 w-3" />
                            Gérer
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={u.isActive ? "success" : "secondary"}>
                          {u.isActive ? t("active") : t("disabled")}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString("fr-FR") : t("never")}
                      </td>
                      {canManage && (
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end gap-1">
                            {!u.emailVerified && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-amber-600"
                                onClick={() => handleMarquerVerifies([u.id])}
                                disabled={verifyingUserId === u.id}
                                title={t("verifyOne")}
                              >
                                {verifyingUserId === u.id ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <BadgeCheck className="h-3.5 w-3.5" />
                                )}
                              </Button>
                            )}
                            {availableTenants.length > 1 && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => openTenantModal(u.email)}
                                title={t("addToTenant")}
                              >
                                <Building2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleToggle(u.id)} title={t("toggleTitle")}>
                              <Power className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => openDeleteModal(u.id, u.name)} title={t("deleteTitle")}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Modal: Gérer les accès sites */}
      {showSiteModal && canManage && (
        <Card className="border-primary/30">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <MapPin className="h-4 w-4 text-primary" />
              Accès aux sites — {siteModalUserName}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {siteLoading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : sites.length === 0 ? (
              <p className="text-sm text-muted-foreground bg-muted/50 rounded-lg p-4">
                Aucun site n&apos;a été configuré. Allez dans l&apos;onglet « Sites » pour créer des sites, puis revenez ici pour assigner les utilisateurs.
              </p>
            ) : (
              <>
                <div className="space-y-2">
                  {/* Option "Tous les sites" */}
                  <label
                    className="flex items-center gap-3 p-3 rounded-lg border-2 border-primary/30 bg-primary/5 cursor-pointer hover:bg-primary/10 transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={selectedSiteIds.length === sites.length}
                      onChange={toggleAllSites}
                      className="h-4 w-4 rounded border-gray-300"
                    />
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-primary" />
                      <div>
                        <p className="text-sm font-semibold">Accès à tous les sites</p>
                        <p className="text-xs text-muted-foreground">Cocher pour donner accès à tous les sites de l&apos;établissement</p>
                      </div>
                    </div>
                  </label>

                  {/* Liste des sites individuels */}
                  {sites.map((site) => (
                    <label
                      key={site.id}
                      className="flex items-center gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={selectedSiteIds.includes(site.id)}
                        onChange={() => toggleSiteSelection(site.id)}
                        className="h-4 w-4 rounded border-gray-300"
                      />
                      <div className="flex items-center gap-2">
                        <MapPin className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="text-sm font-medium">{site.nom}</p>
                          {site.code && (
                            <p className="text-xs text-muted-foreground">{site.code}</p>
                          )}
                        </div>
                      </div>
                    </label>
                  ))}
                  {selectedSiteIds.length === 0 && (
                    <p className="text-xs text-muted-foreground italic">
                      Sélectionnez au moins un site.
                    </p>
                  )}
                </div>

                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="gap-2"
                    onClick={handleSaveSites}
                    disabled={siteLoading || selectedSiteIds.length === 0}
                  >
                    {siteLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    Enregistrer
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => setShowSiteModal(false)}>
                    Annuler
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Modal: confirmation de vérification d'emails */}
      {showVerifyModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !verifyPending && setShowVerifyModal(false)}
        >
        <Card className="w-full max-w-md border-amber-300" onClick={(e) => e.stopPropagation()}>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <BadgeCheck className="h-4 w-4" />
              {t("verifyConfirmTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t("verifyConfirmBody", { count: nonVerifies.length })}
            </p>
            <ul className="max-h-40 space-y-1 overflow-y-auto text-xs text-muted-foreground">
              {nonVerifies.slice(0, 20).map((u) => (
                <li key={u.id}>{u.email}</li>
              ))}
              {nonVerifies.length > 20 && <li>… (+{nonVerifies.length - 20})</li>}
            </ul>
            <div className="flex gap-2">
              <Button
                size="sm"
                className="gap-2"
                onClick={() => handleMarquerVerifies()}
                disabled={verifyPending}
              >
                {verifyPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <BadgeCheck className="h-4 w-4" />
                )}
                {t("verifyConfirm")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowVerifyModal(false)}
              >
                {t("cancel")}
              </Button>
            </div>
          </CardContent>
        </Card>
        </div>
      )}

      {/* Modal: Confirmation de suppression */}
      {showDeleteModal && (
        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-4 w-4" />
              Confirmer la suppression
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Vous êtes sur le point de supprimer <strong className="text-foreground">{deleteUserName}</strong>.
              Cette action est irréversible et supprimera toutes les données associées (enseignant, sites, etc.).
            </p>
            <div className="space-y-2">
              <Label htmlFor="delete-confirm">
                Pour confirmer, tapez le nom exact de l&apos;utilisateur : <strong className="text-foreground">{deleteUserName}</strong>
              </Label>
              <Input
                id="delete-confirm"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder={deleteUserName}
                autoFocus
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant="destructive"
                size="sm"
                className="gap-2"
                onClick={handleDelete}
                disabled={deleteLoading || deleteConfirmText.trim() !== deleteUserName.trim()}
              >
                {deleteLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Supprimer définitivement
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowDeleteModal(false)}
              >
                Annuler
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
