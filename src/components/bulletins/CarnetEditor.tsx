"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Printer, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { openPrintWindow } from "@/lib/print-window";
import {
  CARNETS,
  MODULES,
  baremeTotal,
  type CarnetDef,
  type Module,
  type NiveauCarnet,
} from "@/lib/carnet-primaire/referentiel";
import {
  cleCompetence,
  degreMaitrise,
  moyenneAnnuelle,
  noteModule,
  type Evaluation,
  type SaisieCarnet,
  type SaisieModule,
} from "@/lib/carnet-primaire/notation";

interface EleveClasse {
  id: string;
  nom: string;
  prenom: string;
  matricule: string;
}

interface Props {
  classeNom: string;
  niveau: NiveauCarnet;
  /** Année scolaire au format 2026-2027 ; null si le libellé de la période est inexploitable. */
  annee: string | null;
  eleves: EleveClasse[];
}

const EVALUATIONS: Evaluation[] = ["A", "EVA", "NA"];

const DECISIONS = ["Passe en classe supérieure", "Redouble", "Passe sous réserve"];

export function CarnetEditor({ classeNom, niveau, annee, eleves }: Props) {
  // Modèle par défaut le temps du chargement ; remplacé par la définition du tenant (personnalisée ou non).
  const [definition, setDefinition] = useState<CarnetDef>(CARNETS[niveau]);
  const [eleveId, setEleveId] = useState(eleves[0]?.id ?? "");
  const [module, setModule] = useState<Module>(1);
  const [saisie, setSaisie] = useState<SaisieCarnet>({});
  const [appreciations, setAppreciations] = useState("");
  const [decision, setDecision] = useState("");
  const [chargement, setChargement] = useState(false);
  const [enregistrement, setEnregistrement] = useState(false);
  const [modifie, setModifie] = useState(false);

  // Un changement de classe remplace la liste d'élèves : on se repositionne sur le premier.
  useEffect(() => {
    setEleveId(eleves[0]?.id ?? "");
  }, [eleves]);

  const charger = useCallback(async () => {
    if (!eleveId || !annee) return;
    setChargement(true);
    try {
      const res = await fetch(`/api/carnets-primaires?eleveId=${eleveId}&annee=${annee}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erreur de chargement");
      if (data.definition) setDefinition(data.definition);
      setSaisie(data.saisie ?? {});
      setAppreciations(data.appreciations ?? "");
      setDecision(data.decision ?? "");
      setModifie(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur de chargement");
    } finally {
      setChargement(false);
    }
  }, [eleveId, annee]);

  useEffect(() => {
    void charger();
  }, [charger]);

  const saisieModule: SaisieModule = saisie[`${module}`] ?? {};
  const noteCourante = noteModule(definition, saisieModule);
  const moyenne = useMemo(() => moyenneAnnuelle(definition, saisie), [definition, saisie]);

  function majModule(maj: (courant: SaisieModule) => SaisieModule) {
    setSaisie((prev) => ({ ...prev, [`${module}`]: maj(prev[`${module}`] ?? {}) }));
    setModifie(true);
  }

  function choisirEvaluation(cle: string, valeur: Evaluation) {
    majModule((courant) => {
      const competences = { ...(courant.competences ?? {}) };
      if (competences[cle] === valeur) delete competences[cle];
      else competences[cle] = valeur;
      return { ...courant, competences };
    });
  }

  function saisirPoints(code: string, texte: string) {
    majModule((courant) => {
      const domaines = { ...(courant.domaines ?? {}) };
      if (texte === "") delete domaines[code];
      else domaines[code] = Number(texte.replace(",", "."));
      return { ...courant, domaines };
    });
  }

  function saisirNote(texte: string) {
    majModule((courant) => ({ ...courant, note: texte === "" ? null : Number(texte.replace(",", ".")) }));
  }

  async function enregistrer(): Promise<boolean> {
    if (!eleveId || !annee) return false;
    setEnregistrement(true);
    try {
      const res = await fetch("/api/carnets-primaires", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eleveId, annee, saisie, appreciations, decision }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erreur d'enregistrement");
      setModifie(false);
      toast.success("Carnet enregistré");
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur d'enregistrement");
      return false;
    } finally {
      setEnregistrement(false);
    }
  }

  async function imprimer() {
    if (!eleveId || !annee) return;
    if (modifie && !(await enregistrer())) return;
    try {
      const res = await fetch(`/api/carnets-primaires?eleveId=${eleveId}&annee=${annee}&format=html`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erreur d'impression");
      if (!openPrintWindow(data.html)) toast.error("La fenêtre d'impression a été bloquée par le navigateur");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur d'impression");
    }
  }

  if (!annee) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          Impossible de déterminer l&apos;année scolaire : le libellé de la période ne contient pas deux années (ex. 2026-2027).
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-6 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold">
              Carnet {niveau} année — {classeNom}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Année scolaire {annee} ·{" "}
              {definition.format === "competences"
                ? "Évaluation A / EVA / NA par compétence"
                : `Notes par domaine, total des barèmes /${baremeTotal(definition)}`}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="gap-2" onClick={imprimer} disabled={!eleveId || chargement}>
              <Printer className="h-4 w-4" />
              Imprimer
            </Button>
            <Button className="gap-2" onClick={() => void enregistrer()} disabled={!eleveId || enregistrement || !modifie}>
              {enregistrement ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Enregistrer
            </Button>
          </div>
        </div>

        {eleves.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun élève actif dans cette classe.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={eleveId}
                onChange={(e) => setEleveId(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                aria-label="Élève"
              >
                {eleves.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.prenom} {e.nom} ({e.matricule})
                  </option>
                ))}
              </select>
              <div className="flex gap-1">
                {MODULES.map((m) => (
                  <button
                    key={m}
                    onClick={() => setModule(m)}
                    className={cn(
                      "px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
                      module === m ? "bg-primary text-white" : "bg-muted hover:bg-muted/70"
                    )}
                  >
                    Module {m}
                  </button>
                ))}
              </div>
              {chargement && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </div>

            <div className="space-y-4">
              {definition.domaines.map((domaine) => (
                <div key={domaine.code} className="rounded-lg border">
                  <div className="flex items-center justify-between bg-muted/50 px-3 py-2">
                    <p className="text-sm font-semibold">{domaine.libelle}</p>
                    {definition.format === "points" && (
                      <div className="flex items-center gap-1 text-sm">
                        <input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          max={domaine.bareme}
                          step="0.25"
                          value={saisieModule.domaines?.[domaine.code] ?? ""}
                          onChange={(e) => saisirPoints(domaine.code, e.target.value)}
                          className="h-8 w-20 rounded-md border border-input bg-background px-2 text-right"
                          aria-label={`Note ${domaine.libelle}`}
                        />
                        <span className="text-muted-foreground">/ {domaine.bareme}</span>
                      </div>
                    )}
                  </div>
                  <ul className="divide-y">
                    {domaine.lignes.map((ligne, index) => {
                      const cle = cleCompetence(domaine, index);
                      const valeur = saisieModule.competences?.[cle];
                      return (
                        <li key={cle} className="flex items-center justify-between gap-3 px-3 py-2">
                          <span className="text-xs text-muted-foreground">{ligne}</span>
                          {definition.format === "competences" && (
                            <div className="flex gap-1 shrink-0">
                              {EVALUATIONS.map((ev) => (
                                <button
                                  key={ev}
                                  onClick={() => choisirEvaluation(cle, ev)}
                                  aria-pressed={valeur === ev}
                                  className={cn(
                                    "w-11 rounded-md border px-2 py-1 text-xs font-medium",
                                    valeur === ev
                                      ? ev === "A"
                                        ? "bg-green-600 text-white border-green-600"
                                        : ev === "EVA"
                                          ? "bg-amber-500 text-white border-amber-500"
                                          : "bg-red-600 text-white border-red-600"
                                      : "hover:bg-muted"
                                  )}
                                >
                                  {ev}
                                </button>
                              ))}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-6 rounded-lg bg-muted/40 px-4 py-3 text-sm">
              <div className="flex items-center gap-2">
                <span className="font-medium">Note du module {module} sur 10</span>
                {definition.format === "competences" ? (
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={10}
                    step="0.25"
                    value={saisieModule.note ?? ""}
                    onChange={(e) => saisirNote(e.target.value)}
                    className="h-8 w-20 rounded-md border border-input bg-background px-2 text-right"
                    aria-label="Note du module sur 10"
                  />
                ) : (
                  <strong>{noteCourante === null ? "—" : noteCourante}</strong>
                )}
              </div>
              <div>
                Degré de maîtrise : <strong>{noteCourante === null ? "—" : degreMaitrise(noteCourante)}</strong>
              </div>
              <div>
                Moyenne annuelle : <strong>{moyenne === null ? "—" : moyenne}</strong>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span className="font-medium">Appréciations générales</span>
                <textarea
                  value={appreciations}
                  onChange={(e) => {
                    setAppreciations(e.target.value);
                    setModifie(true);
                  }}
                  rows={3}
                  maxLength={2000}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium">Décision de fin d&apos;année</span>
                <input
                  list="decisions-carnet"
                  value={decision}
                  onChange={(e) => {
                    setDecision(e.target.value);
                    setModifie(true);
                  }}
                  maxLength={200}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
                <datalist id="decisions-carnet">
                  {DECISIONS.map((d) => (
                    <option key={d} value={d} />
                  ))}
                </datalist>
              </label>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
