"use client";

import { useState, useTransition } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Plus, Trash2, Edit2, Loader2, X, Save, Tag,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import {
  createTarif, updateTarif, deleteTarif,
  type TarifFormData,
} from "@/lib/actions/facturation-avancee";

interface Tarif {
  id: string;
  niveau: string;
  annee: string;
  mensualite: number;
  fraisInscription: number;
  fraisRenouvellement: number;
  fraisCantine: number | null;
  fraisTransport: number | null;
  devise: string;
  nbMois: number;
  actif: boolean;
  siteId: string | null;
}

interface Site {
  id: string;
  nom: string;
}

const NIVEAUX = ["Maternelle", "Primaire", "Collège", "Lycée"];

function formatMoney(amount: number, devise: string) {
  return new Intl.NumberFormat("fr-DJ", { style: "currency", currency: devise === "XOF" ? "DJF" : devise, maximumFractionDigits: 0 }).format(amount);
}

export function TarifsManager({
  tarifs: initial,
  sites,
}: {
  tarifs: Tarif[];
  sites: Site[];
}) {
  const t = useTranslations("parametres");
  const [tarifs, setTarifs] = useState<Tarif[]>(initial);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  function handleCreated() {
    // Rechargement simple : les server actions font revalidatePath
    window.location.reload();
  }

  function handleDeleted(id: string) {
    setTarifs((prev) => prev.filter((t) => t.id !== id));
  }

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Tag className="h-5 w-5 text-primary" />
            {t("tarifsTitle")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("tarifsDescription")}</p>
        </div>
        <Button onClick={() => { setShowForm(true); setEditingId(null); }} className="gap-2">
          <Plus className="h-4 w-4" />
          {t("tarifAdd")}
        </Button>
      </div>

      {/* Form */}
      {showForm && (
        <TarifForm
          sites={sites}
          editingTarif={editingId ? tarifs.find((t) => t.id === editingId) : undefined}
          onClose={() => { setShowForm(false); setEditingId(null); }}
          onSaved={handleCreated}
        />
      )}

      {/* List */}
      {tarifs.length === 0 ? (
        <Card className="p-12 text-center">
          <Tag className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">{t("tarifsEmpty")}</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {tarifs.map((tarif) => (
            <TarifCard
              key={tarif.id}
              tarif={tarif}
              sites={sites}
              onEdit={() => { setEditingId(tarif.id); setShowForm(true); }}
              onDeleted={() => handleDeleted(tarif.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TarifForm({
  sites,
  editingTarif,
  onClose,
  onSaved,
}: {
  sites: Site[];
  editingTarif?: Tarif;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("parametres");
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = useState<TarifFormData>({
    niveau: editingTarif?.niveau ?? "Primaire",
    annee: editingTarif?.annee ?? `${new Date().getFullYear()}-${new Date().getFullYear() + 1}`,
    mensualite: editingTarif?.mensualite ?? 0,
    fraisInscription: editingTarif?.fraisInscription ?? 0,
    fraisRenouvellement: editingTarif?.fraisRenouvellement ?? 0,
    fraisCantine: editingTarif?.fraisCantine ?? undefined,
    fraisTransport: editingTarif?.fraisTransport ?? undefined,
    devise: editingTarif?.devise ?? "DJF",
    nbMois: editingTarif?.nbMois ?? 10,
    siteId: editingTarif?.siteId ?? undefined,
  });

  const set = <K extends keyof TarifFormData>(k: K, v: TarifFormData[K]) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        if (editingTarif) {
          await updateTarif(editingTarif.id, form);
          toast.success(t("tarifUpdated"));
        } else {
          await createTarif(form);
          toast.success(t("tarifCreated"));
        }
        onSaved();
        onClose();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("tarifError"));
      }
    });
  }

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between">
          <span>{editingTarif ? t("tarifEdit") : t("tarifAdd")}</span>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="space-y-1">
              <Label className="text-xs">{t("tarifNiveau")}</Label>
              <select
                value={form.niveau}
                onChange={(e) => set("niveau", e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                {NIVEAUX.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("tarifAnnee")}</Label>
              <Input
                value={form.annee}
                onChange={(e) => set("annee", e.target.value)}
                placeholder="2025-2026"
                className="h-9"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("tarifSite")}</Label>
              <select
                value={form.siteId ?? ""}
                onChange={(e) => set("siteId", e.target.value || undefined)}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">{t("tarifAllSites")}</option>
                {sites.map((s) => <option key={s.id} value={s.id}>{s.nom}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="space-y-1">
              <Label className="text-xs">{t("tarifMensualite")}</Label>
              <Input
                type="number"
                value={form.mensualite}
                onChange={(e) => set("mensualite", parseFloat(e.target.value) || 0)}
                className="h-9"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("tarifFraisInscription")}</Label>
              <Input
                type="number"
                value={form.fraisInscription}
                onChange={(e) => set("fraisInscription", parseFloat(e.target.value) || 0)}
                className="h-9"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("tarifFraisRenouvellement")}</Label>
              <Input
                type="number"
                value={form.fraisRenouvellement}
                onChange={(e) => set("fraisRenouvellement", parseFloat(e.target.value) || 0)}
                className="h-9"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("tarifNbMois")}</Label>
              <Input
                type="number"
                min={1}
                max={12}
                value={form.nbMois}
                onChange={(e) => set("nbMois", parseInt(e.target.value) || 10)}
                className="h-9"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="space-y-1">
              <Label className="text-xs">{t("tarifFraisCantine")}</Label>
              <Input
                type="number"
                value={form.fraisCantine ?? ""}
                onChange={(e) => set("fraisCantine", e.target.value ? parseFloat(e.target.value) : undefined)}
                placeholder="0"
                className="h-9"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("tarifFraisTransport")}</Label>
              <Input
                type="number"
                value={form.fraisTransport ?? ""}
                onChange={(e) => set("fraisTransport", e.target.value ? parseFloat(e.target.value) : undefined)}
                placeholder="0"
                className="h-9"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("tarifDevise")}</Label>
              <Input
                value={form.devise}
                onChange={(e) => set("devise", e.target.value)}
                className="h-9"
              />
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <Button type="submit" disabled={isPending} className="flex-1 gap-2">
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {editingTarif ? t("tarifSave") : t("tarifCreate")}
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("tarifCancel")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function TarifCard({
  tarif,
  sites,
  onEdit,
  onDeleted,
}: {
  tarif: Tarif;
  sites: Site[];
  onEdit: () => void;
  onDeleted: () => void;
}) {
  const t = useTranslations("parametres");
  const [isPending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const siteNom = tarif.siteId ? sites.find((s) => s.id === tarif.siteId)?.nom ?? "—" : t("tarifAllSites");

  function handleDelete() {
    startTransition(async () => {
      try {
        await deleteTarif(tarif.id);
        toast.success(t("tarifDeleted"));
        onDeleted();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("tarifError"));
      }
    });
  }

  return (
    <Card className={cn("p-4", !tarif.actif && "opacity-60")}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm">{tarif.niveau}</span>
            <Badge variant="secondary" className="text-xs">{tarif.annee}</Badge>
            <Badge variant="outline" className="text-xs">{siteNom}</Badge>
            {!tarif.actif && <Badge variant="destructive" className="text-xs">{t("tarifInactive")}</Badge>}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">{t("tarifMensualite")}</p>
              <p className="font-semibold">{formatMoney(tarif.mensualite, tarif.devise)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t("tarifFraisInscription")}</p>
              <p className="font-semibold">{formatMoney(tarif.fraisInscription, tarif.devise)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t("tarifFraisRenouvellement")}</p>
              <p className="font-semibold">{formatMoney(tarif.fraisRenouvellement, tarif.devise)}</p>
            </div>
            {tarif.fraisCantine != null && (
              <div>
                <p className="text-xs text-muted-foreground">{t("tarifFraisCantine")}</p>
                <p className="font-semibold">{formatMoney(tarif.fraisCantine, tarif.devise)}</p>
              </div>
            )}
            {tarif.fraisTransport != null && (
              <div>
                <p className="text-xs text-muted-foreground">{t("tarifFraisTransport")}</p>
                <p className="font-semibold">{formatMoney(tarif.fraisTransport, tarif.devise)}</p>
              </div>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {t("tarifNbMoisLabel", { count: tarif.nbMois })}
          </p>
        </div>
        <div className="flex gap-1 flex-shrink-0">
          <Button variant="ghost" size="sm" onClick={onEdit} className="gap-1">
            <Edit2 className="h-3.5 w-3.5" />
          </Button>
          {confirmDelete ? (
            <Button variant="destructive" size="sm" onClick={handleDelete} disabled={isPending} className="gap-1">
              {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              {t("tarifConfirmDelete")}
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)} className="gap-1">
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
