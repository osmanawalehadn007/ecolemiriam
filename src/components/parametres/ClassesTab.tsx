"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Trash2, AlertTriangle, ArrowRightCircle, MinusCircle, ArrowLeftRight } from "lucide-react";
import { createClasse, deleteClasse, transferClasse, getEnseignantsForClasse, type ClasseFormData } from "@/lib/actions/parametres";
import { niveauRequiresProfPrincipal } from "@/lib/utils-classe";
import { useTranslations } from "next-intl";
import { StructureManager } from "./StructureManager";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

interface ClasseItem {
  id: string;
  nom: string;
  niveau: string;
  filiere: string | null;
  effectifMax: number;
  annee: string;
  siteId: string | null;
  _count: { eleves: number };
  profPrincipal: { user: { name: string } } | null;
  structure: { id: string; nom: string; type: string } | null;
}

interface StructureOption {
  id: string;
  type: string;
  nom: string;
}

interface SiteItem {
  id: string;
  nom: string;
  code: string | null;
}

export function ClassesTab({
  classes,
  canManage,
  sites = [],
  anneeCourante,
}: {
  classes: ClasseItem[];
  canManage: boolean;
  sites?: SiteItem[];
  /** Année scolaire courante du tenant, résolue côté serveur. */
  anneeCourante?: string;
}) {
  // Valeur par défaut du formulaire. Elle était figée à « 2025-2026 » : après
  // la rentrée, toute classe créée depuis cet écran naissait dans une année
  // révolue — c'est ainsi que « 6ème2 » et les classes de Lycée de l'Annexe
  // Warabaleh sont apparues dans un sélecteur d'admission 2026-2027.
  const anneeDefaut =
    anneeCourante ?? `${new Date().getFullYear()}-${new Date().getFullYear() + 1}`;
  const t = useTranslations("parametres");
  const tStruct = useTranslations("structures");
  const [showForm, setShowForm] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [structures, setStructures] = useState<StructureOption[]>([]);
  const [enseignants, setEnseignants] = useState<{ id: string; user: { name: string } }[]>([]);
  const [form, setForm] = useState<ClasseFormData>({
    nom: "",
    niveau: "",
    filiere: "",
    effectifMax: 40,
    annee: anneeDefaut,
    structureId: undefined,
    profPrincipalId: undefined,
  });
  const [selectedSiteId, setSelectedSiteId] = useState<string>("");

  useEffect(() => {
    fetch("/api/structures")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setStructures(data);
      })
      .catch(() => {});
    getEnseignantsForClasse().then(setEnseignants).catch(() => {});
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setIsPending(true);
    try {
      await createClasse({ ...form, siteId: selectedSiteId || undefined });
      toast.success(t("classCreated"));
      setShowForm(false);
      setForm({ nom: "", niveau: "", filiere: "", effectifMax: 40, annee: anneeDefaut, structureId: undefined, profPrincipalId: undefined });
      setSelectedSiteId("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("genericError"));
    } finally {
      setIsPending(false);
    }
  }

  const [deleteTarget, setDeleteTarget] = useState<ClasseItem | null>(null);
  const [deleteStrategy, setDeleteStrategy] = useState<"reassign" | "unassign">("reassign");
  const [targetClasseId, setTargetClasseId] = useState<string>("");
  const [isDeleting, setIsDeleting] = useState(false);

  const [transferTarget, setTransferTarget] = useState<ClasseItem | null>(null);
  const [transferSiteId, setTransferSiteId] = useState<string>("");
  const [isTransferring, setIsTransferring] = useState(false);

  function openTransferDialog(classe: ClasseItem) {
    setTransferTarget(classe);
    setTransferSiteId("");
  }

  function closeTransferDialog() {
    setTransferTarget(null);
    setTransferSiteId("");
  }

  async function handleTransfer() {
    if (!transferTarget || !transferSiteId) return;
    setIsTransferring(true);
    try {
      await transferClasse(transferTarget.id, transferSiteId);
      toast.success(t("classTransferred"));
      closeTransferDialog();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("genericError"));
    } finally {
      setIsTransferring(false);
    }
  }

  function openDeleteDialog(classe: ClasseItem) {
    setDeleteTarget(classe);
    setDeleteStrategy("reassign");
    setTargetClasseId("");
  }

  function closeDeleteDialog() {
    setDeleteTarget(null);
    setDeleteStrategy("reassign");
    setTargetClasseId("");
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    if (deleteTarget._count.eleves > 0 && deleteStrategy === "reassign" && !targetClasseId) {
      toast.error(t("selectTargetClass"));
      return;
    }
    setIsDeleting(true);
    try {
      await deleteClasse(deleteTarget.id, {
        strategy: deleteTarget._count.eleves > 0 ? deleteStrategy : undefined,
        targetClasseId: deleteStrategy === "reassign" ? targetClasseId : undefined,
      });
      toast.success(t("classDeleted"));
      closeDeleteDialog();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("genericError"));
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div className="space-y-4">
      <StructureManager canManage={canManage} />

      {canManage && (
        <div className="flex justify-end">
          <Button size="sm" className="gap-2" onClick={() => setShowForm(!showForm)}>
            <Plus className="h-4 w-4" />
            {t("addClass")}
          </Button>
        </div>
      )}

      {showForm && canManage && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t("newClass")}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {sites.length > 1 && (
                <div className="space-y-1.5 md:col-span-2">
                  <Label htmlFor="site">
                    {t("site")}
                    <span className="text-destructive ml-1">*</span>
                  </Label>
                  <select
                    id="site"
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    value={selectedSiteId}
                    onChange={(e) => setSelectedSiteId(e.target.value)}
                    required
                  >
                    <option value="">— Sélectionner un site —</option>
                    {sites.map((s) => (
                      <option key={s.id} value={s.id}>{s.nom}</option>
                    ))}
                  </select>
                </div>
              )}
              {structures.length > 0 && (
                <div className="space-y-1.5 md:col-span-2">
                  <Label htmlFor="structure">{tStruct("title")}</Label>
                  <select
                    id="structure"
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    value={form.structureId ?? ""}
                    onChange={(e) => setForm({ ...form, structureId: e.target.value || undefined })}
                  >
                    <option value="">{tStruct("noStructure")}</option>
                    {structures.map((s) => (
                      <option key={s.id} value={s.id}>{s.nom}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="nom">{t("className")}</Label>
                <Input id="nom" placeholder={t("classNamePlaceholder")} value={form.nom} onChange={(e) => setForm({ ...form, nom: e.target.value })} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="niveau">{t("level")}</Label>
                <Input id="niveau" placeholder={t("levelPlaceholder")} value={form.niveau} onChange={(e) => setForm({ ...form, niveau: e.target.value })} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="filiere">{t("filiere")}</Label>
                <Input id="filiere" placeholder={t("filierePlaceholder")} value={form.filiere ?? ""} onChange={(e) => setForm({ ...form, filiere: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="effectifMax">{t("maxStudents")}</Label>
                <Input id="effectifMax" type="number" min="1" value={form.effectifMax}
                  onChange={(e) => setForm({ ...form, effectifMax: parseInt(e.target.value) || 40 })} />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="profPrincipal">
                  {t("colProfPrincipal")}
                  {form.niveau && niveauRequiresProfPrincipal(form.niveau) && (
                    <span className="text-destructive ml-1">*</span>
                  )}
                </Label>
                <select
                  id="profPrincipal"
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={form.profPrincipalId ?? ""}
                  onChange={(e) => setForm({ ...form, profPrincipalId: e.target.value || undefined })}
                  required={!!form.niveau && niveauRequiresProfPrincipal(form.niveau)}
                >
                  <option value="">— Sélectionner —</option>
                  {enseignants.map((ens) => (
                    <option key={ens.id} value={ens.id}>{ens.user.name}</option>
                  ))}
                </select>
                {form.niveau && niveauRequiresProfPrincipal(form.niveau) && (
                  <p className="text-xs text-muted-foreground">Le professeur principal est obligatoire pour le collège et le lycée.</p>
                )}
              </div>
              <div className="md:col-span-2 flex gap-2">
                <Button type="submit" size="sm" className="gap-2" disabled={isPending}>
                  {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  {t("create")}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setShowForm(false)}>{t("cancel")}</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">{t("colClass")}</th>
                  <th className="text-left px-4 py-3 font-medium">{t("colLevel")}</th>
                  <th className="text-left px-4 py-3 font-medium">{tStruct("title")}</th>
                  <th className="text-left px-4 py-3 font-medium">{t("colFiliere")}</th>
                  <th className="text-right px-4 py-3 font-medium">{t("colStudents")}</th>
                  <th className="text-right px-4 py-3 font-medium">{t("colMax")}</th>
                  <th className="text-left px-4 py-3 font-medium">{t("colProfPrincipal")}</th>
                  <th className="text-left px-4 py-3 font-medium">{t("colYear")}</th>
                  {canManage && <th className="text-right px-4 py-3 font-medium">{t("colActions")}</th>}
                </tr>
              </thead>
              <tbody>
                {classes.length === 0 ? (
                  <tr><td colSpan={9} className="text-center py-8 text-muted-foreground">{t("noClasses")}</td></tr>
                ) : (
                  classes.map((c) => (
                    <tr key={c.id} className="border-b hover:bg-muted/30">
                      <td className="px-4 py-3 font-medium">{c.nom}</td>
                      <td className="px-4 py-3">{c.niveau}</td>
                      <td className="px-4 py-3 text-muted-foreground">{c.structure?.nom ?? "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{c.filiere ?? "—"}</td>
                      <td className="px-4 py-3 text-right">
                        <Badge variant="info">{c._count.eleves}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right text-muted-foreground">{c.effectifMax}</td>
                      <td className="px-4 py-3 text-muted-foreground">{c.profPrincipal?.user.name ?? "—"}</td>
                      <td className="px-4 py-3 text-xs">{c.annee}</td>
                      {canManage && (
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {sites.length > 1 && (
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={() => openTransferDialog(c)} title={t("transferClass")}>
                                <ArrowLeftRight className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => openDeleteDialog(c)}>
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

      {/* Dialogue de suppression */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && closeDeleteDialog()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              {t("deleteClassTitle")}
            </DialogTitle>
            <DialogDescription>
              {deleteTarget && t("deleteClassConfirm", { name: deleteTarget.nom, count: deleteTarget._count.eleves })}
            </DialogDescription>
          </DialogHeader>

          {deleteTarget && deleteTarget._count.eleves > 0 ? (
            <div className="space-y-4">
              <div className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
                {t("deleteClassHasStudents", { count: deleteTarget._count.eleves })}
              </div>

              <div className="space-y-3">
                <button
                  type="button"
                  className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors ${deleteStrategy === "reassign" ? "border-primary bg-primary/5" : "border-input hover:bg-muted/30"}`}
                  onClick={() => setDeleteStrategy("reassign")}
                >
                  <ArrowRightCircle className={`h-5 w-5 mt-0.5 ${deleteStrategy === "reassign" ? "text-primary" : "text-muted-foreground"}`} />
                  <div className="flex-1">
                    <div className="font-medium text-sm">{t("reassignStudents")}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{t("reassignStudentsDesc")}</div>
                    {deleteStrategy === "reassign" && (
                      <select
                        className="mt-2 flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        value={targetClasseId}
                        onChange={(e) => setTargetClasseId(e.target.value)}
                      >
                        <option value="">— {t("selectTargetClass")} —</option>
                        {classes
                          .filter((c) => c.id !== deleteTarget.id)
                          .map((c) => (
                            <option key={c.id} value={c.id}>{c.nom} ({c.niveau})</option>
                          ))}
                      </select>
                    )}
                  </div>
                </button>

                <button
                  type="button"
                  className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors ${deleteStrategy === "unassign" ? "border-primary bg-primary/5" : "border-input hover:bg-muted/30"}`}
                  onClick={() => setDeleteStrategy("unassign")}
                >
                  <MinusCircle className={`h-5 w-5 mt-0.5 ${deleteStrategy === "unassign" ? "text-primary" : "text-muted-foreground"}`} />
                  <div className="flex-1">
                    <div className="font-medium text-sm">{t("unassignStudents")}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{t("unassignStudentsDesc")}</div>
                  </div>
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
              {t("deleteClassEmpty")}
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={closeDeleteDialog} disabled={isDeleting}>
              {t("cancel")}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              className="gap-2"
              onClick={handleDelete}
              disabled={isDeleting || (!!deleteTarget && deleteTarget._count.eleves > 0 && deleteStrategy === "reassign" && !targetClasseId)}
            >
              {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              {t("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialogue de transfert */}
      <Dialog open={!!transferTarget} onOpenChange={(open) => !open && closeTransferDialog()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowLeftRight className="h-5 w-5" />
              {t("transferClassTitle")}
            </DialogTitle>
            <DialogDescription>
              {transferTarget && t("transferClassConfirm", { name: transferTarget.nom, count: transferTarget._count.eleves })}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="transferSite">{t("targetSite")}</Label>
              <select
                id="transferSite"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={transferSiteId}
                onChange={(e) => setTransferSiteId(e.target.value)}
              >
                <option value="">— {t("selectTargetSite")} —</option>
                {sites
                  .filter((s) => s.id !== transferTarget?.siteId)
                  .map((s) => (
                    <option key={s.id} value={s.id}>{s.nom}</option>
                  ))}
              </select>
            </div>
            {transferTarget && transferTarget._count.eleves > 0 && (
              <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
                {t("transferClassWarning", { count: transferTarget._count.eleves })}
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={closeTransferDialog} disabled={isTransferring}>
              {t("cancel")}
            </Button>
            <Button
              size="sm"
              className="gap-2"
              onClick={handleTransfer}
              disabled={isTransferring || !transferSiteId}
            >
              {isTransferring ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowLeftRight className="h-4 w-4" />}
              {t("transfer")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
