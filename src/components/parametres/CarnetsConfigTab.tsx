"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Loader2, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { MAX_DOMAINES, MAX_LIGNES } from "@/lib/carnet-primaire/configuration";
import type { Domaine, FormatCarnet, NiveauCarnet } from "@/lib/carnet-primaire/referentiel";

interface MatiereOption {
  id: string;
  nom: string;
  niveau: string | null;
}

interface NiveauConfig {
  niveau: NiveauCarnet;
  format: FormatCarnet;
  domaines: Domaine[];
  personnalise: boolean;
}

const champ = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-60";

export function CarnetsConfigTab({ canManage }: { canManage: boolean }) {
  const [niveaux, setNiveaux] = useState<NiveauConfig[]>([]);
  const [matieres, setMatieres] = useState<MatiereOption[]>([]);
  const [niveau, setNiveau] = useState<NiveauCarnet>("1ère");
  const [domaines, setDomaines] = useState<Domaine[]>([]);
  const [modifie, setModifie] = useState(false);
  const [chargement, setChargement] = useState(true);
  const [enCours, setEnCours] = useState(false);

  const charger = useCallback(async (niveauCible?: NiveauCarnet) => {
    setChargement(true);
    try {
      const res = await fetch("/api/carnets-primaires/configuration");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erreur de chargement");
      const liste = data.niveaux as NiveauConfig[];
      setNiveaux(liste);
      setMatieres((data.matieres ?? []) as MatiereOption[]);
      const cible = liste.find((n) => n.niveau === (niveauCible ?? "1ère")) ?? liste[0];
      if (cible) {
        setNiveau(cible.niveau);
        setDomaines(cible.domaines);
        setModifie(false);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur de chargement");
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => {
    void charger();
  }, [charger]);

  const courant = niveaux.find((n) => n.niveau === niveau);
  const pointsFormat = courant?.format === "points";
  // « 1ère » → "1" : Matiere.niveau porte le numéro du niveau ; sans niveau, la matière vaut pour tous.
  const numeroNiveau = niveau.match(/^\d+/)?.[0];
  const matieresDuNiveau = matieres.filter((m) => !m.niveau || m.niveau === numeroNiveau);
  const totalBareme = domaines.reduce((somme, d) => somme + (d.bareme ?? 0), 0);

  function changerNiveau(cible: NiveauCarnet) {
    if (modifie && !window.confirm("Des modifications non enregistrées seront perdues. Continuer ?")) return;
    const n = niveaux.find((x) => x.niveau === cible);
    if (!n) return;
    setNiveau(cible);
    setDomaines(n.domaines);
    setModifie(false);
  }

  function maj(modif: (liste: Domaine[]) => Domaine[]) {
    setDomaines((prev) => modif(prev));
    setModifie(true);
  }

  function majDomaine(index: number, partiel: Partial<Domaine>) {
    maj((liste) => liste.map((d, i) => (i === index ? { ...d, ...partiel } : d)));
  }

  function deplacer(index: number, sens: -1 | 1) {
    maj((liste) => {
      const cible = index + sens;
      if (cible < 0 || cible >= liste.length) return liste;
      const copie = [...liste];
      [copie[index], copie[cible]] = [copie[cible], copie[index]];
      return copie;
    });
  }

  function basculerMatiere(index: number, matiereId: string) {
    const actuelles = domaines[index].matieres ?? [];
    const suivantes = actuelles.includes(matiereId) ? actuelles.filter((id) => id !== matiereId) : [...actuelles, matiereId];
    majDomaine(index, { matieres: suivantes.length > 0 ? suivantes : undefined });
  }

  function ajouterDomaine() {
    maj((liste) => [
      ...liste,
      {
        // Code technique stable : les saisies déjà enregistrées s'y rattachent.
        code: `N${Date.now().toString(36).toUpperCase()}`,
        libelle: "Nouveau domaine",
        lignes: ["Nouvelle compétence"],
        ...(pointsFormat ? { bareme: 10 } : {}),
      },
    ]);
  }

  async function enregistrer() {
    setEnCours(true);
    try {
      const res = await fetch("/api/carnets-primaires/configuration", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ niveau, domaines }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erreur d'enregistrement");
      toast.success(`Carnet de la ${niveau} année enregistré`);
      await charger(niveau);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur d'enregistrement");
    } finally {
      setEnCours(false);
    }
  }

  async function reinitialiser() {
    if (!window.confirm(`Rétablir le modèle par défaut du carnet de la ${niveau} année ? Vos modifications seront perdues.`)) return;
    setEnCours(true);
    try {
      const res = await fetch(`/api/carnets-primaires/configuration?niveau=${encodeURIComponent(niveau)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erreur de réinitialisation");
      toast.success("Modèle par défaut rétabli");
      await charger(niveau);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur de réinitialisation");
    } finally {
      setEnCours(false);
    }
  }

  if (chargement && niveaux.length === 0) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-4xl">
      <div>
        <h2 className="text-lg font-semibold">Carnets de l&apos;enseignement fondamental</h2>
        <p className="text-sm text-muted-foreground">
          Ajustez, pour chaque niveau, les domaines, les compétences évaluées et les barèmes. Les carnets déjà saisis restent
          rattachés à leurs domaines : renommer un domaine ou un texte ne perd rien. Ne réordonnez pas les lignes d&apos;un
          domaine dont des évaluations existent déjà, elles seraient décalées.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {niveaux.map((n) => (
          <button
            key={n.niveau}
            onClick={() => changerNiveau(n.niveau)}
            className={cn(
              "flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors",
              niveau === n.niveau ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/70"
            )}
          >
            {n.niveau} année
            {n.personnalise && <span className="h-1.5 w-1.5 rounded-full bg-amber-400" title="Personnalisé" />}
          </button>
        ))}
      </div>

      {courant && (
        <Card>
          <CardContent className="p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Badge variant={courant.personnalise ? "info" : "outline"}>
                  {courant.personnalise ? "Personnalisé" : "Modèle par défaut"}
                </Badge>
                <span className="text-sm text-muted-foreground">
                  {pointsFormat
                    ? `Notes par domaine · total des barèmes /${totalBareme}`
                    : "Évaluation A / EVA / NA par compétence"}
                </span>
              </div>
              {canManage && (
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={reinitialiser}
                    disabled={enCours || !courant.personnalise}
                  >
                    <RotateCcw className="h-4 w-4" />
                    Rétablir le modèle
                  </Button>
                  <Button size="sm" className="gap-2" onClick={enregistrer} disabled={enCours || !modifie}>
                    {enCours ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Enregistrer
                  </Button>
                </div>
              )}
            </div>

            <div className="space-y-3">
              {domaines.map((domaine, index) => (
                <div key={domaine.code} className="rounded-lg border p-3 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={domaine.libelle}
                      onChange={(e) => majDomaine(index, { libelle: e.target.value, titre: undefined })}
                      disabled={!canManage}
                      maxLength={200}
                      className={cn(champ, "flex-1 min-w-48 font-medium")}
                      aria-label="Libellé du domaine"
                    />
                    {pointsFormat && (
                      <label className="flex items-center gap-1 text-sm">
                        Barème /
                        <input
                          type="number"
                          min={1}
                          max={100}
                          value={domaine.bareme ?? ""}
                          onChange={(e) =>
                            majDomaine(index, { bareme: e.target.value === "" ? undefined : Number(e.target.value) })
                          }
                          disabled={!canManage}
                          className={cn(champ, "w-20 text-right")}
                        />
                      </label>
                    )}
                    {canManage && (
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" onClick={() => deplacer(index, -1)} disabled={index === 0} aria-label="Monter">
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => deplacer(index, 1)}
                          disabled={index === domaines.length - 1}
                          aria-label="Descendre"
                        >
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => maj((liste) => liste.filter((_, i) => i !== index))}
                          disabled={domaines.length === 1}
                          aria-label="Supprimer le domaine"
                        >
                          <Trash2 className="h-4 w-4 text-red-600" />
                        </Button>
                      </div>
                    )}
                  </div>

                  {domaine.lignes.map((ligne, i) => (
                    <textarea
                      key={i}
                      value={ligne}
                      onChange={(e) =>
                        majDomaine(index, { lignes: domaine.lignes.map((l, j) => (j === i ? e.target.value : l)) })
                      }
                      disabled={!canManage}
                      rows={2}
                      maxLength={400}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs disabled:opacity-60"
                      aria-label={`Compétence ${i + 1}`}
                    />
                  ))}

                  <div className="space-y-1 pt-1">
                    <p className="text-xs font-medium">
                      Matières dont les notes alimentent ce domaine
                      <span className="ml-1 font-normal text-muted-foreground">
                        {domaine.matieres?.length
                          ? "(choix manuel)"
                          : "(automatique d'après le nom de la matière — cochez pour choisir)"}
                      </span>
                    </p>
                    {matieresDuNiveau.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        Aucune matière pour ce niveau. Créez-les dans Paramètres › Pédagogie › Matières.
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        {matieresDuNiveau.map((m) => (
                          <label key={m.id} className="flex items-center gap-1.5 text-xs">
                            <input
                              type="checkbox"
                              checked={domaine.matieres?.includes(m.id) ?? false}
                              onChange={() => basculerMatiere(index, m.id)}
                              disabled={!canManage}
                            />
                            {m.nom}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>

                  {canManage && (
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => majDomaine(index, { lignes: [...domaine.lignes, "Nouvelle compétence"] })}
                        disabled={domaine.lignes.length >= MAX_LIGNES}
                      >
                        <Plus className="h-3.5 w-3.5 mr-1" />
                        Ajouter une compétence
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => majDomaine(index, { lignes: domaine.lignes.slice(0, -1) })}
                        disabled={domaine.lignes.length <= 1}
                      >
                        Retirer la dernière
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {canManage && (
              <Button variant="outline" className="gap-2" onClick={ajouterDomaine} disabled={domaines.length >= MAX_DOMAINES}>
                <Plus className="h-4 w-4" />
                Ajouter un domaine
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
