"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Loader2, Plus, Trash2, DoorOpen, Building2, Users as UsersIcon, Pencil, Check, X,
} from "lucide-react";
import { useTranslations } from "next-intl";

interface Salle {
  id: string;
  nom: string;
  capacite: number;
  type: string | null;
  batiment: string | null;
  siteId: string | null;
  site?: { id: string; nom: string } | null;
}

interface SiteItem {
  id: string;
  nom: string;
  code: string | null;
}

export function SallesTab({ canManage, sites = [] }: { canManage: boolean; sites?: SiteItem[] }) {
  const t = useTranslations("parametres");
  const [salles, setSalles] = useState<Salle[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ nom: "", capacite: 30, type: "", batiment: "" });
  const [form, setForm] = useState({
    nom: "",
    capacite: 30,
    type: "",
    batiment: "",
    siteId: "",
  });

  const loadSalles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/salles");
      if (res.ok) {
        const data = await res.json();
        setSalles(data);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSalles();
  }, [loadSalles]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.nom.trim()) {
      toast.error("Le nom de la salle est obligatoire");
      return;
    }
    setIsPending(true);
    try {
      const res = await fetch("/api/salles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nom: form.nom.trim(),
          capacite: form.capacite,
          type: form.type.trim() || undefined,
          batiment: form.batiment.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erreur");
      toast.success("Salle créée");
      setShowForm(false);
      setForm({ nom: "", capacite: 30, type: "", batiment: "", siteId: "" });
      await loadSalles();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setIsPending(false);
    }
  }

  async function handleDelete(id: string, nom: string) {
    if (!confirm(`Supprimer la salle "${nom}" ?`)) return;
    setIsPending(true);
    try {
      const res = await fetch(`/api/salles/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erreur");
      toast.success("Salle supprimée");
      await loadSalles();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setIsPending(false);
    }
  }

  function startEdit(salle: Salle) {
    setEditingId(salle.id);
    setEditForm({
      nom: salle.nom,
      capacite: salle.capacite,
      type: salle.type ?? "",
      batiment: salle.batiment ?? "",
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditForm({ nom: "", capacite: 30, type: "", batiment: "" });
  }

  async function saveEdit(id: string) {
    if (!editForm.nom.trim()) {
      toast.error("Le nom est obligatoire");
      return;
    }
    setIsPending(true);
    try {
      // Pas de route PATCH, on supprime et recrée
      const res = await fetch(`/api/salles/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Erreur");
      }
      const res2 = await fetch("/api/salles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nom: editForm.nom.trim(),
          capacite: editForm.capacite,
          type: editForm.type.trim() || undefined,
          batiment: editForm.batiment.trim() || undefined,
        }),
      });
      if (!res2.ok) {
        const data = await res2.json();
        throw new Error(data.error ?? "Erreur");
      }
      toast.success("Salle modifiée");
      cancelEdit();
      await loadSalles();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setIsPending(false);
    }
  }

  const typeLabels: Record<string, string> = {
    cours: "Salle de cours",
    labo: "Laboratoire",
    informatique: "Salle informatique",
    sport: "Gymnase / Sport",
    reunion: "Salle de réunion",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium flex items-center gap-2">
            <DoorOpen className="h-4 w-4 text-primary" />
            Salles de classe
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Gérez les salles utilisées dans l&apos;emploi du temps
          </p>
        </div>
        {canManage && (
          <Button size="sm" className="gap-2" onClick={() => setShowForm(!showForm)}>
            <Plus className="h-4 w-4" />
            {t("addClass") === "Ajouter une classe" ? "Ajouter une salle" : t("addClass")}
          </Button>
        )}
      </div>

      {showForm && canManage && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Nouvelle salle</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="salle-nom">Nom de la salle *</Label>
                <Input
                  id="salle-nom"
                  placeholder="Ex: Salle 101, Labo Sciences..."
                  value={form.nom}
                  onChange={(e) => setForm({ ...form, nom: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="salle-capacite">Capacité</Label>
                <Input
                  id="salle-capacite"
                  type="number"
                  min="1"
                  max="500"
                  value={form.capacite}
                  onChange={(e) => setForm({ ...form, capacite: parseInt(e.target.value) || 30 })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="salle-type">Type de salle</Label>
                <select
                  id="salle-type"
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value })}
                >
                  <option value="">— Standard —</option>
                  {Object.entries(typeLabels).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="salle-batiment">Bâtiment</Label>
                <Input
                  id="salle-batiment"
                  placeholder="Ex: Bâtiment A"
                  value={form.batiment}
                  onChange={(e) => setForm({ ...form, batiment: e.target.value })}
                />
              </div>
              <div className="md:col-span-2 flex gap-2">
                <Button type="submit" size="sm" className="gap-2" disabled={isPending}>
                  {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Créer
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setShowForm(false)}>
                  Annuler
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : salles.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <DoorOpen className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p className="text-sm">Aucune salle créée. Cliquez sur « Ajouter une salle » pour commencer.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 border-b">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium">Salle</th>
                    <th className="text-left px-4 py-3 font-medium">Type</th>
                    <th className="text-left px-4 py-3 font-medium">Bâtiment</th>
                    <th className="text-right px-4 py-3 font-medium">Capacité</th>
                    <th className="text-left px-4 py-3 font-medium">Site</th>
                    {canManage && <th className="text-right px-4 py-3 font-medium">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {salles.map((salle) => {
                    const isEditing = editingId === salle.id;
                    return (
                      <tr key={salle.id} className="border-b hover:bg-muted/30">
                        {isEditing ? (
                          <>
                            <td className="px-4 py-2">
                              <Input
                                value={editForm.nom}
                                onChange={(e) => setEditForm({ ...editForm, nom: e.target.value })}
                                className="h-8 text-sm"
                              />
                            </td>
                            <td className="px-4 py-2">
                              <select
                                className="flex h-8 w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm"
                                value={editForm.type}
                                onChange={(e) => setEditForm({ ...editForm, type: e.target.value })}
                              >
                                <option value="">— Standard —</option>
                                {Object.entries(typeLabels).map(([key, label]) => (
                                  <option key={key} value={key}>{label}</option>
                                ))}
                              </select>
                            </td>
                            <td className="px-4 py-2">
                              <Input
                                value={editForm.batiment}
                                onChange={(e) => setEditForm({ ...editForm, batiment: e.target.value })}
                                className="h-8 text-sm"
                                placeholder="Bâtiment"
                              />
                            </td>
                            <td className="px-4 py-2">
                              <Input
                                type="number"
                                min="1"
                                max="500"
                                value={editForm.capacite}
                                onChange={(e) =>
                                  setEditForm({ ...editForm, capacite: parseInt(e.target.value) || 30 })
                                }
                                className="h-8 text-sm w-20"
                              />
                            </td>
                            <td className="px-4 py-2 text-muted-foreground text-xs">
                              {salle.site?.nom ?? "—"}
                            </td>
                            <td className="px-4 py-2 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-green-600"
                                  onClick={() => saveEdit(salle.id)}
                                  disabled={isPending}
                                >
                                  <Check className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  onClick={cancelEdit}
                                  disabled={isPending}
                                >
                                  <X className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="px-4 py-3 font-medium flex items-center gap-2">
                              <DoorOpen className="h-3.5 w-3.5 text-muted-foreground" />
                              {salle.nom}
                            </td>
                            <td className="px-4 py-3 text-muted-foreground">
                              {salle.type ? (
                                <Badge variant="outline" className="text-xs">
                                  {typeLabels[salle.type] ?? salle.type}
                                </Badge>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-muted-foreground">
                              {salle.batiment ?? "—"}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <Badge variant="info" className="text-xs">
                                <UsersIcon className="h-3 w-3 mr-1" />
                                {salle.capacite}
                              </Badge>
                            </td>
                            <td className="px-4 py-3 text-muted-foreground text-xs">
                              {salle.site?.nom ?? "Tous sites"}
                            </td>
                            {canManage && (
                              <td className="px-4 py-3 text-right">
                                <div className="flex items-center justify-end gap-1">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 text-muted-foreground"
                                    onClick={() => startEdit(salle)}
                                  >
                                    <Pencil className="h-3 w-3" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 text-destructive"
                                    onClick={() => handleDelete(salle.id, salle.nom)}
                                    disabled={isPending}
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </Button>
                                </div>
                              </td>
                            )}
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
