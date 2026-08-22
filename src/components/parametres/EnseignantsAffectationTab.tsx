"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Loader2, Plus, Trash2, GraduationCap, BookOpen, X, ChevronDown, ChevronRight,
} from "lucide-react";
import {
  getEnseignantsWithAffectations,
  getMatieresForAffectation,
  getClassesForAffectation,
  assignEnseignantMatieres,
  assignEnseignantClasse,
  unassignEnseignantClasse,
} from "@/lib/actions/parametres";
import { isNiveauPrimaire } from "@/lib/utils-classe";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

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

interface AffectationRow {
  id: string;
  classeId: string;
  matiereId: string | null;
  classe: { id: string; nom: string; niveau: string; structureId: string | null; structure: { type: string } | null };
  matiere: { id: string; nom: string; code: string } | null;
}

interface EnseignantRow {
  id: string;
  user: { id: string; name: string; email: string };
  matieres: { matiere: { id: string; nom: string; code: string } }[];
  affectations: AffectationRow[];
}

export function EnseignantsAffectationTab({ canManage }: { canManage: boolean }) {
  const t = useTranslations("parametres");
  const [enseignants, setEnseignants] = useState<EnseignantRow[]>([]);
  const [matieres, setMatieres] = useState<MatiereOption[]>([]);
  const [classes, setClasses] = useState<ClasseOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingMatieresFor, setEditingMatieresFor] = useState<string | null>(null);
  const [selectedMatieres, setSelectedMatieres] = useState<string[]>([]);
  const [showAssignFor, setShowAssignFor] = useState<string | null>(null);
  const [assignClasseId, setAssignClasseId] = useState("");
  const [assignMatiereId, setAssignMatiereId] = useState("");
  const [isPending, setIsPending] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [ens, mat, cls] = await Promise.all([
        getEnseignantsWithAffectations(),
        getMatieresForAffectation(),
        getClassesForAffectation(),
      ]);
      setEnseignants(ens as EnseignantRow[]);
      setMatieres(mat as MatiereOption[]);
      setClasses(cls as ClasseOption[]);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  function toggleExpand(id: string) {
    setExpandedId(expandedId === id ? null : id);
    setEditingMatieresFor(null);
    setShowAssignFor(null);
  }

  function startEditMatieres(ens: EnseignantRow) {
    setSelectedMatieres(ens.matieres.map((m) => m.matiere.id));
    setEditingMatieresFor(ens.id);
  }

  async function saveMatieres(enseignantId: string) {
    setIsPending(true);
    try {
      await assignEnseignantMatieres(enseignantId, selectedMatieres);
      toast.success("Matières mises à jour");
      setEditingMatieresFor(null);
      await loadData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setIsPending(false);
    }
  }

  function startAssign(enseignantId: string) {
    setAssignClasseId("");
    setAssignMatiereId("");
    setShowAssignFor(enseignantId);
  }

  async function handleAssign(enseignantId: string) {
    if (!assignClasseId) {
      toast.error("Sélectionnez une classe");
      return;
    }
    const classe = classes.find((c) => c.id === assignClasseId);
    if (!classe) return;
    const isPrimaire = isNiveauPrimaire(classe.niveau);
    if (!isPrimaire && !assignMatiereId) {
      toast.error("La matière est obligatoire pour le collège/lycée");
      return;
    }
    setIsPending(true);
    try {
      await assignEnseignantClasse(
        enseignantId,
        assignClasseId,
        isPrimaire ? undefined : assignMatiereId
      );
      toast.success("Affectation créée");
      setShowAssignFor(null);
      await loadData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setIsPending(false);
    }
  }

  async function handleUnassign(affectationId: string) {
    setIsPending(true);
    try {
      await unassignEnseignantClasse(affectationId);
      toast.success("Affectation supprimée");
      await loadData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setIsPending(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (enseignants.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          <GraduationCap className="h-10 w-10 mx-auto mb-3 opacity-40" />
          Aucun enseignant trouvé. Créez d&apos;abord des utilisateurs avec le rôle enseignant.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-md bg-blue-50 border border-blue-200 p-3 text-sm text-blue-800">
        <strong>Affectation des enseignants</strong> — Primaire : 1 classe unique (toutes matières).
        Collège/Lycée : l&apos;enseignant doit d&apos;abord être lié à une ou plusieurs matières, puis affecté
        à plusieurs classes par matière.
      </div>

      {enseignants.map((ens) => {
        const isExpanded = expandedId === ens.id;
        const isEditingMatieres = editingMatieresFor === ens.id;
        const isAssigning = showAssignFor === ens.id;
        return (
          <Card key={ens.id}>
            <CardHeader className="pb-3">
              <button
                onClick={() => toggleExpand(ens.id)}
                className="flex items-center gap-2 text-left w-full"
              >
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                )}
                <GraduationCap className="h-4 w-4 text-primary" />
                <span className="font-medium text-sm">{ens.user.name}</span>
                <span className="text-xs text-muted-foreground">{ens.user.email}</span>
                <div className="ml-auto flex gap-1.5">
                  {ens.matieres.length > 0 && (
                    <Badge variant="info" className="text-xs">
                      {ens.matieres.length} matière{ens.matieres.length > 1 ? "s" : ""}
                    </Badge>
                  )}
                  {ens.affectations.length > 0 && (
                    <Badge variant="success" className="text-xs">
                      {ens.affectations.length} classe{ens.affectations.length > 1 ? "s" : ""}
                    </Badge>
                  )}
                </div>
              </button>
            </CardHeader>

            {isExpanded && (
              <CardContent className="pt-0 space-y-4">
                {/* Section matières */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-medium flex items-center gap-1.5">
                      <BookOpen className="h-3.5 w-3.5" />
                      Matières enseignées
                      <span className="text-muted-foreground font-normal">
                        (obligatoire pour collège/lycée)
                      </span>
                    </Label>
                    {canManage && !isEditingMatieres && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => startEditMatieres(ens)}
                      >
                        Modifier
                      </Button>
                    )}
                  </div>

                  {!isEditingMatieres ? (
                    <div className="flex flex-wrap gap-1.5">
                      {ens.matieres.length === 0 ? (
                        <span className="text-xs text-muted-foreground">
                          Aucune matière assignée
                        </span>
                      ) : (
                        ens.matieres.map((m) => (
                          <Badge key={m.matiere.id} variant="outline" className="text-xs">
                            {m.matiere.nom}
                          </Badge>
                        ))
                      )}
                    </div>
                  ) : (
                    <div className="space-y-2 rounded-md border p-3">
                      <div className="flex flex-wrap gap-2">
                        {matieres.map((mat) => {
                          const selected = selectedMatieres.includes(mat.id);
                          return (
                            <button
                              key={mat.id}
                              type="button"
                              onClick={() => {
                                setSelectedMatieres((prev) =>
                                  selected
                                    ? prev.filter((id) => id !== mat.id)
                                    : [...prev, mat.id]
                                );
                              }}
                              className={cn(
                                "rounded-md border px-2.5 py-1 text-xs transition-colors",
                                selected
                                  ? "border-primary bg-primary/10 text-primary"
                                  : "border-input hover:bg-muted/50"
                              )}
                            >
                              {mat.nom}
                            </button>
                          );
                        })}
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          className="h-7 text-xs"
                          disabled={isPending}
                          onClick={() => saveMatieres(ens.id)}
                        >
                          {isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                          Enregistrer
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => setEditingMatieresFor(null)}
                        >
                          Annuler
                        </Button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Section affectations classes */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-medium flex items-center gap-1.5">
                      <GraduationCap className="h-3.5 w-3.5" />
                      Classes affectées
                    </Label>
                    {canManage && !isAssigning && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs gap-1"
                        onClick={() => startAssign(ens.id)}
                      >
                        <Plus className="h-3 w-3" />
                        Affecter une classe
                      </Button>
                    )}
                  </div>

                  {ens.affectations.length === 0 && !isAssigning ? (
                    <span className="text-xs text-muted-foreground">
                      Aucune classe affectée
                    </span>
                  ) : (
                    <div className="space-y-1.5">
                      {ens.affectations.map((aff) => (
                        <div
                          key={aff.id}
                          className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
                        >
                          <Badge variant="info" className="text-xs">
                            {aff.classe.nom}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {aff.classe.niveau}
                          </span>
                          {aff.matiere ? (
                            <Badge variant="outline" className="text-xs">
                              {aff.matiere.nom}
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="text-xs">
                              Toutes matières
                            </Badge>
                          )}
                          {canManage && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-6 w-6 ml-auto text-destructive"
                              onClick={() => handleUnassign(aff.id)}
                              disabled={isPending}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {isAssigning && (
                    <div className="space-y-3 rounded-md border p-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs">Classe</Label>
                        <select
                          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          value={assignClasseId}
                          onChange={(e) => {
                            setAssignClasseId(e.target.value);
                            const cls = classes.find((c) => c.id === e.target.value);
                            if (cls && isNiveauPrimaire(cls.niveau)) {
                              setAssignMatiereId("");
                            }
                          }}
                        >
                          <option value="">— Sélectionner —</option>
                          {classes.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.nom} ({c.niveau})
                              {c.structure ? ` — ${c.structure.nom}` : ""}
                            </option>
                          ))}
                        </select>
                      </div>
                      {assignClasseId &&
                        !isNiveauPrimaire(
                          classes.find((c) => c.id === assignClasseId)?.niveau ?? ""
                        ) && (
                          <div className="space-y-1.5">
                            <Label className="text-xs">
                              Matière <span className="text-destructive">*</span>
                            </Label>
                            <select
                              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                              value={assignMatiereId}
                              onChange={(e) => setAssignMatiereId(e.target.value)}
                            >
                              <option value="">— Sélectionner —</option>
                              {ens.matieres.map((m) => (
                                <option key={m.matiere.id} value={m.matiere.id}>
                                  {m.matiere.nom}
                                </option>
                              ))}
                            </select>
                            {ens.matieres.length === 0 && (
                              <p className="text-xs text-amber-600">
                                Cet enseignant n&apos;a pas encore de matière assignée.
                                Assignez-lui des matières d&apos;abord.
                              </p>
                            )}
                          </div>
                        )}
                      {assignClasseId &&
                        isNiveauPrimaire(
                          classes.find((c) => c.id === assignClasseId)?.niveau ?? ""
                        ) && (
                          <p className="text-xs text-muted-foreground">
                            Au primaire, l&apos;enseignant enseigne toutes les matières de cette classe.
                          </p>
                        )}
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          className="h-7 text-xs"
                          disabled={isPending || !assignClasseId}
                          onClick={() => handleAssign(ens.id)}
                        >
                          {isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                          Affecter
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => setShowAssignFor(null)}
                        >
                          Annuler
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}
