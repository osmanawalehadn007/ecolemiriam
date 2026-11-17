"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NIVEAUX_CARNET, type NiveauCarnet } from "@/lib/carnet-primaire/referentiel";
import { MAX_LIGNES } from "@/lib/carnet-primaire/configuration";

interface DomaineCompetences {
  code: string;
  libelle: string;
  lignes: string[];
  personnalise: boolean;
}

/** Compétences du carnet du primaire, par niveau et par domaine (table `competences`). */
export function CompetencesPanel({ canManage }: { canManage: boolean }) {
  const [niveaux, setNiveaux] = useState<{ niveau: NiveauCarnet; domaines: DomaineCompetences[] }[]>([]);
  const [niveau, setNiveau] = useState<NiveauCarnet>("1ère");
  const [brouillons, setBrouillons] = useState<Record<string, string[]>>({});
  const [enCours, setEnCours] = useState<string | null>(null);

  const charger = useCallback(async () => {
    const res = await fetch("/api/competences");
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? "Chargement des compétences impossible");
      return;
    }
    setNiveaux(data.niveaux);
    setBrouillons({});
  }, []);

  useEffect(() => {
    void charger();
  }, [charger]);

  const domaines = niveaux.find((n) => n.niveau === niveau)?.domaines ?? [];
  const lignesDe = (d: DomaineCompetences) => brouillons[`${niveau}|${d.code}`] ?? d.lignes;
  const majLignes = (d: DomaineCompetences, lignes: string[]) =>
    setBrouillons((b) => ({ ...b, [`${niveau}|${d.code}`]: lignes }));

  async function appeler(d: DomaineCompetences, methode: "PUT" | "DELETE") {
    setEnCours(d.code);
    try {
      const res =
        methode === "PUT"
          ? await fetch("/api/competences", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ niveau, domaine: d.code, lignes: lignesDe(d) }),
            })
          : await fetch(`/api/competences?niveau=${encodeURIComponent(niveau)}&domaine=${d.code}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erreur");
      toast.success(methode === "PUT" ? "Compétences enregistrées" : "Modèle par défaut rétabli");
      await charger();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setEnCours(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Compétences du carnet (primaire)</CardTitle>
        <p className="text-xs text-muted-foreground">
          Liste des compétences imprimées sur le carnet de chaque niveau, par domaine. Ajouter une compétence à la fin ne
          modifie pas les évaluations déjà saisies ; ne réordonnez pas les lignes d&apos;un domaine en cours d&apos;année.
        </p>
        <div className="flex flex-wrap gap-1 pt-2">
          {NIVEAUX_CARNET.map((n) => (
            <Button key={n} size="sm" variant={n === niveau ? "default" : "outline"} onClick={() => setNiveau(n)}>
              {n} année
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {domaines.map((d) => {
          const lignes = lignesDe(d);
          return (
            <div key={d.code} className="rounded-lg border p-3 space-y-2">
              <p className="text-sm font-medium">
                {d.libelle} {d.personnalise && <span className="text-xs text-muted-foreground">(personnalisé)</span>}
              </p>
              {lignes.map((ligne, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="pt-2 text-xs text-muted-foreground w-6">C{i + 1}</span>
                  <textarea
                    rows={2}
                    disabled={!canManage}
                    className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm disabled:opacity-60"
                    value={ligne}
                    onChange={(e) => majLignes(d, lignes.map((l, k) => (k === i ? e.target.value : l)))}
                  />
                  {canManage && lignes.length > 1 && (
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => majLignes(d, lignes.filter((_, k) => k !== i))}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              ))}
              {canManage && (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" className="gap-1" disabled={lignes.length >= MAX_LIGNES} onClick={() => majLignes(d, [...lignes, ""])}>
                    <Plus className="h-3.5 w-3.5" /> Compétence
                  </Button>
                  <Button size="sm" className="gap-1" disabled={enCours !== null} onClick={() => appeler(d, "PUT")}>
                    {enCours === d.code ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Enregistrer
                  </Button>
                  {d.personnalise && (
                    <Button size="sm" variant="ghost" className="gap-1" disabled={enCours !== null} onClick={() => appeler(d, "DELETE")}>
                      <RotateCcw className="h-3.5 w-3.5" /> Modèle par défaut
                    </Button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
